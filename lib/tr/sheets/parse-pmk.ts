/**
 * Post-Market Profits — "Since Inception" tab, one row per closed trade.
 *
 * Columns: 0 Name  1 Symbol  2 Weight  3 Adj. Weight  4 Open Date  5 Open Price
 *          6 Close Date  7 Close Price  8 Gain % (I — what Stats counts)
 *          9 Total Gain %  10 Hold Period  11 weighted gain
 *
 * Two trade types (Stephen, 2026-10-24): Dark Ticker and Stock Flips. The sheet
 * keeps the flips on their own "Stock Flips" tab as well as in Since
 * Inception, so a Since Inception row is a flip when the same contract opened
 * the same day appears there; everything else is Dark Ticker.
 */
import type { Workbook } from "./workbook";
import { num, txt, ymd } from "./workbook";
import { type ParseResult, describe, fmtStrike, parseSheetOcc } from "./types";

const TAB = "Since Inception";
const FLIPS = "Stock Flips";
const C = { name: 0, symbol: 1, adjWeight: 3, open: 4, openPx: 5, close: 6, closePx: 7, gain: 8, hold: 10 } as const;

const flipKey = (symbol: string, open: string | null) => `${symbol.toUpperCase()}@${open}`;

export function parsePostMarket(wb: Workbook): ParseResult {
  const out: ParseResult = { trades: [], skipped: [] };
  const rows = wb.rows(TAB);
  if (!rows) throw new Error(`Post-Market Profits sheet has no "${TAB}" tab`);

  const flips = new Set<string>();
  for (const r of (wb.rows(FLIPS) ?? []).slice(1)) {
    const s = txt(r[C.symbol]);
    if (s) flips.add(flipKey(s, ymd(r[C.open])));
  }

  rows.forEach((r, i) => {
    const n = i + 1;
    if (n === 1) return;
    const gain = num(r[C.gain]);
    if (gain === null) return;
    const symbol = txt(r[C.symbol]).toUpperCase();
    const open = ymd(r[C.open]);
    if (!open) {
      out.skipped.push({ tab: TAB, row: n, symbol, reason: "no open date" });
      return;
    }
    const o = parseSheetOcc(symbol);
    const base = o
      ? {
          underlying: o.underlying,
          assetType: "OPTION" as const,
          structure: "SINGLE" as const,
          optionType: o.right,
          strike: fmtStrike(o.strike),
          expiry: o.expiry,
        }
      : {
          underlying: symbol,
          assetType: "STOCK" as const,
          structure: "STOCK" as const,
          optionType: null,
          strike: null,
          expiry: null,
        };
    out.trades.push({
      serviceCode: "PMK",
      tab: TAB,
      row: n,
      portfolio: flips.has(flipKey(symbol, open)) ? "stock-flips" : "dark-ticker",
      guru: "Bryan Bottarelli",
      name: symbol ? describe(base) : txt(r[C.name]),
      symbol: symbol || txt(r[C.name]),
      ...base,
      side: "LONG",
      status: "CLOSED",
      openDate: open,
      closeDate: ymd(r[C.close]),
      closeAfterBell: false,
      entryPrice: num(r[C.openPx]),
      exitPrice: num(r[C.closePx]),
      returnPct: gain,
      weight: num(r[C.adjWeight]) ?? 1,
      premiumCapture: null,
      holdDays: num(r[C.hold]),
      notes: null,
    });
  });
  return out;
}
