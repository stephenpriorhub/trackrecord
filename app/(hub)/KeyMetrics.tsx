import type { KeyMetrics } from "@/lib/managed/key-metrics";
import { benchmarkLabel } from "@/lib/publications";

/**
 * The Key Metrics panel, laid out to match the reporting MTA already uses so
 * the two can be read side by side.
 *
 * BUILT TO NEVER SCROLL SIDEWAYS
 *   There is no table and no overflow container anywhere in here. The benchmark
 *   comparison was a five-column table squeezed into a quarter-width column,
 *   which is how it ended up with a horizontal scrollbar; it is now a set of
 *   labelled tiles that reflow like everything else. Nothing has a fixed or
 *   minimum width, and no label is prevented from wrapping, so no element can
 *   exceed its container at any viewport.
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
  const hasBenchmark = m.benchmarks.some((b) => b.positions > 0);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-cyan-600/90 px-4 py-3 sm:px-5">
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
          })}{" "}
          UTC
        </p>
      </header>

      {/* Three groups across at desktop, two at tablet, one on a phone. The
          benchmark gets its own full-width band below, because five figures in
          a quarter-width column is what forced the scrollbar. */}
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3">
        <Group title="Portfolio, Position, and Trade Counts">
          <Tiles cols={3}>
            <Tile label="Portfolios" value={m.portfolios.toLocaleString()} />
            <Tile label="Total positions" value={m.totalPositions.toLocaleString()} />
            <Tile label="Open positions" value={m.openPositions.toLocaleString()} />
            <Tile label="Closed positions" value={m.closedPositions.toLocaleString()} />
            <Tile
              label="Trades opened"
              value={m.tradesOpened.toLocaleString()}
              // A position scaled into three times is one position and three
              // trades. Naming it stops the two counts reading as a mistake.
              hint="entry orders"
            />
            <Tile label="Closed trades" value={m.closedTrades.toLocaleString()} />
          </Tiles>
        </Group>

        <Group title="Period Return & Time to Return" tone="amber">
          <Tiles cols={2}>
            <Tile
              label="Avg. position weighted return"
              value={signed(m.avgReturn).text}
              cls={signed(m.avgReturn).cls}
              big
            />
            <Tile
              label="Avg. days held"
              value={m.avgDaysHeld === null ? "—" : m.avgDaysHeld.toLocaleString()}
              hint="unweighted; open counted to today"
              big
            />
          </Tiles>
        </Group>

        <Group title="Winners (Batting Averages)">
          <Tiles cols={3}>
            <Tile label="Winners" value={m.winners.toLocaleString()} sub={pct(m.winnersPct)} />
            <Tile
              label="Double digit ONLY"
              value={m.doubleDigitOnly.toLocaleString()}
              sub={pct(m.doubleDigitOnlyPct)}
            />
            <Tile
              label="Triple digit PLUS"
              value={m.tripleDigitPlus.toLocaleString()}
              sub={pct(m.tripleDigitPlusPct)}
            />
            <Tile
              label="Double digit PLUS"
              value={m.doubleDigitPlus.toLocaleString()}
              sub={pct(m.doubleDigitPlusPct)}
              hint="double + triple + beyond"
            />
          </Tiles>
          <p className="text-[11px] leading-tight text-gray-500">
            &ldquo;ONLY&rdquo; excludes the triple-digit band; &ldquo;PLUS&rdquo;
            combines them. Percentages are of measurable positions.
          </p>
        </Group>
      </div>

      <div className="border-t border-gray-800 p-4 sm:p-5">
        <Group title="Performance v. Portfolio Benchmark">
          {!hasBenchmark ? (
            <p className="text-sm text-gray-500">
              No benchmark comparison available yet.
            </p>
          ) : (
            <div className="space-y-3">
              {m.benchmarks
                .filter((b) => b.positions > 0)
                .map((b) => {
                  const mine = signed(b.avgReturn);
                  const theirs = signed(b.avgBenchmarkReturn);
                  const alpha = signed(b.alpha);
                  return (
                    <div
                      key={b.ticker}
                      className="rounded-lg border border-gray-800 bg-gray-800/40 p-3"
                    >
                      <p className="mb-2 text-sm font-semibold text-white">
                        {b.ticker}{" "}
                        <span className="font-normal text-gray-500">
                          {benchmarkLabel(b.ticker)} · {b.positions.toLocaleString()}{" "}
                          positions compared
                        </span>
                      </p>
                      <Tiles cols={3}>
                        <Tile
                          label="Avg. position weighted return"
                          value={mine.text}
                          cls={mine.cls}
                        />
                        <Tile
                          label="Avg. benchmark weighted return"
                          value={theirs.text}
                          cls={theirs.cls}
                        />
                        <Tile label="Alpha" value={alpha.text} cls={alpha.cls} />
                      </Tiles>
                    </div>
                  );
                })}
            </div>
          )}
          <p className="max-w-prose text-[11px] leading-tight text-gray-500">
            The benchmark is measured over each position&apos;s own holding
            window, then averaged the same way — so a position opened last month
            is compared against what the index did last month, not against a
            multi-year run it was never exposed to. Positions the index cannot
            cover on both ends are excluded from both averages.
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

/**
 * A reflowing tile grid.
 *
 * `auto-fit` with a small minimum is what keeps this honest at every width: the
 * browser fits as many columns as there is room for and wraps the rest, so the
 * grid can never be wider than its container. `cols` is only the cap at desktop.
 */
function Tiles({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(${cols === 3 ? "6.5rem" : "8rem"}, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

function Tile({
  label,
  value,
  cls,
  hint,
  sub,
  big,
}: {
  label: string;
  value: string;
  cls?: string;
  hint?: string;
  /** A second figure on the same tile — the percentage beside a count. */
  sub?: string;
  big?: boolean;
}) {
  return (
    <div className="min-w-0 rounded bg-gray-800/60 px-3 py-2">
      {/* break-words, so a long label wraps instead of widening the tile. */}
      <p className="break-words text-[11px] leading-tight text-gray-400">{label}</p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`${big ? "text-2xl" : "text-lg"} font-semibold ${cls ?? "text-white"}`}
        >
          {value}
        </span>
        {sub && <span className="text-sm font-medium text-gray-400">{sub}</span>}
      </p>
      {hint && (
        <p className="break-words text-[10px] leading-tight text-gray-500">{hint}</p>
      )}
    </div>
  );
}
