/**
 * The War Room sheet — "Since Inception" tab, one row per closed position.
 *
 * Columns (0-based), as the sheet's Summary Stats formulas read them:
 *   0 Trade Group   1 Position Type   2 Status   3 Airtable form links
 *   4 Name   5 Symbol(s)   6 Weight   7 Adj. Weight   8 Open Date   9 Open Price
 *   12 Close Date   13 Close Price   16 Gain % (Q)   17 Weighted (R)
 *   20 Premium Capture   21 Hold Period (V)   22 Notes   26 B/K (AA)
 *
 * Gain % is taken verbatim — it is what the sheet's averages are built from.
 * B/K is the owner: Bryan and Karim never share a position.
 */
import type { Workbook } from "./workbook";
import { num, txt, ymd } from "./workbook";
import {
  type ParseResult,
  type ParsedTrade,
  type Structure,
  describe,
  fmtStrike,
  parseSheetOcc,
} from "./types";

const TAB = "Since Inception";
const C = {
  group: 0, ptype: 1, status: 2, name: 4, symbol: 5, adjWeight: 7,
  open: 8, openPx: 9, close: 12, closePx: 13, gain: 16, premium: 20, hold: 21,
  notes: 22, owner: 26,
} as const;

const OWNERS: Record<string, string> = { B: "Bryan Bottarelli", K: "Karim Rahemtulla" };

export function strategy(group: string, ptype: string, isOption: boolean): string {
  const g = `${group} ${ptype}`.toLowerCase();
  if (g.includes("strangle")) return "strangles";
  if (g.includes("put sell")) return "put-sells";
  if (g.includes("hedge")) return "hedges";
  if (g.includes("insider")) return "insider";
  if (!isOption) return "stocks";
  return "options";
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/**
 * Some recent rows leave Name and Symbol blank and carry the contract only in
 * the Trade Group: "WR: RKLB 18Sep26 C65", "WR: AAPL 17Dec27 C220 C250".
 * Rebuilt into sheet-style OCC symbols so they read like every other row.
 */
export function occsFromGroup(group: string): string[] {
  // Long form: "WR: EBAY September 11, 2026 $110 Calls", "… $35 / $50 Call Spread".
  const long = /^WR:\s*([A-Z.]{1,6})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\s+(.+)$/.exec(group.trim());
  if (long) {
    const [, u, mon, d, yyyy, rest] = long;
    const mm = MONTHS[mon.toUpperCase()];
    const right = /put/i.test(rest) ? "P" : /call/i.test(rest) ? "C" : null;
    const strikes = rest.match(/\$\s*\d+(\.\d+)?/g)?.map((x) => Number(x.replace(/[$\s]/g, ""))) ?? [];
    if (!mm || !right || !strikes.length) return [];
    return strikes.map(
      (k) => `${u.replace(".", "")}${yyyy.slice(2)}${mm}${d.padStart(2, "0")}${right}${String(Math.round(k * 1000)).padStart(8, "0")}`,
    );
  }
  const m = /^WR:\s*([A-Z.]{1,6})\s+(\d{1,2})([A-Za-z]{3})(\d{2})\s+(.+)$/.exec(group.trim());
  if (!m) return [];
  const [, u, d, mon, yy, rest] = m;
  const mm = MONTHS[mon.toUpperCase()];
  if (!mm) return [];
  const legs = rest.match(/[CP]\d+(\.\d+)?/g) ?? [];
  return legs.map((leg) => {
    const strike = Math.round(Number(leg.slice(1)) * 1000);
    return `${u.replace(".", "")}${yy}${mm}${d.padStart(2, "0")}${leg[0]}${String(strike).padStart(8, "0")}`;
  });
}

export function parseWarRoom(wb: Workbook): ParseResult {
  const out: ParseResult = { trades: [], skipped: [] };
  const rows = wb.rows(TAB);
  if (!rows) throw new Error(`War Room sheet has no "${TAB}" tab`);

  rows.forEach((r, i) => {
    const n = i + 1;
    if (n === 1) return;
    // Some rows put the symbol in Name, or only in the Trade Group.
    const nameCell = txt(r[C.name]).toUpperCase();
    const nameIsSymbol = /^[A-Z.]{1,6}(\d{6}[CP]\d+)?(\s*,\s*[A-Z.]{1,6}\d{6}[CP]\d+)*$/.test(nameCell);
    const symbolRaw =
      txt(r[C.symbol]).toUpperCase() ||
      (nameIsSymbol ? nameCell : "") ||
      occsFromGroup(txt(r[C.group])).join(", ") ||
      // "WR: SMMT" — a stock position named only by its group.
      (/^WR:\s*([A-Z.]{1,6})$/.exec(txt(r[C.group]))?.[1] ?? "");
    const gain = num(r[C.gain]);
    const open = ymd(r[C.open]);
    if (!symbolRaw && gain === null) return; // blank / spacer row
    if (gain === null) {
      out.skipped.push({ tab: TAB, row: n, symbol: symbolRaw, reason: "no Gain %" });
      return;
    }
    if (!open) {
      out.skipped.push({ tab: TAB, row: n, symbol: symbolRaw, reason: "no open date" });
      return;
    }

    const legs = symbolRaw.split(/[,\s]+/).filter(Boolean);
    const occs = legs.map(parseSheetOcc);
    const allOptions = legs.length > 0 && occs.every(Boolean);
    const group = txt(r[C.group]);
    const ptype = txt(r[C.ptype]);
    const portfolio = strategy(group, ptype, allOptions);

    let structure: Structure;
    let optionType: "CALL" | "PUT" | null = null;
    let strike: string | null = null;
    let expiry: string | null = null;
    let underlying = legs[0] ?? "";
    let side: "LONG" | "SHORT" = "LONG";

    if (allOptions) {
      const o = occs as NonNullable<(typeof occs)[number]>[];
      underlying = o[0].underlying;
      expiry = o[0].expiry;
      const rights = new Set(o.map((x) => x.right));
      strike = [...new Set(o.map((x) => fmtStrike(x.strike)))].join(" / ");
      if (portfolio === "strangles" || rights.size > 1) structure = "STRANGLE";
      else if (o.length >= 3) structure = "BUTTERFLY";
      else if (o.length === 2) structure = "SPREAD";
      else if (portfolio === "put-sells") structure = "PUT_SELL";
      else structure = "SINGLE";
      if (rights.size === 1) optionType = o[0].right;
      // Put sells and strangles are opened for a credit.
      if (structure === "PUT_SELL" || portfolio === "strangles") side = "SHORT";
    } else {
      structure = "STOCK";
      underlying = underlying.replace(/[^A-Z.]/g, "");
    }

    const owner = txt(r[C.owner]).toUpperCase().trim();
    const base = {
      underlying,
      assetType: allOptions ? ("OPTION" as const) : ("STOCK" as const),
      structure,
      optionType,
      strike,
      expiry,
    };
    const trade: ParsedTrade = {
      serviceCode: "WAR",
      tab: TAB,
      row: n,
      portfolio,
      guru: OWNERS[owner] ?? null,
      name: underlying ? describe(base) : txt(r[C.name]),
      symbol: symbolRaw || txt(r[C.name]),
      ...base,
      side,
      status: "CLOSED",
      openDate: open,
      closeDate: ymd(r[C.close]),
      closeAfterBell: false,
      entryPrice: num(r[C.openPx]),
      exitPrice: num(r[C.closePx]),
      returnPct: gain,
      weight: num(r[C.adjWeight]) ?? 1,
      premiumCapture: num(r[C.premium]),
      holdDays: num(r[C.hold]),
      notes: txt(r[C.notes]) || null,
    };
    out.trades.push(trade);
  });
  return out;
}
