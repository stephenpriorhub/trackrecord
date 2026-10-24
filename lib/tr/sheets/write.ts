/**
 * Write a logged trade into the service's Google Sheet — the sheet stays the
 * record; the app picks the row up on the sync that follows.
 *
 * Rows are written in the exact layout the sheet already uses, formulas
 * included, at the first row after the last filled one:
 *
 *   DPL / PSU / NBS — the closing-fill layout the recent rows use:
 *     Direction, Symbol (OCC, unpadded strike), Name ("RILY CALL"), Fill price,
 *     Quantity, Exit date, Trade time, Running position 0, Wavg buy, Wavg sell,
 *     Net return %, Portfolio code, Entry date, Entry time, … Duration (col V).
 *   PMK — Name, Symbol, Weight, Adj. weight, Open date, Open price, Close date,
 *     Close price, =H/F-1, (blank), =DAYS(G,E), =I*D/SUM(D:D). A Stock Flip is
 *     written to "Stock Flips" as well, which is how the sheet tells them apart.
 *
 * The War Room is deliberately absent: its sheet is fed from Airtable by an
 * automation (see its _airtable_sync_log tab), so a row written here would be
 * duplicated. War Room trades are logged in Airtable.
 *
 * Needs the sheet shared with the service account as Editor.
 */
import { googleAccessToken } from "../google";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface LoggedTrade {
  code: "DPL" | "PSU" | "NBS" | "PMK";
  sheetId: string;
  portfolio: string; // PMK: dark-ticker | stock-flips
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiry: string; // YYYY-MM-DD
  quantity: number;
  openDate: string;
  entryPrice: number;
  closeDate: string;
  exitPrice: number;
}

export const LOGGABLE = ["DPL", "PSU", "NBS", "PMK"] as const;

const PORTFOLIO_CELL: Record<string, string> = { DPL: "DPL", PSU: "PSU", NBS: "SS" };

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

/** First empty row after the last row with something in columns A:B. */
async function nextRow(token: string, sheetId: string, tab: string): Promise<number> {
  const range = encodeURIComponent(`'${tab}'!A:B`);
  const body = (await call(token, `${sheetId}/values/${range}?majorDimension=ROWS`)) as { values?: unknown[][] };
  return (body.values?.length ?? 0) + 1;
}

async function writeRow(token: string, sheetId: string, tab: string, row: number, values: (string | number)[]) {
  const range = encodeURIComponent(`'${tab}'!A${row}`);
  await call(token, `${sheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range: `'${tab}'!A${row}`, majorDimension: "ROWS", values: [values] }),
  });
}

export function returnOf(t: Pick<LoggedTrade, "entryPrice" | "exitPrice">): number {
  return t.exitPrice / t.entryPrice - 1;
}

export async function logTradeToSheet(t: LoggedTrade): Promise<{ tab: string; row: number }[]> {
  const token = await googleAccessToken();
  if (!token) throw new Error("No Google service account is configured on this app (GOOGLE_SERVICE_ACCOUNT_JSON).");
  const u = t.underlying.toUpperCase();
  const ret = returnOf(t);
  const written: { tab: string; row: number }[] = [];

  if (t.code === "PMK") {
    const strike1000 = String(Math.round(t.strike * 1000)).padStart(8, "0");
    const occ = `${u}${yymmdd(t.expiry)}${t.right}${strike1000}`;
    const [y, , d] = t.expiry.split("-");
    const mon = new Date(`${t.expiry}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const name = `${u} ${Number(d)}${mon}${y.slice(2)} ${t.right}${t.strike}`;
    const tabs = t.portfolio === "stock-flips" ? ["Since Inception", "Stock Flips"] : ["Since Inception"];
    for (const tab of tabs) {
      const n = await nextRow(token, t.sheetId, tab);
      await writeRow(token, t.sheetId, tab, n, [
        name, occ, t.quantity, t.quantity, mdY(t.openDate), t.entryPrice, mdY(t.closeDate), t.exitPrice,
        `=H${n}/F${n}-1`, "", `=days(G${n},E${n})`, `=I${n}*D${n}/SUM(D:D)`,
      ]);
      written.push({ tab, row: n });
    }
    return written;
  }

  const occ = `${u}${yymmdd(t.expiry)}${t.right}${Math.round(t.strike * 1000)}`;
  const tab = "Since Inception";
  const n = await nextRow(token, t.sheetId, tab);
  const row: (string | number)[] = [
    "Sell", occ, `${u} ${t.right === "C" ? "CALL" : "PUT"}`, t.exitPrice, t.quantity, mdY(t.closeDate), "",
    0, t.entryPrice, t.exitPrice, Number(ret.toFixed(4)), PORTFOLIO_CELL[t.code], mdY(t.openDate), "",
  ];
  while (row.length < 21) row.push("");
  row.push(days(t.openDate, t.closeDate));
  await writeRow(token, t.sheetId, tab, n, row);
  written.push({ tab, row: n });
  return written;
}
