import { chipTone, fmtDate, int, price, signedPct, tone } from "@/lib/tr/format";
import type { EmbedBlock, EmbedRow, EmbedView } from "@/lib/managed/embed";

const n = (d: { toNumber(): number } | null | undefined) => (d ? d.toNumber() : null);

function Rows({ rows, closed, showBenchmark }: { rows: EmbedRow[]; closed: boolean; showBenchmark: boolean }) {
  void showBenchmark;
  if (rows.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted">None.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[640px] text-sm">
        <thead className="bg-paper">
          <tr className="text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Holding</th>
            <th className="px-3 py-2 font-medium">Added</th>
            {closed && <th className="px-3 py-2 font-medium">Closed</th>}
            <th className="px-3 py-2 text-right font-medium">Entry</th>
            <th className="px-3 py-2 text-right font-medium">{closed ? "Exit" : "Current"}</th>
            <th className="px-3 py-2 text-right font-medium">Return</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-3 py-2">
                <p className="font-medium">{r.ticker}</p>
                {r.companyName && <p className="text-xs text-muted">{r.companyName}</p>}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.openedAt)}</td>
              {closed && <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.closedAt)}</td>}
              <td className="px-3 py-2 text-right">{price(n(r.entryPrice))}</td>
              <td className="px-3 py-2 text-right">{price(n(r.currentPrice))}</td>
              <td className="px-3 py-2 text-right">
                <span className={`inline-block rounded-md px-2 py-0.5 font-semibold ${chipTone(n(r.returnPct))}`}>
                  {r.unpriced ? "—" : signedPct(n(r.returnPct))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ block, showBenchmark }: { block: EmbedBlock; showBenchmark: boolean }) {
  const pr = n(block.portfolioReturn);
  const br = n(block.benchmarkReturn);
  return (
    <section className="rounded-2xl border border-line bg-card shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold">{block.title}</h3>
          {block.description && <p className="mt-0.5 max-w-2xl text-sm text-muted">{block.description}</p>}
        </div>
        <dl className="num flex gap-6 text-right">
          <div>
            <dt className="text-xs text-muted">Avg. return per position</dt>
            <dd className={`text-xl font-semibold ${tone(pr)}`}>{signedPct(pr)}</dd>
          </div>
          {showBenchmark && block.showBenchmark && (
            <div>
              <dt className="text-xs text-muted">
                {block.benchmarkName}
                {block.benchmarkFrom && <> since {fmtDate(block.benchmarkFrom)}</>}
              </dt>
              <dd className={`text-xl font-semibold ${tone(br)}`}>{signedPct(br)}</dd>
            </div>
          )}
        </dl>
      </header>
      <div className="px-2 py-3">
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-faint">Open positions · {int(block.open.length)}</p>
        <Rows rows={block.open} closed={false} showBenchmark={showBenchmark} />
        {block.closedTotal > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer px-3 text-sm text-brand">Closed positions ({int(block.closedTotal)})</summary>
            <div className="mt-2">
              <Rows rows={block.closed} closed showBenchmark={showBenchmark} />
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

/** A long-term service: one block per portfolio, as the widgets show it. */
export function LongTermRecord({ view, showBenchmark }: { view: EmbedView | null; showBenchmark: boolean }) {
  if (!view || (view.open.length === 0 && view.closedTotal === 0 && view.groups.length === 0)) {
    return (
      <section className="rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
        <p className="font-medium">No positions published yet.</p>
        <p className="mt-1 text-sm text-muted">
          Holdings appear here once they are added to this service in Portfolio Manager.
        </p>
      </section>
    );
  }
  const blocks = view.groups.length > 0 ? view.groups : [view];
  return (
    <div className="space-y-6">
      {view.groups.length > 1 && (
        <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Portfolio summary</h2>
          <dl className="num mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl bg-paper px-4 py-3">
              <dt className="text-xs text-muted">Portfolios</dt>
              <dd className="text-2xl font-semibold">{int(view.groups.length)}</dd>
            </div>
            <div className="rounded-xl bg-paper px-4 py-3">
              <dt className="text-xs text-muted">Open positions</dt>
              <dd className="text-2xl font-semibold">{int(view.groups.reduce((a, g) => a + g.open.length, 0))}</dd>
            </div>
            <div className="rounded-xl bg-paper px-4 py-3">
              <dt className="text-xs text-muted">Avg. return per position</dt>
              <dd className={`text-2xl font-semibold ${tone(n(view.portfolioReturn))}`}>{signedPct(n(view.portfolioReturn))}</dd>
            </div>
            {showBenchmark && (
              <div className="rounded-xl bg-paper px-4 py-3">
                <dt className="text-xs text-muted">{view.benchmarkName}, same span</dt>
                <dd className={`text-2xl font-semibold ${tone(n(view.benchmarkReturn))}`}>{signedPct(n(view.benchmarkReturn))}</dd>
              </div>
            )}
          </dl>
        </section>
      )}
      {blocks.map((b, i) => (
        <Block key={b.slug ?? i} block={b} showBenchmark={showBenchmark} />
      ))}
    </div>
  );
}
