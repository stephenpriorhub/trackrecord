import { signedPct, tone } from "@/lib/tr/format";
import type { MarketRow } from "@/lib/tr/market";

export function MarketStrip({ rows, asOf }: { rows: MarketRow[]; asOf: Date | null }) {
  return (
    <section className="rounded-2xl border border-line bg-card shadow-sm">
      <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {rows.map((m) => (
          <div key={m.ticker} className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold text-ink">{m.label}</p>
              <p className="num text-sm text-muted">{m.last !== null ? `$${m.last.toFixed(2)}` : "—"}</p>
            </div>
            <dl className="num mt-2 grid grid-cols-3 gap-2 text-sm">
              {(
                [
                  ["Today", m.day],
                  ["Week to date", m.week],
                  ["Month to date", m.month],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <dt className="text-[11px] text-faint">{label}</dt>
                  <dd className={`font-semibold ${tone(v)}`}>{signedPct(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-5 py-2 text-[11px] text-faint">
        Measured on SPY, QQQ and DIA, the ETFs that track each index.
        {asOf && ` Prices as of ${asOf.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET.`}
      </p>
    </section>
  );
}
