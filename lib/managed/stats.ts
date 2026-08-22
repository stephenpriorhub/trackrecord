/**
 * Summary figures for a portfolio, and for a publication as a whole.
 *
 * DELIBERATELY ABSENT: loser count and worst trade. That is a standing rule for
 * this app — the track record reports trade count, winners, win rate and
 * returns, and losing-side detail is not computed here at all, so no page can
 * render it by reaching for a field.
 *
 * Returns are EQUAL-WEIGHTED. These are model portfolios: each recommendation is
 * one idea and there are no real position sizes to weight by. A position with no
 * return (nothing can price it) is EXCLUDED rather than counted as zero, which
 * would drag every average toward nothing whenever a contract goes quiet.
 */
import { prisma } from "../prisma";
import { dec, ZERO, type D } from "../money";
import { benchmarkSince, type BenchmarkComparison } from "./benchmark";

export interface Stats {
  positions: number;
  open: number;
  closed: number;
  /** Closed positions with a usable return — the denominator for win rate. */
  measured: number;
  winners: number;
  /** Fraction, e.g. 0.7592. Null when nothing is measurable yet. */
  winRate: D | null;
  /** Equal-weighted mean return across everything measurable, open and closed. */
  avgReturn: D | null;
  /** Best single result. */
  bestReturn: D | null;
  /** Mean days held, closed positions only. */
  avgDaysHeld: number | null;
  /** Positions nothing could price — surfaced so a thin average is explainable. */
  unpriced: number;
  /** Earliest open date, which is the window a benchmark should cover. */
  since: Date | null;
}

const EMPTY: Stats = {
  positions: 0,
  open: 0,
  closed: 0,
  measured: 0,
  winners: 0,
  winRate: null,
  avgReturn: null,
  bestReturn: null,
  avgDaysHeld: null,
  unpriced: 0,
  since: null,
};

type Row = {
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  cachedReturnPct: unknown;
  cachedUnpriced: boolean;
};

function summarise(rows: Row[]): Stats {
  if (rows.length === 0) return { ...EMPTY };

  const returns: D[] = [];
  let winners = 0;
  let closedWithReturn = 0;
  let unpriced = 0;
  const days: number[] = [];
  let since: Date | null = null;

  for (const r of rows) {
    if (!since || r.openedAt < since) since = r.openedAt;
    if (r.cachedUnpriced) unpriced += 1;

    if (r.cachedReturnPct !== null && r.cachedReturnPct !== undefined) {
      const v = dec(r.cachedReturnPct.toString());
      returns.push(v);
      if (r.status === "CLOSED") {
        closedWithReturn += 1;
        if (v.gt(0)) winners += 1;
      }
    }

    if (r.closedAt) {
      days.push(
        Math.max(
          0,
          Math.round(
            (r.closedAt.getTime() - r.openedAt.getTime()) / 86_400_000,
          ),
        ),
      );
    }
  }

  const open = rows.filter((r) => r.status === "OPEN").length;
  const mean = returns.length
    ? returns.reduce((a, b) => a.plus(b), ZERO).div(returns.length)
    : null;

  return {
    positions: rows.length,
    open,
    closed: rows.length - open,
    measured: closedWithReturn,
    winners,
    // Win rate is a CLOSED-trade statistic. Counting open positions would let a
    // paper gain that has not been realised inflate the published rate.
    winRate: closedWithReturn > 0 ? dec(winners).div(closedWithReturn) : null,
    avgReturn: mean,
    bestReturn: returns.length
      ? returns.reduce((a, b) => (b.gt(a) ? b : a))
      : null,
    avgDaysHeld: days.length
      ? Math.round(days.reduce((a, b) => a + b, 0) / days.length)
      : null,
    unpriced,
    since,
  };
}

const SELECT = {
  status: true,
  openedAt: true,
  closedAt: true,
  cachedReturnPct: true,
  cachedUnpriced: true,
} as const;

export async function portfolioStats(portfolioId: string): Promise<Stats> {
  const rows = await prisma.managedPosition.findMany({
    where: { portfolioId, deletedAt: null },
    select: SELECT,
  });
  return summarise(rows);
}

/** Stats for every portfolio in one query, keyed by portfolio id. */
export async function statsByPortfolio(
  portfolioIds: string[],
): Promise<Map<string, Stats>> {
  if (portfolioIds.length === 0) return new Map();
  const rows = await prisma.managedPosition.findMany({
    where: { portfolioId: { in: portfolioIds }, deletedAt: null },
    select: { ...SELECT, portfolioId: true },
  });
  const grouped = new Map<string, Row[]>();
  for (const id of portfolioIds) grouped.set(id, []);
  for (const r of rows) grouped.get(r.portfolioId)?.push(r);
  return new Map([...grouped].map(([id, rs]) => [id, summarise(rs)]));
}

/** Whole-publication stats: every position across all its portfolios. */
export async function serviceStats(serviceId: string): Promise<Stats> {
  const rows = await prisma.managedPosition.findMany({
    where: { deletedAt: null, portfolio: { serviceId, archivedAt: null } },
    select: SELECT,
  });
  return summarise(rows);
}

export async function statsByService(
  serviceIds: string[],
): Promise<Map<string, Stats>> {
  if (serviceIds.length === 0) return new Map();
  const rows = await prisma.managedPosition.findMany({
    where: {
      deletedAt: null,
      portfolio: { serviceId: { in: serviceIds }, archivedAt: null },
    },
    select: { ...SELECT, portfolio: { select: { serviceId: true } } },
  });
  const grouped = new Map<string, Row[]>();
  for (const id of serviceIds) grouped.set(id, []);
  for (const r of rows) grouped.get(r.portfolio.serviceId)?.push(r);
  return new Map([...grouped].map(([id, rs]) => [id, summarise(rs)]));
}

/** Stats plus the benchmark measured over the same window. */
export async function withBenchmark(
  stats: Stats,
  benchmarkTicker: string,
): Promise<{ stats: Stats; benchmark: BenchmarkComparison }> {
  return {
    stats,
    benchmark: await benchmarkSince(benchmarkTicker, stats.since),
  };
}
