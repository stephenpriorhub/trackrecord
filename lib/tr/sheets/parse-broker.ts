/**
 * Daily Profits Live, Profit Surge Trader and Sector Strike — the three sheets
 * built from Nate's trading-journal export. Same layout in all three.
 *
 * A trade is every row of "Since Inception" whose Return % (column K) is a
 * number — exactly what the sheet's own Summary Stats COUNT. Verified
 * 2026-10-24: DPL 3,830 / PSU 609 / NBS 50, identical to the published table.
 *
 * Two row layouts share the tab:
 *   MAIN  — one row per trade: Status, Symbol, Size, Open/Close Date+Time,
 *           Entry/Exit, Return $, Return %, Avg Buy/Sell, Expire, Strike, Type,
 *           Side, Spread, Cost, …, Holdtime, …, Portfolio.
 *   FILL  — appended below, one row per closing fill (layout of the MTD tab):
 *           Direction, OCC Symbol, Name, Fill, Qty, Exit Date, Time, Running
 *           Position, Wavg Buy, Wavg Sell, Net Return %, Portfolio, Entry Date.
 *
 * Return % is used verbatim. The price columns are NOT a reliable basis: Entry
 * and Exit are the first and last print of a scaled trade, and Avg Buy/Sell
 * average across both legs of a spread.
 *
 * Rows stay with the workbook they are in, as the published counts do. A row
 * whose Portfolio cell names another service is kept and reported in
 * `crossLabelled` so someone can fix the sheet.
 */
import type { Row, Workbook } from "./workbook";
import { hourOf, num, txt, ymd } from "./workbook";
import {
  type ParseResult,
  type ParsedTrade,
  type Structure,
  describe,
  fmtStrike,
  parseSheetOcc,
} from "./types";

const M = {
  status: 0, symbol: 1, size: 2, open: 3, close: 4, closeTime: 6, entry: 7,
  exit: 8, ret: 10, avgBuy: 11, avgSell: 12, expiry: 14, strike: 15, type: 16,
  side: 17, spread: 18, cost: 19, hold: 21, portfolio: 23,
} as const;
const F = {
  occ: 1, closeDate: 5, closeTime: 6, wavgBuy: 8, wavgSell: 9, ret: 10,
  portfolio: 11, openDate: 12, duration: 21,
} as const;

const OWN_LABELS: Record<string, string[]> = {
  DPL: ["daily profits live", "dpl"],
  PSU: ["profit surge trader", "psu"],
  NBS: ["sector strike", "ss", "nbs"],
};

export interface BrokerParseResult extends ParseResult {
  crossLabelled: { row: number; symbol: string; label: string }[];
  /** Taken from a period tab because Since Inception does not have it yet. */
  pending: { row: number; tab: string; symbol: string }[];
}

function structureOf(spread: string, side: string): Structure {
  const s = spread.toUpperCase();
  if (s.includes("BUTTERFLY")) return "BUTTERFLY";
  if (s.includes("STRANGLE") || s.includes("STRADDLE")) return "STRANGLE";
  if (s && s !== "SINGLE") return "SPREAD";
  return side === "SHORT" ? "PUT_SELL" : "SINGLE";
}

function strikeText(v: Row[number]): string | null {
  const n = num(v);
  if (n !== null) return fmtStrike(n);
  const s = txt(v);
  if (!s) return null;
  const parts = s.match(/[\d,]+(\.\d+)?/g)?.map((p) => fmtStrike(Number(p.replace(/,/g, ""))));
  return parts?.length ? parts.join(" / ") : null;
}

function mainRow(code: string, tab: string, r: Row, n: number, portfolio: string): ParsedTrade | string {
  const symbol = txt(r[M.symbol]).toUpperCase();
  const open = ymd(r[M.open]);
  const close = ymd(r[M.close]);
  if (!open) return "no open date";
  const ret = num(r[M.ret])!;

  const typeRaw = txt(r[M.type]).toUpperCase();
  const isStock = ["SHARE", "SHARES", "STOCK"].includes(typeRaw);
  const optionType: "CALL" | "PUT" | null = typeRaw === "CALL" ? "CALL" : typeRaw === "PUT" ? "PUT" : null;
  const sideRaw = txt(r[M.side]).toUpperCase();
  const spread = txt(r[M.spread]);
  const structure: Structure = isStock ? "STOCK" : structureOf(spread, sideRaw);
  const multiLeg = structure === "SPREAD" || structure === "BUTTERFLY" || structure === "STRANGLE";

  // Entry: the per-contract cost basis where the sheet gives one (exact for
  // spreads), else the single-leg average, else the first print.
  const size = num(r[M.size]) ?? 1;
  const cost = num(r[M.cost]);
  const mult = isStock ? 1 : 100;
  let entry =
    cost && size ? cost / (size * mult) : null;
  if (!entry || entry <= 0) entry = (!multiLeg && num(r[M.avgBuy])) || num(r[M.entry]);
  const exit = entry ? entry * (1 + ret) : num(r[M.exit]);

  const base = {
    underlying: symbol,
    assetType: isStock ? ("STOCK" as const) : ("OPTION" as const),
    structure,
    optionType,
    strike: isStock ? null : strikeText(r[M.strike]),
    expiry: isStock ? null : ymd(r[M.expiry]),
  };
  const ch = hourOf(r[M.closeTime]);
  return {
    serviceCode: code,
    tab,
    row: n,
    portfolio,
    guru: "Nate Bear",
    name: describe(base),
    symbol,
    ...base,
    side: sideRaw === "SHORT" ? "SHORT" : "LONG",
    status: "CLOSED",
    openDate: open,
    closeDate: close,
    closeAfterBell: ch !== null && ch >= 16,
    entryPrice: entry ?? null,
    exitPrice: exit ?? null,
    returnPct: ret,
    weight: 1,
    premiumCapture: null,
    holdDays: num(r[M.hold]),
    notes: null,
  };
}

function fillRow(code: string, tab: string, r: Row, n: number, portfolio: string): ParsedTrade | string {
  const occRaw = txt(r[F.occ]).toUpperCase();
  const o = parseSheetOcc(occRaw);
  if (!o) return "unreadable option symbol";
  const open = ymd(r[F.openDate]);
  if (!open) return "no open date";
  const ret = num(r[F.ret])!;
  const entry = num(r[F.wavgBuy]);
  const base = {
    underlying: o.underlying,
    assetType: "OPTION" as const,
    structure: "SINGLE" as const,
    optionType: o.right,
    strike: fmtStrike(o.strike),
    expiry: o.expiry,
  };
  const ch = hourOf(r[F.closeTime]);
  return {
    serviceCode: code,
    tab,
    row: n,
    portfolio,
    guru: "Nate Bear",
    name: describe(base),
    symbol: occRaw,
    ...base,
    side: "LONG",
    status: "CLOSED",
    openDate: open,
    closeDate: ymd(r[F.closeDate]),
    closeAfterBell: ch !== null && ch >= 16,
    entryPrice: entry,
    exitPrice: entry ? entry * (1 + ret) : num(r[F.wavgSell]),
    returnPct: ret,
    weight: 1,
    premiumCapture: null,
    holdDays: num(r[F.duration]),
    notes: null,
  };
}

/**
 * Identity of a closed trade across tabs: the same trade is a MAIN row in
 * Since Inception and a FILL row in MTD, so the key uses only what both carry.
 */
export function crossTabKey(t: ParsedTrade): string {
  return `${t.underlying}|${t.closeDate}|${t.returnPct?.toFixed(3)}`;
}

/**
 * The period tabs, which the editors fill BEFORE a trade is copied into Since
 * Inception. Found 2026-10-24: PSU's "This Month" held six October trades and
 * its "Year to Date" one more (CAR) that Since Inception did not yet have.
 * Rows already in Since Inception are skipped; so is a row repeated within a
 * period tab (DPL's MTD listed MRNA and KNSA twice).
 */
const PERIOD_TABS: Record<string, string[]> = {
  DPL: ["This Week", "MTD", "YTD"],
  PSU: ["This Month", "Year to Date"],
  NBS: ["MTD", "YTD"],
};

function parseTab(
  code: string,
  wb: Workbook,
  tab: string,
  portfolio: string,
  out: BrokerParseResult,
  onlyNew?: Set<string>,
): void {
  const rows = wb.rows(tab);
  if (!rows) return;
  const own = OWN_LABELS[code] ?? [];
  rows.forEach((raw, i) => {
    const n = i + 1;
    if (n === 1) return;
    const r = [...raw, ...Array(40).fill(null)] as Row;
    if (num(r[M.ret]) === null) return; // not counted by the sheet either
    const isFill = parseSheetOcc(txt(r[F.occ])) !== null;
    const rec = isFill ? fillRow(code, tab, r, n, portfolio) : mainRow(code, tab, r, n, portfolio);
    if (typeof rec === "string") {
      if (!onlyNew) out.skipped.push({ tab, row: n, symbol: txt(r[1]), reason: rec });
      return;
    }
    if (onlyNew) {
      const k = crossTabKey(rec);
      if (onlyNew.has(k)) return;
      onlyNew.add(k);
      out.pending.push({ row: n, tab, symbol: rec.symbol });
    }
    const label = txt(isFill ? r[F.portfolio] : r[M.portfolio]);
    if (label && !own.includes(label.toLowerCase())) {
      out.crossLabelled.push({ row: n, symbol: rec.symbol, label });
    }
    out.trades.push(rec);
  });
}

export function parseBrokerSheet(code: "DPL" | "PSU" | "NBS", wb: Workbook): BrokerParseResult {
  const out: BrokerParseResult = { trades: [], skipped: [], crossLabelled: [], pending: [] };
  if (!wb.rows("Since Inception")) throw new Error(`${code} sheet has no "Since Inception" tab`);
  parseTab(code, wb, "Since Inception", "main", out);
  const seen = new Set(out.trades.map(crossTabKey));
  for (const tab of PERIOD_TABS[code] ?? []) parseTab(code, wb, tab, "main", out, seen);
  // DPL's SPX/NDX lotto trades (since 1/16/26) live on their own tab and are
  // published separately from DPL's stats.
  if (code === "DPL") parseTab(code, wb, "SPXNDX Trades", "spx-lotto", out);
  return out;
}
