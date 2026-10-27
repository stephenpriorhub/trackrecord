/**
 * Open positions come from Airtable; closed trades come from the sheets.
 * Stephen, 2026-10-27: "once they are closed the airtable position is closed
 * and the numbers we use are from spreadsheet".
 *
 * So every sync:
 *   1. reads the service's OPEN Airtable positions (with their trades),
 *   2. pairs each sheet close that matched one of them with the closing
 *      trades Airtable already has (same position, close date within 3 days),
 *   3. for every sheet close Airtable doesn't have yet, adds the closing trade
 *      to Airtable at the SHEET's date and exit price, linked to the opening
 *      trade ("Closes") — Airtable's own formulas then mark the position
 *      closed,
 *   4. publishes what's still open as OPEN rows beside the sheet's trades.
 *
 * Safety:
 *   - Writes only when TR_AIRTABLE_CLOSE=live. Otherwise the plan is computed
 *     and shown on the status page, nothing is sent.
 *   - Adds trades, never edits or deletes one.
 *   - Skips (and lists for a person) anything it can't close cleanly: a
 *     multi-leg position (the sheet holds one net price, Airtable one per
 *     leg), an entry price that disagrees with the sheet's by more than 35%
 *     (probably not the same trade), or several unrecorded partial exits on a
 *     service whose sheet has no position weights.
 *   - Idempotent: the next run pairs the trade it just added with its sheet
 *     row, so nothing is ever closed twice.
 */
import { AIRTABLE_TO_PUB_CODE } from "../publications";
import { fetchTradeGroupNames } from "../managed/import";
import { serviceByCode } from "./services";
import { strategy } from "./sheets/parse-war";
import { TREND_ADVISORY_START } from "./sheets/parse-tpu";
import { describe, fmtStrike, parseSheetOcc, type ParsedTrade } from "./sheets/types";

const BASE = process.env.AIRTABLE_PORTFOLIO_BASE ?? "appnWWpR52p6T38EU";
const POSITIONS = "tbldV1JfYJoqZIoMk";
const TRADES = "tblOdJSYE9OFowuTY";
const DAY = 86_400_000;
const PAIR_WINDOW_DAYS = 3;
const ENTRY_TOLERANCE = 0.35;

export const autoCloseLive = () => process.env.TR_AIRTABLE_CLOSE === "live";

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Airtable records */
async function at(method: "GET" | "POST", table: string, query: URLSearchParams | null, body?: unknown): Promise<any> {
  const url = `https://api.airtable.com/v0/${BASE}/${table}${query ? `?${query}` : ""}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    // 5 requests/second per base; back off and retry a throttle.
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Airtable ${method} ${table}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
}

async function list(table: string, formula: string, fields: string[]): Promise<any[]> {
  const out: any[] = [];
  let offset: string | undefined;
  do {
    const q = new URLSearchParams({ filterByFormula: formula });
    for (const f of fields) q.append("fields[]", f);
    if (offset) q.set("offset", offset);
    const page = await at("GET", table, q);
    out.push(...page.records);
    offset = page.offset;
  } while (offset);
  return out;
}

const first = (v: any) => (Array.isArray(v) ? v[0] : v);
const numOr = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ymd = (v: any): string | null => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
const dayNum = (s: string) => Date.parse(`${s}T00:00:00Z`) / DAY;

// ---- reading ------------------------------------------------------------------

export interface AtTrade {
  id: string;
  symbol: string;
  intent: "OPEN" | "CLOSE";
  action: string;
  date: string | null;
  price: number | null;
  /** Opening trades: weight still open. */
  netOpen: number;
  weight: number;
  investmentType: string | null;
  underlying: string | null;
  optionType: string | null;
  strike: number | null;
  expiry: string | null;
  tradeName: string | null;
}

export interface AtOpenPosition {
  id: string;
  name: string;
  openDate: string;
  symbols: string[];
  netOpenPrice: number | null;
  currentPrice: number | null;
  returnPct: number | null;
  netOpenWeight: number;
  side: "LONG" | "SHORT";
  guru: string | null;
  tradeGroup: string | null;
  trades: AtTrade[];
}

const POSITION_FIELDS = [
  "Position Name", "Open Date", "Associated Symbols", "Associated Trades", "Net Open Price",
  "Current Price", "Position Return", "Weights: Net Open Weight (Opening-Closing)", "Long/Short",
  "Reporting Guru(s)", "Trade Group", "Open/Closed?",
];
const TRADE_FIELDS = [
  "SYMBOL", "To Open or Close", "Action", "Trade Date", "Trade Price", "Net Open Weight", "Weight",
  "Weight: Effective", "Investment Type", "Underlying Symbol", "Option Type", "Option Strike Price",
  "Option Expiration Date", "Trade Name", "Parent Position", "Waiting for Fill?",
];

function toTrade(r: any): AtTrade | null {
  const f = r.fields;
  if (f["Waiting for Fill?"]) return null;
  const io = String(first(f["To Open or Close"]) ?? "").toLowerCase();
  return {
    id: r.id,
    symbol: String(f["SYMBOL"] ?? "").trim().toUpperCase(),
    intent: io === "close" ? "CLOSE" : "OPEN",
    action: String(first(f["Action"]) ?? ""),
    date: ymd(f["Trade Date"]),
    price: numOr(f["Trade Price"]),
    netOpen: numOr(f["Net Open Weight"]) ?? 0,
    weight: numOr(f["Weight: Effective"]) ?? numOr(f["Weight"]) ?? 1,
    investmentType: first(f["Investment Type"]) ?? null,
    underlying: f["Underlying Symbol"] ?? null,
    optionType: first(f["Option Type"]) ?? null,
    strike: numOr(f["Option Strike Price"]),
    expiry: ymd(f["Option Expiration Date"]),
    tradeName: f["Trade Name"] ?? null,
  };
}

/** The publication's open Airtable positions, trades attached. */
export async function loadOpenPositions(code: string): Promise<AtOpenPosition[]> {
  const atCode = Object.keys(AIRTABLE_TO_PUB_CODE).find((k) => AIRTABLE_TO_PUB_CODE[k] === code) ?? code;
  const rows = await list(
    POSITIONS,
    `AND({Open/Closed?}="Open", ARRAYJOIN({Pub Code (from Portfolio)})="${atCode}")`,
    POSITION_FIELDS,
  );
  if (!rows.length) return [];

  const groups = code === "WAR" ? await fetchTradeGroupNames() : null;
  const tradeIds = rows.flatMap((r) => (r.fields["Associated Trades"] ?? []) as string[]);
  const trades = new Map<string, AtTrade>();
  for (let i = 0; i < tradeIds.length; i += 40) {
    const ids = tradeIds.slice(i, i + 40);
    const recs = await list(TRADES, `OR(${ids.map((id) => `RECORD_ID()="${id}"`).join(",")})`, TRADE_FIELDS);
    for (const r of recs) {
      const t = toTrade(r);
      if (t) trades.set(r.id, t);
    }
  }

  return rows.flatMap((r): AtOpenPosition[] => {
    const f = r.fields;
    const open = ymd(f["Open Date"]);
    if (!open) return [];
    const ts = ((f["Associated Trades"] ?? []) as string[]).map((id) => trades.get(id)).filter((t): t is AtTrade => !!t);
    const gid = first(f["Trade Group"]);
    // Opened by selling (put sells, strangles) = short, whatever "Long/Short" says.
    const opens = ts.filter((t) => t.intent === "OPEN");
    const sold = opens.length > 0 && opens.every((t) => t.action.toLowerCase() === "sell");
    return [{
      id: r.id,
      name: String(f["Position Name"] ?? r.id),
      openDate: open,
      symbols: ((f["Associated Symbols"] ?? []) as string[]).map((s) => String(s).toUpperCase()),
      netOpenPrice: numOr(f["Net Open Price"]),
      currentPrice: numOr(f["Current Price"]),
      returnPct: numOr(f["Position Return"]),
      netOpenWeight: numOr(f["Weights: Net Open Weight (Opening-Closing)"]) ?? 0,
      side: sold || String(f["Long/Short"] ?? "").toLowerCase() === "short" ? "SHORT" : "LONG",
      guru: String(f["Reporting Guru(s)"] ?? "").split(",")[0].trim() || null,
      tradeGroup: gid && groups ? (groups.get(gid)?.name ?? null) : null,
      trades: ts,
    }];
  });
}

// ---- planning closes ------------------------------------------------------------

export type PlannedClose = {
  positionId: string;
  positionName: string;
  openTradeId: string;
  symbol: string;
  closeDate: string;
  exitPrice: number;
  weight: number;
  action: string;
  /** The sheet row it comes from. */
  sheet: string;
  fields: Record<string, unknown>;
};

export type ManualClose = {
  positionId: string;
  positionName: string;
  sheet: string;
  reason: string;
};

export interface ClosePlan {
  closes: PlannedClose[];
  manual: ManualClose[];
  /** Positions the plan closes in full — left out of the open list. */
  closing: Set<string>;
}

/** 4:00pm New York on a date, as an ISO timestamp. */
function marketClose(date: string): string {
  const probe = new Date(`${date}T20:00:00Z`);
  const nyHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(probe));
  return new Date(probe.getTime() + (16 - nyHour) * 3_600_000).toISOString();
}

const sheetRef = (t: ParsedTrade) => `${t.tab} row ${t.row}`;

const EXIT_ACTIONS = new Set(["sell", "buy", "expire", "exercise", "assigned", "assignment"]);

const contract = (sym: string) => {
  const o = parseSheetOcc(sym);
  return o ? `${o.underlying}|${o.expiry}|${o.right}|${o.strike}` : null;
};

/** The sheet row and the Airtable leg are the same option contract, or the same stock. */
function sameInstrument(r: ParsedTrade, atSymbol: string): boolean {
  const k = contract(atSymbol);
  if (!k) return r.assetType === "STOCK" && r.underlying === atSymbol.replace(/[^A-Z]/g, "");
  return r.symbol.split(/[,\s]+/).some((s) => contract(s) === k);
}

export function planCloses(code: string, positions: AtOpenPosition[], sheetTrades: { trade: ParsedTrade; airtableId: string | null }[]): ClosePlan {
  const plan: ClosePlan = { closes: [], manual: [], closing: new Set() };
  const weighted = !!serviceByCode(code)?.weighted;
  const byId = new Map(positions.map((p) => [p.id, p]));
  const rowsFor = new Map<string, ParsedTrade[]>();
  for (const { trade, airtableId } of sheetTrades) {
    if (!airtableId || trade.status !== "CLOSED" || !trade.closeDate || !byId.has(airtableId)) continue;
    // A bundled archive is history, not news: it never closes anything.
    if (trade.tab.startsWith("Archive")) continue;
    if (!rowsFor.has(airtableId)) rowsFor.set(airtableId, []);
    rowsFor.get(airtableId)!.push(trade);
  }

  for (const [id, rows] of rowsFor) {
    const p = byId.get(id)!;
    rows.sort((a, b) => a.closeDate!.localeCompare(b.closeDate!));

    // Sheet closes Airtable already has.
    // Dividends ("Distribution") sit on the close side but aren't exits.
    const atCloses = p.trades.filter((t) => t.intent === "CLOSE" && t.date && EXIT_ACTIONS.has(t.action.toLowerCase()));
    const unpaired = rows.filter((r) => {
      const i = atCloses.findIndex((c) => Math.abs(dayNum(c.date!) - dayNum(r.closeDate!)) <= PAIR_WINDOW_DAYS);
      if (i < 0) return true;
      atCloses.splice(i, 1);
      return false;
    });
    if (!unpaired.length) continue;

    const opens = p.trades.filter((t) => t.intent === "OPEN" && t.netOpen > 1e-9);
    const legs = new Set(opens.map((t) => t.symbol));
    const manual = (reason: string) => plan.manual.push({ positionId: id, positionName: p.name, sheet: unpaired.map(sheetRef).join(", "), reason });
    if (!opens.length) {
      manual("Airtable shows it open but none of its opening trades has weight left.");
      continue;
    }
    if (legs.size > 1) {
      manual(`Multi-leg position (${legs.size} legs). The sheet has one net exit price, so each leg needs closing by hand.`);
      continue;
    }
    // The sync's match is deliberately loose (it only links a row to
    // Airtable for reference). Closing needs the very same contract — the
    // same ticker opened the same day is often a different strike or expiry.
    const leg = [...legs][0];
    const same = rows.filter((r) => sameInstrument(r, leg));
    if (same.length < rows.length) {
      const other = rows.find((r) => !sameInstrument(r, leg))!;
      plan.manual.push({
        positionId: id,
        positionName: p.name,
        sheet: sheetRef(other),
        reason: `Sheet ${other.symbol} isn't Airtable's ${leg}. Not closed; check which one is right.`,
      });
      continue;
    }
    const entry = rows[0].entryPrice;
    const atEntry = p.netOpenPrice;
    if (entry !== null && atEntry !== null && Math.abs(atEntry) > 0 &&
        Math.abs(Math.abs(entry) - Math.abs(atEntry)) / Math.abs(atEntry) > ENTRY_TOLERANCE) {
      manual(`Entry price differs: sheet ${Math.abs(entry)}, Airtable ${Math.abs(atEntry)}. Check it is the same trade.`);
      continue;
    }
    if (!weighted && unpaired.length > 1) {
      manual(`${unpaired.length} exits in the sheet that Airtable doesn't have, and this sheet has no position weights to split them by.`);
      continue;
    }

    // Close against the opening trades in order, oldest first.
    const queue = opens.map((o) => ({ ...o, left: o.netOpen }));
    let left = queue.reduce((a, o) => a + o.left, 0);
    for (const r of unpaired) {
      if (left <= 1e-9) break;
      const last = r === unpaired[unpaired.length - 1];
      let want = weighted ? Math.min(r.weight, left) : left;
      if (r.exitPrice === null) {
        manual(`The sheet has no exit price for ${sheetRef(r)}.`);
        break;
      }
      while (want > 1e-9 && queue.length) {
        const o = queue[0];
        const w = Math.min(want, o.left);
        const exit = Number(Math.abs(r.exitPrice).toFixed(4));
        const expired = exit === 0 && !!o.expiry && r.closeDate! >= o.expiry;
        const shortSide = o.action.toLowerCase() === "sell";
        const action = expired ? "Expire" : shortSide ? "Buy" : "Sell";
        plan.closes.push({
          positionId: id,
          positionName: p.name,
          openTradeId: o.id,
          symbol: o.symbol,
          closeDate: r.closeDate!,
          exitPrice: exit,
          weight: Number(w.toFixed(6)),
          action,
          sheet: sheetRef(r),
          fields: {
            "Parent Position": [id],
            Closes: [o.id],
            SYMBOL: o.symbol,
            "To Open or Close": "Close",
            Action: action,
            "Trade Price": exit,
            "Trade Date": marketClose(r.closeDate!),
            Weight: Number(w.toFixed(6)),
            ...(o.investmentType ? { "Investment Type": o.investmentType } : {}),
            ...(o.underlying ? { "Underlying Symbol": o.underlying } : {}),
            ...(o.optionType ? { "Option Type": o.optionType } : {}),
            ...(o.strike !== null ? { "Option Strike Price": o.strike } : {}),
            ...(o.expiry ? { "Option Expiration Date": o.expiry } : {}),
            ...(o.tradeName ? { "Trade Name": o.tradeName } : {}),
          },
        });
        o.left -= w;
        want -= w;
        left -= w;
        if (o.left <= 1e-9) queue.shift();
      }
      if (last && left <= 1e-9) plan.closing.add(id);
    }
  }
  return plan;
}

/** Sends the planned closing trades. Returns the ones Airtable accepted. */
export async function sendCloses(closes: PlannedClose[]): Promise<{ sent: (PlannedClose & { tradeId: string })[]; error: string | null }> {
  const sent: (PlannedClose & { tradeId: string })[] = [];
  for (let i = 0; i < closes.length; i += 10) {
    const batch = closes.slice(i, i + 10);
    try {
      const res = await at("POST", TRADES, null, { typecast: true, records: batch.map((c) => ({ fields: c.fields })) });
      res.records.forEach((r: any, j: number) => sent.push({ ...batch[j], tradeId: r.id }));
    } catch (e) {
      return { sent, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { sent, error: null };
}

// ---- open rows ----------------------------------------------------------------------

/** Which of the service's books an open Airtable position belongs in. */
function bookFor(code: string, p: AtOpenPosition, option: boolean, underlying: string): string {
  switch (code) {
    case "WAR":
      return strategy(p.tradeGroup ?? "", p.name, option);
    case "DPL":
      return /^(SPX|SPXW|NDX|NDXP)$/.test(underlying) ? "spx-lotto" : "main";
    case "PMK":
      return option ? "dark-ticker" : "stock-flips";
    case "TPU":
      return p.openDate >= TREND_ADVISORY_START ? "trend-advisory" : "catalyst-cashouts";
    default:
      return "main";
  }
}

/** An open Airtable position as a trade row (status OPEN). */
export function openRow(code: string, p: AtOpenPosition): ParsedTrade & { currentPrice: number | null; airtableId: string } {
  const occs = p.symbols.map(parseSheetOcc).filter((o): o is NonNullable<typeof o> => !!o);
  const option = occs.length > 0;
  const underlying = occs[0]?.underlying ?? (p.symbols[0] ?? p.name.split(/\s+/)[0] ?? "").toUpperCase();
  const rights = new Set(occs.map((o) => o.right));
  const base = {
    underlying,
    assetType: option ? ("OPTION" as const) : ("STOCK" as const),
    structure: (!option ? "STOCK" : occs.length === 1 ? (p.side === "SHORT" && occs[0].right === "PUT" ? "PUT_SELL" : "SINGLE")
      : rights.size > 1 ? "STRANGLE" : occs.length >= 3 ? "BUTTERFLY" : "SPREAD") as ParsedTrade["structure"],
    optionType: option && rights.size === 1 ? occs[0].right : null,
    strike: option ? occs.map((o) => fmtStrike(o.strike)).join(" / ") : null,
    expiry: occs[0]?.expiry ?? null,
  };
  // Return worked out here, the way the sheets do it: on the debit paid, or
  // on the credit received for a sold position. Airtable's own figure
  // measures sold positions against margin, which reads near zero.
  const entry = p.netOpenPrice !== null ? Math.abs(p.netOpenPrice) : null;
  const cur = p.currentPrice !== null ? Math.abs(p.currentPrice) : null;
  const returnPct = entry && cur !== null ? (p.side === "SHORT" ? (entry - cur) / entry : cur / entry - 1) : p.returnPct;
  let portfolio = bookFor(code, p, option, underlying);
  if (code === "WAR" && base.structure === "PUT_SELL") portfolio = "put-sells";
  if (code === "WAR" && base.structure === "STRANGLE") portfolio = "strangles";
  return {
    serviceCode: code,
    tab: "Airtable",
    row: 0,
    portfolio,
    guru: p.guru,
    name: option ? describe(base) : p.name,
    symbol: p.symbols.join(" ") || p.name,
    ...base,
    side: p.side,
    status: "OPEN",
    openDate: p.openDate,
    closeDate: null,
    closeAfterBell: false,
    entryPrice: p.netOpenPrice,
    exitPrice: null,
    returnPct,
    weight: p.netOpenWeight || 1,
    premiumCapture: null,
    holdDays: Math.max(0, Math.round((Date.now() - Date.parse(`${p.openDate}T00:00:00Z`)) / DAY)),
    notes: null,
    currentPrice: p.currentPrice,
    airtableId: p.id,
  };
}
