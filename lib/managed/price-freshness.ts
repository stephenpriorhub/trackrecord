/**
 * When is an exchange price too old to publish a return on?
 *
 * WHY
 *   Massive's "latest" price for a thinly traded listing can be months old.
 *   Samsung's OTC line (SSNLF) had a last trade on 2026-05-04; Musk Stampede
 *   bought it on 2026-09-02 and published +10.53% — a September entry against
 *   a May print, which means nothing. It also dragged every embed's "Current
 *   price last updated" line back to May.
 *
 * THE RULE (Stephen, 2026-09-29: Massive's data, "daily is actually okay")
 *   An exchange price (LAST_TRADE / PREV_CLOSE) older than STALE_AFTER_DAYS is
 *   treated exactly like a missing price: no mark, no return ("—"), and it is
 *   left out of the freshness stamp. Four days covers a weekend plus a Monday
 *   holiday, so an ordinary daily close is always usable.
 *
 *   Not applied to NAV (an interval fund publishes on its own schedule), to
 *   MANUAL (an editor-entered price is deliberately static), or to a price
 *   with no timestamp at all (options) — there is nothing to judge.
 */
export const STALE_AFTER_DAYS = 4;

interface PricedInstrument {
  lastPrice: unknown;
  lastPriceAt?: Date | null;
  priceSource?: string | null;
}

export function isStale(i: PricedInstrument, now: Date = new Date()): boolean {
  if (i.lastPrice === null || i.lastPrice === undefined) return false;
  if (i.priceSource !== "LAST_TRADE" && i.priceSource !== "PREV_CLOSE") return false;
  if (!i.lastPriceAt) return false;
  return now.getTime() - i.lastPriceAt.getTime() > STALE_AFTER_DAYS * 86_400_000;
}

/** The provider price if it is fresh enough to publish, else null. */
export function freshPrice<T extends PricedInstrument>(i: T, now: Date = new Date()): T["lastPrice"] | null {
  return isStale(i, now) ? null : i.lastPrice;
}
