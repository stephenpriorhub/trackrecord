import type { Stats } from "@/lib/managed/stats";
import type { BenchmarkComparison } from "@/lib/managed/benchmark";
import { benchmarkLabel } from "@/lib/publications";

/**
 * The summary figures for a publication or a portfolio.
 *
 * Loser count and worst trade are absent by design — a standing rule for this
 * app. lib/managed/stats.ts does not even compute them, so there is nothing here
 * to accidentally render.
 */

function pctText(v: unknown, dp = 2): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: "—", cls: "text-gray-500" };
  const n = Number(v.toString()) * 100;
  return {
    text: `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`,
    cls: n >= 0 ? "text-green-400" : "text-red-400",
  };
}

function plainPct(v: unknown, dp = 1): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v.toString()) * 100).toFixed(dp)}%`;
}

export function StatBar({
  stats,
  benchmark,
  showBenchmark,
  compact,
}: {
  stats: Stats;
  benchmark?: BenchmarkComparison | null;
  showBenchmark?: boolean;
  compact?: boolean;
}) {
  const avg = pctText(stats.avgReturn);
  const best = pctText(stats.bestReturn);
  const bench = pctText(benchmark?.return ?? null);

  const cells: { label: string; value: string; cls?: string; sub?: string }[] = [
    {
      label: "Positions",
      value: stats.positions.toLocaleString(),
      sub: `${stats.open} open · ${stats.closed} closed`,
    },
    {
      label: "Win rate",
      value: plainPct(stats.winRate),
      // Named explicitly: a win rate over closed trades is a different number
      // from one that counts paper gains, and the label should say which.
      sub: stats.measured ? `${stats.winners} of ${stats.measured} closed` : "no closed trades yet",
    },
    { label: "Avg return", value: avg.text, cls: avg.cls, sub: "equal-weighted" },
    { label: "Best trade", value: best.text, cls: best.cls },
    {
      label: "Avg hold",
      value: stats.avgDaysHeld === null ? "—" : `${stats.avgDaysHeld}d`,
      sub: "closed trades",
    },
  ];

  if (showBenchmark && benchmark && benchmark.return !== null) {
    cells.push({
      label: benchmarkLabel(benchmark.ticker),
      value: bench.text,
      cls: bench.cls,
      sub: "same period",
    });
  }

  return (
    <div>
      <div
        className={`grid gap-3 ${
          compact ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
        }`}
      >
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">{c.label}</div>
            <div className={`mt-1 text-xl font-bold ${c.cls ?? "text-white"}`}>{c.value}</div>
            {c.sub && <div className="mt-0.5 text-xs text-gray-600">{c.sub}</div>}
          </div>
        ))}
      </div>
      {stats.unpriced > 0 && (
        <p className="mt-2 text-xs text-yellow-600">
          {stats.unpriced} {stats.unpriced === 1 ? "position has" : "positions have"} no
          available price and {stats.unpriced === 1 ? "is" : "are"} left out of these
          averages rather than counted as zero.
        </p>
      )}
    </div>
  );
}
