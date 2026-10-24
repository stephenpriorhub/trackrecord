/**
 * The market strip at the top of the home page: S&P 500, Nasdaq and Dow —
 * today, week-to-date and month-to-date.
 *
 * Measured on the index ETFs (SPY, QQQ, DIA): the Massive plan carries no
 * index feeds. Latest price from a Massive snapshot; the reference closes
 * (last close before this week / before this month) from the permanent daily
 * close cache.
 */
import { fetchSnapshots } from "../massive";
import { loadBenchmarkSeries } from "../managed/benchmark";
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
}

function dayBefore(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export async function marketStrip(today: string = todayNY()): Promise<{ rows: MarketRow[]; asOf: Date | null }> {
  const weekStart = periodBounds("week", today).start;
  const monthStart = periodBounds("month", today).start;
  const from = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);

  const snaps = await fetchSnapshots(MARKETS.map((m) => m.ticker)).catch(() => null);
  let asOf: Date | null = null;

  const rows = await Promise.all(
    MARKETS.map(async (m): Promise<MarketRow> => {
      const series = await loadBenchmarkSeries(m.ticker, from).catch(() => null);
      const snap = snaps?.rows.get(m.ticker);
      const last = snap?.last?.toNumber() ?? series?.latest()?.toNumber() ?? null;
      if (snap?.providerAsOf && (!asOf || snap.providerAsOf > asOf)) asOf = snap.providerAsOf;
      const ref = (d: Date) => series?.on(d)?.toNumber() ?? null;
      const pct = (base: number | null) => (last !== null && base ? last / base - 1 : null);
      return {
        ticker: m.ticker,
        label: m.label,
        last,
        day: snap?.changePct ? snap.changePct.toNumber() : pct(snap?.prevClose?.toNumber() ?? null),
        week: pct(ref(dayBefore(weekStart))),
        month: pct(ref(dayBefore(monthStart))),
      };
    }),
  );
  return { rows, asOf };
}
