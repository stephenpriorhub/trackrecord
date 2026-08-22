/**
 * Refreshing prices from Massive.
 *
 * One batched call prices every ticker the app cares about — stock symbols, OCC
 * option symbols and benchmark tickers together, 250 per request. See
 * lib/massive.ts for the plan limits and response quirks this is built around;
 * the three that bite hardest:
 *
 *   1. `session.last_updated` is the moment the provider ASSEMBLED the snapshot,
 *      not when the trade happened. The embed says "prices as of X", so it must
 *      use the real trade time or it claims 15-minute-old data is current.
 *   2. Stocks carry `session.price`; OPTIONS DO NOT — an option's latest price is
 *      `session.close`. lib/massive.ts normalizes this.
 *   3. Massive ECHOES a stub row for an unknown ticker instead of omitting it, so
 *      "came back in the response" does not mean "priced".
 *
 * A ticker that cannot be priced is left with its previous price and marked, and
 * is NEVER written as zero. Zero would publish a total loss on a position that
 * is merely illiquid.
 */
import { prisma } from "../prisma";
import { fetchSnapshots, isMassiveConfigured } from "../massive";
import { recomputePosition } from "./positions";

export interface RefreshReport {
  requested: number;
  priced: number;
  unpriced: string[];
  positionsRecomputed: number;
  /** Oldest real trade time across everything priced this run. */
  oldestPriceAt: Date | null;
  errors: string[];
}

/**
 * Every ticker worth fetching: the instruments referenced by a live leg, plus
 * each portfolio's benchmark.
 *
 * Benchmarks are registered as instruments so they ride the same batched call
 * rather than costing a request each.
 */
async function tickersToRefresh(): Promise<string[]> {
  const [instruments, portfolios] = await Promise.all([
    prisma.marketInstrument.findMany({
      where: { active: true },
      select: { ticker: true },
    }),
    prisma.managedPortfolio.findMany({
      where: { archivedAt: null },
      select: { benchmarkTicker: true },
    }),
  ]);

  const benchmarks = [...new Set(portfolios.map((p) => p.benchmarkTicker).filter(Boolean))];
  for (const ticker of benchmarks) {
    await prisma.marketInstrument.upsert({
      where: { ticker },
      update: { active: true },
      create: { ticker, kind: "STOCK", underlying: ticker },
    });
  }

  return [...new Set([...instruments.map((i) => i.ticker), ...benchmarks])];
}

export async function refreshPrices(): Promise<RefreshReport> {
  const report: RefreshReport = {
    requested: 0,
    priced: 0,
    unpriced: [],
    positionsRecomputed: 0,
    oldestPriceAt: null,
    errors: [],
  };

  if (!isMassiveConfigured()) {
    report.errors.push("MASSIVE_API_KEY is not set — no prices were fetched.");
    return report;
  }

  const tickers = await tickersToRefresh();
  report.requested = tickers.length;
  if (tickers.length === 0) return report;

  // fetchSnapshots already chunks to 250 per call, stops early on a rate limit,
  // and reports which tickers came back with no usable row.
  const snapshot = await fetchSnapshots(tickers);
  for (const e of snapshot.errors) {
    report.errors.push(
      `${e.rateLimited ? "Rate limited" : "Failed"} on ${e.batch.length} tickers: ${e.message}`
    );
  }

  const pricedTickers = new Set<string>();

  for (const [ticker, row] of snapshot.rows) {
    // `missing` catches an absent row; this catches the echoed stub that IS
    // present but carries no price. Both mean unpriced, never zero.
    if (row.last === null) continue;

    await prisma.marketInstrument.update({
      where: { ticker },
      data: {
        lastPrice: row.last.toString(),
        // The provider's own timestamp — the true age of the print. Using our
        // fetch time here would make the embed claim 15-minute-old data is live.
        lastPriceAt: row.providerAsOf ?? null,
        priceSource: "LAST_TRADE",
        ...(row.prevClose ? { prevClose: row.prevClose.toString() } : {}),
      },
    });

    pricedTickers.add(ticker);
    report.priced += 1;
    if (row.providerAsOf && (!report.oldestPriceAt || row.providerAsOf < report.oldestPriceAt)) {
      report.oldestPriceAt = row.providerAsOf;
    }
  }

  // Requested but not priced: absent from the response, or present with no
  // price. The previous price is left in place — a stale number labelled with
  // its real timestamp is more honest than a zero.
  report.unpriced = tickers.filter((t) => !pricedTickers.has(t.toUpperCase()));

  // The snapshot carries the security's name, so the embed's Underlying Company
  // column fills itself. Only ever fills a BLANK — a guru who typed "Destiny
  // Tech 100 - Half Position" keeps their wording.
  for (const [ticker, row] of snapshot.rows) {
    if (!row.name) continue;
    await prisma.managedPosition.updateMany({
      where: {
        companyName: null,
        deletedAt: null,
        legs: { some: { marketTicker: ticker } },
      },
      data: { companyName: row.name },
    });
  }

  // Recompute only positions whose legs actually moved.
  const affected = await prisma.managedPosition.findMany({
    where: {
      deletedAt: null,
      status: "OPEN",
      legs: { some: { marketTicker: { in: [...pricedTickers] } } },
    },
    select: { id: true },
  });
  for (const { id } of affected) {
    try {
      await recomputePosition(id);
      report.positionsRecomputed += 1;
    } catch (err) {
      report.errors.push(
        `Recompute failed for ${id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return report;
}

/**
 * Retire instruments nothing references any more, so the batched call does not
 * grow forever with expired contracts. Deactivated rather than deleted: a closed
 * position keeps pointing at its instrument, and its last known price stays.
 */
export async function retireUnusedInstruments(): Promise<number> {
  const benchmarks = await prisma.managedPortfolio.findMany({
    where: { archivedAt: null },
    select: { benchmarkTicker: true },
  });
  const keepBenchmarks = benchmarks.map((b) => b.benchmarkTicker);

  const result = await prisma.marketInstrument.updateMany({
    where: {
      active: true,
      ticker: { notIn: keepBenchmarks },
      // No leg of any open position needs it.
      legs: { none: { position: { status: "OPEN", deletedAt: null } } },
    },
    data: { active: false },
  });
  return result.count;
}

/**
 * When prices were last genuinely refreshed, for the embed's "last updated"
 * line. This is the OLDEST real trade time across the priced instruments a
 * portfolio actually uses, not the newest: the line promises everything on the
 * page is at least this fresh.
 */
export async function priceAsOf(portfolioId?: string): Promise<Date | null> {
  const rows = await prisma.marketInstrument.findMany({
    where: {
      lastPriceAt: { not: null },
      active: true,
      ...(portfolioId
        ? { legs: { some: { position: { portfolioId, status: "OPEN", deletedAt: null } } } }
        : {}),
    },
    select: { lastPriceAt: true },
    orderBy: { lastPriceAt: "asc" },
    take: 1,
  });
  return rows[0]?.lastPriceAt ?? null;
}
