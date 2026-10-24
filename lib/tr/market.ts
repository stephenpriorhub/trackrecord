/**
 * The market strip at the top of the home page: S&P 500, Nasdaq and Dow —
 * today, week-to-date, month-to-date and year-to-date.
 *
 * Measured on the index ETFs (SPY, QQQ, DIA): the Massive plan carries no
 * index feeds. Latest price from a Massive snapshot; the reference closes
 * (last close before this week / before this month) from the permanent daily
 * close cache.
 */
import { fetchSnapshots } from "../massive";
import { benchmarkCloseOn, loadBenchmarkSeries } from "../managed/benchmark";
import { periodBounds, todayNY } from "./stats";

export const MARKETS = [
  { ticker: "SPY", label: "S&P 500" },
  { ticker: "QQQ", label: "Nasdaq 100" },
  { ticker: "DIA", label: "Dow 30" },
] as const;

export interface MarketRow {
  ticker: string;
  label: string;
  last: number | null;
  day: number | null;
  week: number | null;
  month: number | null;
  year: number | null;
}

function dayBefore(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export async function marketStrip(today: string = todayNY()): Promise<{ rows: MarketRow[]; asOf: Date | null }> {
  const weekStart = periodBounds("week", today).start;
  const monthStart = periodBounds("month", today).start;
  const yearStart = periodBounds("year", today).start;
  // Back to mid-December so the prior year's last close is in range.
  const from = new Date(`${Number(today.slice(0, 4)) - 1}-12-15T00:00:00Z`);

  const snaps = await fetchSnapshots(MARKETS.map((m) => m.ticker)).catch(() => null);
  let asOf: Date | null = null;

  const rows = await Promise.all(
    MARKETS.map(async (m): Promise<MarketRow> => {
      const series = await loadBenchmarkSeries(m.ticker, from).catch(() => null);
      const snap = snaps?.rows.get(m.ticker);
      const last = snap?.last?.toNumber() ?? series?.latest()?.toNumber() ?? null;
      if (snap?.providerAsOf && (!asOf || snap.providerAsOf > asOf)) asOf = snap.providerAsOf;
      // Each reference close is looked up on its own (and cached): the series
      // cache only grows FORWARD from its newest bar, so a ticker first cached
      // this month had no December close for year-to-date.
      const ref = (d: Date) => benchmarkCloseOn(m.ticker, d).then((c) => c?.toNumber() ?? null).catch(() => null);
      const pct = (base: number | null) => (last !== null && base ? last / base - 1 : null);
      return {
        ticker: m.ticker,
        label: m.label,
        last,
        day: snap?.changePct ? snap.changePct.toNumber() : pct(snap?.prevClose?.toNumber() ?? null),
        week: pct(await ref(dayBefore(weekStart))),
        month: pct(await ref(dayBefore(monthStart))),
        year: pct(await ref(dayBefore(yearStart))),
      };
    }),
  );
  return { rows, asOf };
}
