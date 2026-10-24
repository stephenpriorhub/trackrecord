import { chipTone, fmtDate, int, price, signedPct, tone } from "@/lib/tr/format";
import type { EmbedBlock, EmbedRow } from "@/lib/managed/embed";
import type { LongTermBook } from "@/lib/tr/longterm";
import { splitReturns } from "@/lib/tr/longterm-math";

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

function ReturnFigures({
  total,
  split,
  spx,
  spxFrom,
  large = false,
}: {
  total: number | null;
  split: ReturnType<typeof splitReturns>;
  /** undefined = don't show the benchmark at all. */
  spx?: number | null;
  spxFrom?: Date | null;
  large?: boolean;
}) {
  const big = large ? "text-2xl font-bold" : "text-xl font-semibold";
  const small = large ? "text-lg font-semibold" : "text-base font-semibold";
  return (
    <dl className="num flex flex-wrap items-end gap-x-6 gap-y-3 text-right">
      <div>
        <dt className="text-xs font-medium text-ink">Total return</dt>
        <dd className={`${big} ${tone(total)}`}>{signedPct(total)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Realized · {int(split.realizedCount)} closed</dt>
        <dd className={`${small} ${tone(split.realized)}`}>{signedPct(split.realized)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Unrealized · {int(split.unrealizedCount)} open</dt>
        <dd className={`${small} ${tone(split.unrealized)}`}>{signedPct(split.unrealized)}</dd>
      </div>
      {spx !== undefined && (
        <div className="border-l border-line pl-6">
          <dt className="text-xs text-muted">S&amp;P 500{spxFrom && <> since {fmtDate(spxFrom)}</>}</dt>
          <dd className={`${small} ${tone(spx)}`}>{signedPct(spx)}</dd>
        </div>
      )}
    </dl>
  );
}

function Block({ block, showBenchmark, bare = false }: { block: EmbedBlock; showBenchmark: boolean; bare?: boolean }) {
  const pr = n(block.portfolioReturn);
  const br = n(block.benchmarkReturn);
  return (
    <section className="rounded-2xl border border-line bg-card shadow-sm">
      {!bare && (
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold">{block.title}</h3>
          {block.description && <p className="mt-0.5 max-w-2xl text-sm text-muted">{block.description}</p>}
        </div>
        <ReturnFigures
          total={pr}
          split={splitReturns([block])}
          spx={showBenchmark && block.showBenchmark ? br : undefined}
          spxFrom={block.benchmarkFrom}
        />
      </header>
      )}
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

function BookSection({ book, showBenchmark }: { book: LongTermBook; showBenchmark: boolean }) {
  const v = book.views[0];
  const blocks = book.views.flatMap((x) => (x.groups.length ? x.groups : [x]));
  const tr = n(v?.portfolioReturn);
  const br = n(v?.benchmarkReturn);
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border-2 border-brand/20 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-ink">{book.label}</h2>
            {book.description && <p className="mt-0.5 max-w-xl text-sm text-muted">{book.description}</p>}
          </div>
          {v && (
            <ReturnFigures
              total={tr}
              split={splitReturns(blocks)}
              spx={showBenchmark ? br : undefined}
              spxFrom={v.benchmarkFrom}
              large
            />
          )}
        </div>
        {v ? (
          <p className="mt-3 text-xs text-faint">
            Each position counts equally. Total return covers everything the portfolio has recommended; realized
            is the positions already closed, at their exit prices; unrealized is the positions still held, at the
            latest price.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">No positions published yet.</p>
        )}
      </div>
      {blocks.length > 1
        ? blocks.map((b, i) => <Block key={b.slug ?? i} block={b} showBenchmark={showBenchmark} />)
        : blocks.map((b, i) => <Block key={b.slug ?? i} block={b} showBenchmark={false} bare />)}
    </section>
  );
}

/**
 * A long-term service: its books one after another, each with its own total
 * return and S&P comparison. Books are never added together.
 */
export function LongTermRecord({ books, showBenchmark }: { books: LongTermBook[]; showBenchmark: boolean }) {
  if (books.every((b) => b.views.length === 0)) {
    return (
      <section className="rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
        <p className="font-medium">No positions published yet.</p>
        <p className="mt-1 text-sm text-muted">
          Holdings appear here once they are added to this service in Portfolio Manager.
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-10">
      {books.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {books.map((b) => (
            <a key={b.key} href={`#book-${b.key}`} className="rounded-full border border-line bg-card px-3 py-1.5 text-brand hover:border-brand">
              {b.label}
            </a>
          ))}
        </nav>
      )}
      {books.map((b) => (
        <div key={b.key} id={`book-${b.key}`} className="scroll-mt-20">
          <BookSection book={b} showBenchmark={showBenchmark} />
        </div>
      ))}
    </div>
  );
}
