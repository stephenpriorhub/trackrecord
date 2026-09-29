/**
 * A position's TOTAL return — what the idea actually earned, realized and
 * unrealized together.
 *
 * WHY THIS EXISTS
 *   `cachedReturnPct` answers a narrower question: while any leg is still open
 *   it marks the WHOLE position at the current price, so a position that sold
 *   half at +200% and still holds the rest reports only the remainder's move.
 *   That is the right figure for the "% Change" beside an open row's current
 *   price, and the wrong one for a headline. The embed made it worse by
 *   averaging one row per exit plus the open remainder, so a position scaled
 *   out in thirds counted three times.
 *
 *   Here each leg is valued per unit as the quantity-weighted blend of what was
 *   sold (at the average exit) and what is still held (at the mark):
 *
 *     leg value = (closedQty × wavgExit + openQty × mark) / (closedQty + openQty)
 *
 *   and the position's return is that value against its entry basis, on the
 *   same signed, per-unit footing as recomputePosition(). A fully open position
 *   gives exactly cachedReturnPct; a fully closed one gives exactly its realized
 *   return. Only the partially closed case differs, and that is the fix.
 *
 * Null — never zero — when any part cannot be valued. An illiquid remainder
 * must not publish a loss, and a blend with a hole in it is not a total.
 */
import { dec, fraction, type D } from "../money";
import { freshPrice } from "./price-freshness";

export interface TotalReturnLeg {
  side: string;
  ratio: number;
  openQty: number;
  closedQty: number;
  wavgExit: unknown;
  instrument: {
    lastPrice: unknown;
    manualPrice: unknown;
    lastPriceAt?: Date | null;
    priceSource?: string | null;
  };
}

export interface TotalReturnPosition {
  cachedEntryPrice: unknown;
  legs: TotalReturnLeg[];
}

/** The Prisma `select` that loads exactly what totalReturn() reads. */
export const TOTAL_RETURN_SELECT = {
  cachedEntryPrice: true,
  legs: {
    select: {
      side: true,
      ratio: true,
      openQty: true,
      closedQty: true,
      wavgExit: true,
      instrument: {
        select: { lastPrice: true, manualPrice: true, lastPriceAt: true, priceSource: true },
      },
    },
  },
} as const;

function d(v: unknown): D | null {
  return v === null || v === undefined ? null : dec(v.toString());
}

export function totalReturn(p: TotalReturnPosition): D | null {
  const entry = d(p.cachedEntryPrice);
  if (!entry || entry.isZero() || p.legs.length === 0) return null;

  let value = dec(0);
  for (const leg of p.legs) {
    const total = leg.openQty + leg.closedQty;
    if (total <= 0) continue;

    let legValue = dec(0);
    if (leg.closedQty > 0) {
      const exit = d(leg.wavgExit);
      if (!exit) return null;
      legValue = legValue.plus(exit.times(leg.closedQty));
    }
    if (leg.openQty > 0) {
      // Same mark ladder as recomputePosition: live beats manual.
      // Same ladder as recomputePosition, stale prices included (price-freshness.ts).
      const mark = d(freshPrice(leg.instrument)) ?? d(leg.instrument.manualPrice);
      if (!mark) return null;
      legValue = legValue.plus(mark.times(leg.openQty));
    }

    const sign = leg.side === "BUY" ? 1 : -1;
    const ratio = leg.ratio > 0 ? leg.ratio : 1;
    value = value.plus(legValue.div(total).times(sign).times(ratio));
  }

  return fraction(value.minus(entry), entry.abs());
}

/** True when some of the position has been sold and some is still held. */
export function isPartiallyClosed(p: { legs: { openQty: number; closedQty: number }[] }): boolean {
  return (
    p.legs.some((l) => l.openQty > 0) && p.legs.some((l) => l.closedQty > 0)
  );
}
