/**
 * Write to a service's Google Sheet — the sheet stays the record; the app
 * picks every change up on the sync that follows.
 *
 * LOGGING a new closed trade writes one row in the layout that sheet already
 * uses, formulas included, at the first row after the last filled one:
 *
 *   DPL / PSU / NBS
 *     single bought option -> the closing-fill layout the recent rows use:
 *       Direction, OCC symbol (unpadded strike), Name ("RILY CALL"), Fill
 *       price, Quantity, Exit date, Trade time, Running position 0, Wavg buy,
 *       Wavg sell, Net return %, Portfolio code, Entry date, … Duration (col V)
 *     spreads, multi-leg and put sells -> the journal's main layout, which is
 *       how those sheets already record them (Strike "205 / 220", Spread
 *       "Vertical", Side "SHORT" for a credit):
 *       Status, Symbol, Size, Open, Close, -, -, Entry, Exit, Return $,
 *       Return %, Avg buy, Avg sell, -, Expire, Strike, Type, Side, Spread,
 *       Cost, -, Holdtime, Last order, Portfolio
 *   PMK — Name, Symbol(s), Weight, Adj. weight, Open date, Open price, Close
 *     date, Close price, =H/F-1, (blank), =DAYS(G,E), =I*D/SUM(D:D). A credit
 *     trade's return is written as a value (H/F-1 is a debit formula) and its
 *     name starts "SOLD". A Stock Flip also goes on "Stock Flips".
 *
 * EDITING an existing trade rewrites only its date, price and return cells,
 * and first re-reads the row to confirm it is still the same trade — rows can
 * move when someone sorts or inserts in the sheet, and writing to a row that
 * has shifted would silently corrupt a different trade.
 *
 * The War Room is never logged here: its sheet is fed from Airtable by an
 * automation (_airtable_sync_log tab), so a new row would be duplicated.
 * Editing an existing War Room row is fine.
 *
 * Needs the sheet shared with the service account as Editor.
 */
import { googleAccessToken } from "../google";
import { parseSheetOcc } from "./types";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface Leg {
  action: "BUY" | "SELL";
  right: "C" | "P";
  strike: number;
  expiry: string; // YYYY-MM-DD
}

export type LogStructure = "SINGLE" | "MULTI" | "PUT_SELL";

export interface LoggedTrade {
  code: "DPL" | "PSU" | "NBS" | "PMK";
  sheetId: string;
  portfolio: string; // PMK: dark-ticker | stock-flips
  underlying: string;
  structure: LogStructure;
  legs: Leg[];
  /** Opened for a net credit (put sells, credit spreads). */
  credit: boolean;
  quantity: number;
  openDate: string;
  /** Net per contract, always positive: the debit paid or the credit received. */
  entryPrice: number;
  closeDate: string;
  /** Net per contract to close, always >= 0. */
  exitPrice: number;
}

export const LOGGABLE = ["DPL", "PSU", "NBS", "PMK"] as const;

const PORTFOLIO_CODE: Record<string, string> = { DPL: "DPL", PSU: "PSU", NBS: "SS" };
const PORTFOLIO_NAME: Record<string, string> = { DPL: "Daily Profits Live", PSU: "Profit Surge Trader", NBS: "Sector Strike" };

function mdY(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${m}/${d}/${y}`;
}

function yymmdd(ymd: string): string {
  return ymd.slice(2).replace(/-/g, "");
}

function days(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

const fmtK = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

/** Debit trades: exit/entry - 1. Credit trades: share of the credit kept. */
export function returnOf(t: Pick<LoggedTrade, "entryPrice" | "exitPrice" | "credit">): number {
  return t.credit ? (t.entryPrice - t.exitPrice) / t.entryPrice : t.exitPrice / t.entryPrice - 1;
}

async function call(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 403 || res.status === 404) {
    throw new Error("The app can't edit this sheet. Share it with the OxfordHub service account as an Editor.");
  }
  if (!res.ok) throw new Error(`Google Sheets error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function token(): Promise<string> {
  const t = await googleAccessToken();
  if (!t) throw new Error("No Google service account is configured on this app (GOOGLE_SERVICE_ACCOUNT_JSON).");
  return t;
}

const q = (tab: string, a1: string) => encodeURIComponent(`'${tab}'!${a1}`);

/** First empty row after the last row with something in columns A:B. */
async function nextRow(tk: string, sheetId: string, tab: string): Promise<number> {
  const body = (await call(tk, `${sheetId}/values/${q(tab, "A:B")}?majorDimension=ROWS`)) as { values?: unknown[][] };
  return (body.values?.length ?? 0) + 1;
}

async function writeRow(tk: string, sheetId: string, tab: string, row: number, values: (string | number)[]) {
  await call(tk, `${sheetId}/values/${q(tab, `A${row}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range: `'${tab}'!A${row}`, majorDimension: "ROWS", values: [values] }),
  });
}

// ---- logging ----------------------------------------------------------------

function occ(u: string, leg: Leg, pad: boolean): string {
  const k = String(Math.round(leg.strike * 1000));
  return `${u}${yymmdd(leg.expiry)}${leg.right}${pad ? k.padStart(8, "0") : k}`;
}

function spreadLabel(t: LoggedTrade): string {
  if (t.legs.length === 1) return "SINGLE";
  const rights = new Set(t.legs.map((l) => l.right));
  if (t.legs.length === 2 && rights.size === 2) return "Strangle";
  if (t.legs.length === 3) return "Butterfly";
  return "Vertical";
}

export async function logTradeToSheet(t: LoggedTrade): Promise<{ tab: string; row: number }[]> {
  const tk = await token();
  const u = t.underlying.toUpperCase();
  const ret = returnOf(t);
  const written: { tab: string; row: number }[] = [];
  const rights = new Set(t.legs.map((l) => l.right));
  const typeWord = rights.size === 1 ? (t.legs[0].right === "C" ? "CALL" : "PUT") : "OPTION";
  const strikes = t.legs.map((l) => fmtK(l.strike)).join(" / ");

  if (t.code === "PMK") {
    const symbol = t.legs.map((l) => occ(u, l, true)).join(", ");
    const e = t.legs[0].expiry;
    const [y, , d] = e.split("-");
    const mon = new Date(`${e}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const legText = t.legs.map((l) => `${l.right}${fmtK(l.strike)}`).join("/");
    const name = `${t.credit ? "SOLD " : ""}${u} ${Number(d)}${mon}${y.slice(2)} ${legText}`;
    const tabs = t.portfolio === "stock-flips" ? ["Since Inception", "Stock Flips"] : ["Since Inception"];
    for (const tab of tabs) {
      const n = await nextRow(tk, t.sheetId, tab);
      await writeRow(tk, t.sheetId, tab, n, [
        name, symbol, t.quantity, t.quantity, mdY(t.openDate), t.entryPrice, mdY(t.closeDate), t.exitPrice,
        t.credit ? Number(ret.toFixed(6)) : `=H${n}/F${n}-1`, "", `=days(G${n},E${n})`, `=I${n}*D${n}/SUM(D:D)`,
      ]);
      written.push({ tab, row: n });
    }
    return written;
  }

  const tab = "Since Inception";
  const n = await nextRow(tk, t.sheetId, tab);
  let row: (string | number)[];

  if (t.structure === "SINGLE" && !t.credit) {
    row = [
      "Sell", occ(u, t.legs[0], false), `${u} ${typeWord}`, t.exitPrice, t.quantity, mdY(t.closeDate), "",
      0, t.entryPrice, t.exitPrice, Number(ret.toFixed(4)), PORTFOLIO_CODE[t.code], mdY(t.openDate), "",
    ];
    while (row.length < 21) row.push("");
    row.push(days(t.openDate, t.closeDate));
  } else {
    const dollars = (t.credit ? t.entryPrice - t.exitPrice : t.exitPrice - t.entryPrice) * 100 * t.quantity;
    row = [
      ret > 0 ? "WIN" : ret < 0 ? "LOSS" : "BE", u, t.quantity, mdY(t.openDate), mdY(t.closeDate), "", "",
      t.entryPrice, t.exitPrice, Number(dollars.toFixed(2)), Number(ret.toFixed(4)), t.entryPrice, t.exitPrice, "",
      mdY(t.legs[0].expiry), t.legs.length === 1 ? t.legs[0].strike : strikes, typeWord,
      t.credit ? "SHORT" : "LONG", spreadLabel(t), Number((t.entryPrice * 100 * t.quantity).toFixed(2)), "",
      days(t.openDate, t.closeDate), mdY(t.closeDate), PORTFOLIO_NAME[t.code],
    ];
  }
  await writeRow(tk, t.sheetId, tab, n, row);
  written.push({ tab, row: n });
  return written;
}

// ---- editing ------------------------------------------------------------------

/** Only the fields present are written. */
export interface TradeEdit {
  openDate?: string;
  closeDate?: string;
  entryPrice?: number;
  exitPrice?: number;
  /** Fraction. Ignored where the sheet computes it (PMK's =H/F-1). */
  returnPct?: number;
}

interface CellMap {
  open: number;
  close: number;
  entry: number;
  exit: number;
  ret: number | null; // null = formula, don't write
  /** Column whose value must still match before writing. */
  check: number;
}

const COL = (i: number) => {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const EPOCH = Date.UTC(1899, 11, 30);
const serialToYmd = (v: unknown) =>
  typeof v === "number" && v > 30000 ? new Date(EPOCH + Math.floor(v) * 86_400_000).toISOString().slice(0, 10) : null;

function cellsFor(code: string, row: unknown[]): CellMap {
  if (code === "WAR") return { open: 8, close: 12, entry: 9, exit: 13, ret: 16, check: 8 };
  if (code === "PMK") return { open: 4, close: 6, entry: 5, exit: 7, ret: null, check: 4 };
  // Broker sheets: a closing-fill row has the OCC symbol in column B.
  const isFill = typeof row[1] === "string" && parseSheetOcc(row[1]) !== null;
  return isFill
    ? { open: 12, close: 5, entry: 8, exit: 9, ret: 10, check: 12 }
    : { open: 3, close: 4, entry: 7, exit: 8, ret: 10, check: 3 };
}

export async function editTradeInSheet(opts: {
  code: string;
  sheetId: string;
  tab: string;
  row: number;
  expect: { openDate: string; returnPct: number | null };
  edit: TradeEdit;
}): Promise<void> {
  const tk = await token();
  const { tab, row } = opts;
  const got = (await call(
    tk,
    `${opts.sheetId}/values/${q(tab, `A${row}:AD${row}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  )) as { values?: unknown[][] };
  const cells = got.values?.[0] ?? [];
  const map = cellsFor(opts.code, cells);

  // Same trade? Open date and published return must both still match.
  const open = serialToYmd(cells[map.check]);
  const retCell = cells[opts.code === "PMK" ? 8 : (map.ret ?? 10)];
  const sameReturn =
    opts.expect.returnPct === null ||
    (typeof retCell === "number" && Math.abs(retCell - opts.expect.returnPct) < 1e-4);
  if (open !== opts.expect.openDate || !sameReturn) {
    throw new Error(
      `Row ${row} of "${tab}" no longer holds this trade (the sheet has changed since the last sync). ` +
        "Nothing was written. Sync the sheet and try again.",
    );
  }

  const data: { range: string; values: (string | number)[][] }[] = [];
  const put = (col: number, v: string | number) => data.push({ range: `'${tab}'!${COL(col)}${row}`, values: [[v]] });
  const e = opts.edit;
  if (e.openDate !== undefined) put(map.open, mdY(e.openDate));
  if (e.closeDate !== undefined) put(map.close, mdY(e.closeDate));
  if (e.entryPrice !== undefined) put(map.entry, e.entryPrice);
  if (e.exitPrice !== undefined) put(map.exit, e.exitPrice);
  if (e.returnPct !== undefined && map.ret !== null) put(map.ret, Number(e.returnPct.toFixed(6)));
  if (data.length === 0) return;
  await call(tk, `${opts.sheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
}
