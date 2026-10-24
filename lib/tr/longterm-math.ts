/**
 * Realized vs unrealized return for a long-term portfolio. Pure; no I/O.
 *
 * Built from the same rows the widgets show: one row per exit for closed
 * positions and one for the still-held remainder. Each row carries its share
 * of its position (`weight`: 0.5 for each half of a position sold in halves),
 * so a partly sold position counts once in total, split between the two.
 *
 *   Realized   = closed rows, at their exit prices.
 *   Unrealized = open rows, marked at the latest price.
 *   Total      = the portfolio's headline (lib/managed/total-return.ts),
 *                every position blended, open and closed.
 */
import type { EmbedBlock, EmbedRow } from "../managed/embed";

export interface ReturnSplit {
  realized: number | null;
  realizedCount: number;
  unrealized: number | null;
  unrealizedCount: number;
}

function weightedMean(rows: EmbedRow[]): number | null {
  let sum = 0;
  let w = 0;
  for (const r of rows) {
    if (r.unpriced || !r.returnPct) continue;
    const wt = r.weight ?? 1;
    sum += r.returnPct.toNumber() * wt;
    w += wt;
  }
  return w > 0 ? sum / w : null;
}

export function splitReturns(blocks: EmbedBlock[]): ReturnSplit {
  const closed = blocks.flatMap((b) => b.closed);
  const open = blocks.flatMap((b) => b.open);
  return {
    realized: weightedMean(closed),
    realizedCount: blocks.reduce((a, b) => a + b.closedTotal, 0),
    unrealized: weightedMean(open),
    unrealizedCount: open.length,
  };
}
