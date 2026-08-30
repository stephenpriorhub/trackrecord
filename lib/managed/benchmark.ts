/**
 * Benchmark comparison over the period a portfolio was actually held.
 *
 * THE POINT OF THIS FILE
 *   Comparing a portfolio's since-inception return against the benchmark's
 *   SESSION change puts a multi-year figure next to one day of the index, which
 *   flatters or maligns the portfolio at random. So the benchmark is measured
 *   from the earliest position open date to now — the same window the portfolio's
 *   own return covers.
 *
 *   Massive's daily aggregates give the close on any past date. Those never
 *   change once the session closes, so each (ticker, date) is fetched once and
 *   cached in BenchmarkClose permanently.
 */
import { prisma } from "../prisma";
import { dec, type D } from "../money";

const BASE = () =>
  (process.env.MASSIVE_BASE ?? "https://api.massive.com").replace(/\/+$/, "");

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The benchmark's close on a date, from cache or the provider.
 *
 * Asks for a WINDOW ending on the date rather than the single day, and takes the
 * last bar: a position opened on a weekend or a market holiday has no bar of its
 * own, and the honest comparison starts from the last session that actually
 * traded. A single-day request would simply return nothing.
 */
export async function benchmarkCloseOn(
  ticker: string,
  date: Date,
): Promise<D | null> {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  const cached = await prisma.benchmarkClose.findUnique({
    where: { ticker_date: { ticker, date: target } },
  });
  if (cached) return dec(cached.close.toString());

  const key = process.env.MASSIVE_API_KEY;
  if (!key) return null;

  // Look back far enough to clear a long holiday weekend.
  const from = new Date(target);
  from.setUTCDate(from.getUTCDate() - 7);

  try {
    const url = `${BASE()}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${ymd(from)}/${ymd(target)}?sort=asc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      results?: { c?: number; t?: number }[];
    };
    const bars = (body.results ?? []).filter((b) => typeof b.c === "number");
    if (bars.length === 0) return null;

    const close = dec(bars[bars.length - 1].c!);
    // Store under the REQUESTED date, not the bar's own date, so the next lookup
    // for this position hits the cache instead of re-deriving the fallback.
    await prisma.benchmarkClose.upsert({
      where: { ticker_date: { ticker, date: target } },
      update: {},
      create: { ticker, date: target, close: close.toString() },
    });
    return close;
  } catch {
    // A benchmark is context, never the headline. If it cannot be fetched the
    // caller shows no comparison rather than failing the page.
    return null;
  }
}

/**
 * The most recent daily close. Uses the same windowed-aggregate call as
 * benchmarkCloseOn, but deliberately does NOT cache it: today's close is not
 * final until the session ends, and a provisional figure written into
 * BenchmarkClose would never be corrected.
 */
async function latestClose(ticker: string): Promise<D | null> {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return null;
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 10);
  try {
    const url = `${BASE()}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${ymd(from)}/${ymd(to)}?sort=asc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: { c?: number }[] };
    const bars = (body.results ?? []).filter((b) => typeof b.c === "number");
    return bars.length ? dec(bars[bars.length - 1].c!) : null;
  } catch {
    return null;
  }
}

/**
 * Where a benchmark comparison starts for ONE portfolio.
 *
 * An explicit startDate is a deliberate statement about when the book began and
 * always wins; otherwise the window opens at the earliest position. Null when
 * there is neither, which means there is nothing to compare yet.
 *
 * What this never does is change how a POSITION's return is measured. Each is
 * computed from its own entry, so a holding opened last month inside a book
 * that started two years ago contributes only last month's gain. Moving the
 * start date earlier lengthens the index's window, never a position's.
 */
export function startFor(
  startDate: Date | null | undefined,
  earliestOpen: Date | null | undefined,
): Date | null {
  return startDate ?? earliestOpen ?? null;
}

/**
 * The earliest start across several portfolios, for a whole-publication figure.
 *
 * Each portfolio resolves its OWN start first. Taking the minimum of the
 * explicit dates alone would drop a book that has none out of the window
 * entirely.
 */
export function earliestStart(
  items: { startDate: Date | null; earliestOpen: Date | null }[],
): Date | null {
  const starts = items
    .map((i) => startFor(i.startDate, i.earliestOpen))
    .filter((d): d is Date => d !== null);
  return starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null;
}

export interface BenchmarkComparison {
  ticker: string;
  /** Fractional return over the same window as the portfolio. */
  return: D | null;
  from: Date | null;
  startClose: D | null;
  currentPrice: D | null;
}

/**
 * The benchmark's return from `since` to its latest known price.
 *
 * `since` should be the earliest open date among the positions being summarised,
 * so the two numbers on screen cover the same period.
 */
export async function benchmarkSince(
  ticker: string,
  since: Date | null,
): Promise<BenchmarkComparison> {
  const empty: BenchmarkComparison = {
    ticker,
    return: null,
    from: since,
    startClose: null,
    currentPrice: null,
  };
  if (!since) return empty;

  // Prefer the live price the snapshot job maintains. Fall back to the latest
  // daily close, so a benchmark that was only just chosen shows a comparison
  // immediately instead of a blank until the next price run — "why is this
  // empty" is a worse failure than a close that is a session old.
  const instrument = await prisma.marketInstrument.findUnique({
    where: { ticker },
    select: { lastPrice: true },
  });
  const current = instrument?.lastPrice
    ? dec(instrument.lastPrice.toString())
    : await latestClose(ticker);
  if (!current) return empty;

  const start = await benchmarkCloseOn(ticker, since);
  if (!start || start.isZero()) return { ...empty, currentPrice: current };

  return {
    ticker,
    return: current.minus(start).div(start),
    from: since,
    startClose: start,
    currentPrice: current,
  };
}
