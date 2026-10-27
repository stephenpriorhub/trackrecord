import { days, int, pct, tone } from "@/lib/tr/format";
import { PERIOD_LABEL, type PeriodKey, type PeriodStats } from "@/lib/tr/stats";

const PERIODS: PeriodKey[] = ["week", "lastWeek", "month", "year", "inception"];

/**
 * The publisher's summary table: periods across, measures down. Matches the
 * Summary Stats tabs readers already know, in a lighter, plainer form.
 */
export function StatsTable({
  stats,
  weighted = false,
  compact = false,
}: {
  stats: Record<PeriodKey, PeriodStats>;
  weighted?: boolean;
  compact?: boolean;
}) {
  const rows: { label: string; hint?: string; cell: (s: PeriodStats) => React.ReactNode }[] = [
    {
      label: "Trades opened",
      hint: "Positions opened in the period, whether still open or since closed",
      cell: (s) => (s.opened === undefined ? "—" : int(s.opened)),
    },
    { label: "Closed trades", cell: (s) => int(s.closed) },
    { label: "Winners", cell: (s) => int(s.winners) },
    { label: "Win rate", cell: (s) => pct(s.winRate, 1) },
    ...(weighted
      ? [
          {
            label: "Weighted avg. return",
            hint: "Each trade counted by its position size, as the service publishes it",
            cell: (s: PeriodStats) => <span className={`font-semibold ${tone(s.weightedAvgReturn)}`}>{pct(s.weightedAvgReturn)}</span>,
          },
          {
            label: "Avg. return (unweighted)",
            cell: (s: PeriodStats) => <span className={tone(s.avgReturn)}>{pct(s.avgReturn)}</span>,
          },
        ]
      : [
          {
            label: "Average return",
            hint: "Mean return per closed trade",
            cell: (s: PeriodStats) => <span className={`font-semibold ${tone(s.avgReturn)}`}>{pct(s.avgReturn)}</span>,
          },
        ]),
    { label: "Avg. days held", cell: (s) => days(s.avgDaysHeld) },
  ];

  return (
    <div className="overflow-x-auto">
      <table className={`num w-full min-w-[620px] ${compact ? "text-[13px]" : "text-sm"}`}>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 pr-3 font-medium" />
            {PERIODS.map((p) => (
              <th key={p} className="px-3 py-2 text-right font-medium">
                {PERIOD_LABEL[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/70 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-medium text-ink" title={r.hint}>
                {r.label}
              </th>
              {PERIODS.map((p) => (
                <td key={p} className="px-3 py-2 text-right">
                  {r.cell(stats[p])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
