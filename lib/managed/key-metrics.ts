/**
 * The Key Metrics panel for a publication.
 *
 * Mirrors the reporting MTA already uses, so the two can be read side by side
 * without translating between them.
 *
 * THE ONE THAT MATTERS
 *   "Avg. Benchmark Weighted Return" is NOT the index over the publication's
 *   whole life. It is the index measured over EACH POSITION'S OWN holding
 *   window, averaged the same equal-weighted way the portfolio's return is.
 *   That is what makes Alpha meaningful: a position opened last month is
 *   compared against what SPY did last month, not against a three-year index
 *   run it was never exposed to.
 *
 * DELIBERATELY ABSENT: any count of losers or a worst trade. That is a standing
 * rule for this app, and the source panel this mirrors reports only winners
 * too, so nothing is lost by keeping it.
 */
import { prisma } from "../prisma";
import { dec, ZERO, type D } from "../money";
import { loadBenchmarkSeries } from "./benchmark";

/** A return of +10% or better — "double digit" in the source reporting. */
const DOUBLE_DIGIT = 0.1;
/** A return of +100% or better. */
const TRIPLE_DIGIT = 1;

export interface BenchmarkRow {
  ticker: string;
  /** Positions that could be compared — both endpoints present in the series. */
  positions: number;
  /** Portfolio return over THAT SAME SET, so the difference is like for like. */
  avgReturn: D | null;
  avgBenchmarkReturn: D | null;
  alpha: D | null;
}

export interface KeyMetrics {
  refreshedAt: Date;
  portfolios: number;
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  tradesOpened: number;
  openTrades: number;
  closedTrades: number;
  /** Equal-weighted mean return across every position that can be measured. */
  avgReturn: D | null;
  /**
   * Mean days held, counting an OPEN position from its entry to TODAY. The
   * closed-only figure elsewhere answers a different question; this one
   * describes how long the book actually holds things.
   */
  avgDaysHeld: number | null;
  winners: number;
  winnersPct: D | null;
  doubleDigitOnly: number;
  doubleDigitOnlyPct: D | null;
  tripleDigitPlus: number;
  tripleDigitPlusPct: D | null;
  doubleDigitPlus: number;
  doubleDigitPlusPct: D | null;
  benchmarks: BenchmarkRow[];
}

interface Row {
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  cachedReturnPct: unknown;
}

function pctOf(n: number, total: number): D | null {
  return total > 0 ? dec(n).div(total) : null;
}

function mean(xs: D[]): D | null {
  return xs.length ? xs.reduce((a, b) => a.plus(b), ZERO).div(xs.length) : null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

/**
 * Key Metrics for a publication.
 *
 * `benchmarkTickers` is whatever its portfolios compare against — one row each,
 * matching the source panel's table.
 */
export async function keyMetrics(
  serviceId: string,
  benchmarkTickers: string[],
): Promise<KeyMetrics> {
  const where = {
    deletedAt: null,
    portfolio: { serviceId, archivedAt: null },
  };

  const [portfolios, positions, tradesOpened, openTrades, closedTrades] =
    await Promise.all([
      prisma.managedPortfolio.count({ where: { serviceId, archivedAt: null } }),
      prisma.managedPosition.findMany({
        where,
        select: {
          status: true,
          openedAt: true,
          closedAt: true,
          cachedReturnPct: true,
        },
      }),
      // A "trade opened" is one OPEN order. A position scaled into three times
      // is one position and three trades, which is the distinction the source
      // panel draws between its two counts.
      prisma.managedExecution.count({
        where: { intent: "OPEN", deletedAt: null, position: where },
      }),
      prisma.managedExecution.count({
        where: {
          intent: "OPEN",
          deletedAt: null,
          position: { ...where, status: "OPEN" },
        },
      }),
      prisma.managedExecution.count({
        where: { intent: "CLOSE", deletedAt: null, position: where },
      }),
    ]);

  const now = new Date();
  const returns: D[] = [];
  for (const p of positions) {
    if (p.cachedReturnPct !== null && p.cachedReturnPct !== undefined) {
      returns.push(dec(p.cachedReturnPct.toString()));
    }
  }

  const winners = returns.filter((r) => r.gt(0)).length;
  const triple = returns.filter((r) => r.gte(TRIPLE_DIGIT)).length;
  // "ONLY" excludes the triple-digit band; "PLUS" combines them. Both are shown
  // because the source panel shows both, and they answer different questions.
  const doubleOnly = returns.filter(
    (r) => r.gte(DOUBLE_DIGIT) && r.lt(TRIPLE_DIGIT),
  ).length;
  const doublePlus = returns.filter((r) => r.gte(DOUBLE_DIGIT)).length;
  const measured = returns.length;

  const held = positions.map((p) => daysBetween(p.openedAt, p.closedAt ?? now));
  const avgDaysHeld = held.length
    ? Math.round(held.reduce((a, b) => a + b, 0) / held.length)
    : null;

  const benchmarks: BenchmarkRow[] = [];
  for (const ticker of [...new Set(benchmarkTickers)]) {
    benchmarks.push(await benchmarkRow(ticker, positions, now));
  }

  return {
    refreshedAt: now,
    portfolios,
    totalPositions: positions.length,
    openPositions: positions.filter((p) => p.status === "OPEN").length,
    closedPositions: positions.filter((p) => p.status === "CLOSED").length,
    tradesOpened,
    openTrades,
    closedTrades,
    avgReturn: mean(returns),
    avgDaysHeld,
    winners,
    winnersPct: pctOf(winners, measured),
    doubleDigitOnly: doubleOnly,
    doubleDigitOnlyPct: pctOf(doubleOnly, measured),
    tripleDigitPlus: triple,
    tripleDigitPlusPct: pctOf(triple, measured),
    doubleDigitPlus: doublePlus,
    doubleDigitPlusPct: pctOf(doublePlus, measured),
    benchmarks,
  };
}

/**
 * The index measured over each position's own window, then averaged.
 *
 * Positions the series cannot cover on BOTH ends are dropped from the row
 * entirely — from the benchmark average AND from the portfolio average beside
 * it. Averaging the portfolio over 3,000 positions and the index over 2,400
 * would produce an alpha that is really just the difference between two
 * different sets of trades.
 */
async function benchmarkRow(
  ticker: string,
  positions: Row[],
  now: Date,
): Promise<BenchmarkRow> {
  const earliest = positions.reduce<Date | null>(
    (acc, p) => (acc === null || p.openedAt < acc ? p.openedAt : acc),
    null,
  );
  const empty: BenchmarkRow = {
    ticker,
    positions: 0,
    avgReturn: null,
    avgBenchmarkReturn: null,
    alpha: null,
  };
  if (!earliest) return empty;

  const series = await loadBenchmarkSeries(ticker, earliest, now);
  if (series.count === 0) return empty;

  const mine: D[] = [];
  const theirs: D[] = [];
  for (const p of positions) {
    if (p.cachedReturnPct === null || p.cachedReturnPct === undefined) continue;
    const start = series.on(p.openedAt);
    const end = series.on(p.closedAt ?? now);
    if (!start || !end || start.isZero()) continue;
    mine.push(dec(p.cachedReturnPct.toString()));
    theirs.push(end.minus(start).div(start));
  }
  if (mine.length === 0) return empty;

  const avgMine = mean(mine);
  const avgTheirs = mean(theirs);
  return {
    ticker,
    positions: mine.length,
    avgReturn: avgMine,
    avgBenchmarkReturn: avgTheirs,
    alpha: avgMine && avgTheirs ? avgMine.minus(avgTheirs) : null,
  };
}
