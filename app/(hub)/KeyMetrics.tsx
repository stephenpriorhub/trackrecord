import type { KeyMetrics } from "@/lib/managed/key-metrics";
import { benchmarkLabel } from "@/lib/publications";

/**
 * The Key Metrics panel, laid out to match the reporting MTA already uses so
 * the two can be read side by side.
 *
 * No loser count and no worst trade — a standing rule for this app, and the
 * source panel reports only winners too.
 */

function pct(v: unknown, dp = 2): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v.toString()) * 100).toFixed(dp)}%`;
}

function signed(v: unknown): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: "—", cls: "text-gray-500" };
  const n = Number(v.toString()) * 100;
  return {
    text: `${n.toFixed(2)}%`,
    cls: n >= 0 ? "text-green-400" : "text-red-400",
  };
}

export function KeyMetricsPanel({ m }: { m: KeyMetrics }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2 bg-cyan-600/90 px-5 py-3">
        <h3 className="text-lg font-bold text-white">Key Metrics</h3>
        <p className="text-xs text-cyan-50">
          Data last refreshed:{" "}
          {m.refreshedAt.toLocaleString("en-US", {
            timeZone: "UTC",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}{" "}
          UTC
        </p>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-4">
        <Group title="Portfolio, Position, and Trade Counts">
          <Tile label="# Portfolios" value={m.portfolios.toLocaleString()} />
          <div className="grid grid-cols-2 gap-2">
            <Tile label="# Total Positions" value={m.totalPositions.toLocaleString()} />
            <Tile label="# Open Positions" value={m.openPositions.toLocaleString()} />
            <Tile label="# Closed Positions" value={m.closedPositions.toLocaleString()} />
            <Tile
              label="# Trades Opened"
              value={m.tradesOpened.toLocaleString()}
              // A position scaled into three times is one position and three
              // trades. Naming the difference stops the two counts reading as a
              // contradiction.
              hint="each entry order"
            />
            <Tile label="# Open Trades" value={m.openTrades.toLocaleString()} />
            <Tile label="# Closed Trades" value={m.closedTrades.toLocaleString()} />
          </div>
        </Group>

        <div className="space-y-5">
          <Group title="Period Return" tone="amber">
            <Tile
              label="Avg. Position Weighted Return"
              value={signed(m.avgReturn).text}
              cls={signed(m.avgReturn).cls}
              big
            />
          </Group>
          <Group title="Time to Return" tone="amber">
            <Tile
              label="Avg. Days Held (Unweighted)"
              value={m.avgDaysHeld === null ? "—" : m.avgDaysHeld.toLocaleString()}
              hint="open positions counted to today"
              big
            />
          </Group>
        </div>

        <Group title="Winners (Batting Averages)">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="# Winners" value={m.winners.toLocaleString()} />
            <Tile label="% Winners" value={pct(m.winnersPct)} />
            <Tile label="# Double Digit ONLY" value={m.doubleDigitOnly.toLocaleString()} />
            <Tile label="% Double Digit ONLY" value={pct(m.doubleDigitOnlyPct)} />
            <Tile label="# Triple Digit PLUS" value={m.tripleDigitPlus.toLocaleString()} />
            <Tile label="% Triple Digit PLUS" value={pct(m.tripleDigitPlusPct)} />
          </div>
          <p className="text-center text-[11px] leading-tight text-gray-500">
            Above: triple-digit winners exclusive of double, and vice versa.
            <br />
            Below: combined, double + triple + beyond.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="# Double Digit PLUS" value={m.doubleDigitPlus.toLocaleString()} />
            <Tile label="% Double Digit PLUS" value={pct(m.doubleDigitPlusPct)} />
          </div>
        </Group>

        <Group title="Performance v. Portfolio Benchmark">
          {m.benchmarks.length === 0 || m.benchmarks.every((b) => b.positions === 0) ? (
            <p className="text-sm text-gray-500">
              No benchmark comparison available yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-400">
                    <th className="py-2 pr-3 font-semibold">Benchmark</th>
                    <th className="py-2 pr-3 text-right font-semibold"># Positions</th>
                    <th className="py-2 pr-3 text-right font-semibold">Avg. Position</th>
                    <th className="py-2 pr-3 text-right font-semibold">Avg. Benchmark</th>
                    <th className="py-2 text-right font-semibold">Alpha</th>
                  </tr>
                </thead>
                <tbody>
                  {m.benchmarks.map((b) => {
                    const mineC = signed(b.avgReturn);
                    const theirsC = signed(b.avgBenchmarkReturn);
                    const alphaC = signed(b.alpha);
                    return (
                      <tr key={b.ticker} className="border-b border-gray-800/60">
                        <td className="py-2 pr-3 font-medium text-white">
                          {b.ticker}
                          <span className="ml-1 text-xs text-gray-500">
                            {benchmarkLabel(b.ticker)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-300">
                          {b.positions.toLocaleString()}
                        </td>
                        <td className={`py-2 pr-3 text-right ${mineC.cls}`}>{mineC.text}</td>
                        <td className={`py-2 pr-3 text-right ${theirsC.cls}`}>{theirsC.text}</td>
                        <td className={`py-2 text-right font-semibold ${alphaC.cls}`}>
                          {alphaC.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] leading-tight text-gray-500">
            The benchmark is measured over each position&apos;s own holding
            window, then averaged the same way — so a position opened last month
            is compared against what the index did last month. Positions the
            index cannot cover on both ends are excluded from both averages.
          </p>
        </Group>
      </div>
    </section>
  );
}

function Group({
  title,
  tone = "yellow",
  children,
}: {
  title: string;
  tone?: "yellow" | "amber";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4
        className={`rounded px-3 py-1.5 text-xs font-bold ${
          tone === "amber"
            ? "bg-amber-300/90 text-amber-950"
            : "bg-yellow-200/90 text-yellow-950"
        }`}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function Tile({
  label,
  value,
  cls,
  hint,
  big,
}: {
  label: string;
  value: string;
  cls?: string;
  hint?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded bg-gray-800/60 px-3 py-2">
      <p className="text-[11px] leading-tight text-gray-400">{label}</p>
      <p className={`${big ? "text-2xl" : "text-lg"} font-semibold ${cls ?? "text-white"}`}>
        {value}
      </p>
      {hint && <p className="text-[10px] leading-tight text-gray-500">{hint}</p>}
    </div>
  );
}
