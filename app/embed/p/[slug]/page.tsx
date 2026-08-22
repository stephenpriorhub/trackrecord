import { notFound } from "next/navigation";
import { loadEmbedView, parseEmbedOptions, type EmbedRow, type EmbedOptions } from "@/lib/managed/embed";
import { marketDataDelayMinutes } from "@/lib/massive";
import type { D } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * The public portfolio embed.
 *
 * Light theme on purpose: this is dropped into marketing and subscriber pages,
 * which are light, and an embed that fights its host looks broken.
 *
 * Responsive without JavaScript: the tables become stacked cards under 720px
 * rather than scrolling sideways, because a reader on a phone should not have to
 * discover a horizontal scrollbar to see the return.
 *
 * Query params:  ?show=open|closed|both  &returns=0  &comments=0
 */
export default async function PortfolioEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const options = parseEmbedOptions(await searchParams);
  const view = await loadEmbedView(slug, options);
  if (!view) notFound();

  const showOpen = options.show === "open" || options.show === "both";
  const showClosed = options.show === "closed" || options.show === "both";

  return (
    <>
      <style>{CSS}</style>
      <div className="pf">
        <header className="pf-head">
          <h1>{view.portfolio.name}</h1>
          {options.returns && (
            <p className="pf-summary">
              <span>
                <strong>{view.portfolio.name.replace(/ Portfolio$/, "")}:</strong>{" "}
                <Pct v={view.portfolioReturn} />
              </span>
              {view.benchmarkReturn !== null && (
                <span>
                  <strong>{view.portfolio.benchmarkTicker}:</strong>{" "}
                  <Pct v={view.benchmarkReturn} />
                </span>
              )}
            </p>
          )}
          <p className="pf-asof">{asOfLine(view.priceAsOf, view.hasPrevClosePricing)}</p>
        </header>

        {showOpen && (
          <Section title="Open Positions" rows={view.open} kind="open" options={options} />
        )}
        {showClosed && (
          <Section title="Closed Positions" rows={view.closed} kind="closed" options={options} />
        )}
      </div>
      {/* Report our height so a host page can size the iframe without a scrollbar. */}
      <script dangerouslySetInnerHTML={{ __html: RESIZE }} />
    </>
  );
}

/**
 * The freshness line. Three cases, because claiming more than we know is the one
 * thing this line must never do:
 *
 *   timestamped print  -> "Current price last updated <stamp> ET · delayed 15 min"
 *   previous close only -> says so; on this data plan every option lands here,
 *                          arriving with a price but no timestamp at all
 *   nothing priced yet  -> says that plainly
 */
function asOfLine(at: Date | null, prevCloseOnly: boolean): string {
  const delay = marketDataDelayMinutes();
  if (!at) {
    return prevCloseOnly
      ? "Current prices are the previous session's close."
      : "Current prices not yet available.";
  }
  const stamp = at.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const base = `Current price last updated ${stamp} ET · market data delayed ${delay} minutes`;
  return prevCloseOnly ? `${base} · some prices are the previous close` : base;
}

function Pct({ v }: { v: D | null }) {
  if (v === null) return <span className="dim">—</span>;
  const n = Number(v.toString()) * 100;
  return (
    <span className={n >= 0 ? "gain" : "loss"}>
      {n >= 0 ? "+" : ""}
      {n.toFixed(2)}%
    </span>
  );
}

function Money({ v }: { v: D | null }) {
  if (v === null) return <span className="dim">—</span>;
  return <>${Number(v.toString()).toFixed(2)}</>;
}

function day(d: Date | null): string {
  if (!d) return "—";
  // MM/DD/YY, matching the mockup.
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function Section({
  title,
  rows,
  kind,
  options,
}: {
  title: string;
  rows: EmbedRow[];
  kind: "open" | "closed";
  options: EmbedOptions;
}) {
  const cols: string[] =
    kind === "open"
      ? [
          "Date Added",
          "Stock",
          "Entry Price",
          "Underlying Company",
          "Current Price",
          ...(options.returns ? ["% Change"] : []),
          "Buy Up To Price",
          "Stop-Loss",
          ...(options.comments ? ["Comments"] : []),
        ]
      : [
          "Date Added",
          "Date Closed",
          "Stock",
          "Entry Price",
          "Closed Price",
          ...(options.returns ? ["Gain or Loss %"] : []),
          "Time Held",
          "Underlying Company",
          ...(options.comments ? ["Comments"] : []),
        ];

  return (
    <section className="pf-card">
      <h2>{title}</h2>

      {rows.length === 0 ? (
        <p className="pf-empty">No {kind} positions.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Date Added">{day(r.openedAt)}</td>
                {kind === "closed" && <td data-label="Date Closed">{day(r.closedAt)}</td>}
                <td data-label="Stock" className="sym">
                  ${r.ticker}
                </td>
                <td data-label="Entry Price">
                  <Money v={r.entryPrice} />
                </td>
                <td data-label={kind === "open" ? "Underlying Company" : "Closed Price"}>
                  {kind === "open" ? (
                    (r.companyName ?? "—")
                  ) : (
                    <Money v={r.currentPrice} />
                  )}
                </td>
                {kind === "open" && (
                  <td data-label="Current Price">
                    {r.unpriced ? <span className="dim">—</span> : <Money v={r.currentPrice} />}
                  </td>
                )}
                {options.returns && (
                  <td data-label={kind === "open" ? "% Change" : "Gain or Loss %"}>
                    <Pct v={r.returnPct} />
                  </td>
                )}
                {kind === "open" ? (
                  <>
                    <td data-label="Buy Up To Price">
                      <Money v={r.buyUpTo} />
                    </td>
                    <td data-label="Stop-Loss">
                      <Money v={r.stopLoss} />
                    </td>
                  </>
                ) : (
                  <>
                    <td data-label="Time Held">{r.daysHeld === null ? "—" : `${r.daysHeld}d`}</td>
                    <td data-label="Underlying Company">{r.companyName ?? "—"}</td>
                  </>
                )}
                {options.comments && (
                  // `blank` hides the row entirely in the stacked mobile layout:
                  // a "Comments" label with nothing beside it reads as broken.
                  <td data-label="Comments" className={r.comment ? "cmt" : "cmt blank"}>
                    {r.comment ?? ""}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Self-contained CSS. No Tailwind and no external stylesheet: this page is
 * rendered inside someone else's site, so it must not depend on anything the
 * host loads or leak styles the host did not ask for.
 */
const CSS = `
.pf { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937; background: #e9ecef; padding: 16px; box-sizing: border-box; }
.pf * { box-sizing: border-box; }
.pf-head { padding: 4px 8px 16px; }
.pf-head h1 { margin: 0; font-size: 26px; font-weight: 700; color: #111827; }
.pf-summary { margin: 8px 0 0; font-size: 15px; display: flex; flex-wrap: wrap; gap: 22px; }
.pf-summary strong { font-weight: 700; color: #111827; }
.pf-asof { margin: 8px 0 0; font-size: 12px; color: #6b7280; }
.pf-card { background: #fff; border-radius: 12px; padding: 20px; margin-bottom: 20px;
           box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.pf-card h2 { margin: 0 0 16px; font-size: 19px; font-weight: 700; color: #111827; }
.pf-empty { margin: 0; font-size: 14px; color: #6b7280; }
.pf table { width: 100%; border-collapse: collapse; font-size: 14px; }
.pf th { text-align: center; font-weight: 700; color: #374151; padding: 8px 10px;
         border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
.pf th:first-child, .pf td:first-child { text-align: left; }
.pf td { text-align: center; padding: 12px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
.pf tbody tr:last-child td { border-bottom: none; }
.pf .sym { font-weight: 700; color: #111827; }
.pf .cmt { text-align: left; color: #6b7280; font-size: 13px; }
.pf .gain { color: #059669; font-weight: 600; }
.pf .loss { color: #dc2626; font-weight: 600; }
.pf .dim { color: #9ca3af; }

/* Under 720px each row becomes its own card with the column name beside each
   value, so nothing needs horizontal scrolling on a phone. */
@media (max-width: 720px) {
  .pf { padding: 10px; }
  .pf-card { padding: 14px; }
  .pf thead { display: none; }
  .pf table, .pf tbody, .pf tr, .pf td { display: block; width: 100%; }
  .pf tr { border: 1px solid #e5e7eb; border-radius: 10px; padding: 6px 10px; margin-bottom: 10px; }
  .pf td { display: flex; justify-content: space-between; gap: 12px; text-align: right;
           border-bottom: 1px solid #f3f4f6; padding: 7px 0; }
  .pf tr td:last-child { border-bottom: none; }
  .pf td:first-child { text-align: right; }
  .pf td::before { content: attr(data-label); font-weight: 600; color: #6b7280;
                   text-align: left; flex: 0 0 auto; }
  .pf .cmt { text-align: right; }
  .pf td.blank { display: none; }
}

@media (prefers-color-scheme: dark) {
  /* Only when the host has not forced a light context. Kept conservative: an
     embed that guesses wrong is worse than one that stays light. */
  .pf[data-theme="dark"] { background: #0b0f14; color: #e5e7eb; }
}
`;

/**
 * Tell the parent page how tall we are, so the iframe can be sized without an
 * inner scrollbar. Posts on load and whenever the content reflows.
 */
const RESIZE = `
(function () {
  if (window.parent === window) return;
  var last = 0;
  function send() {
    var h = document.documentElement.scrollHeight;
    if (h === last) return;
    last = h;
    window.parent.postMessage({ type: "oxfordhub:portfolio-embed:height", height: h, path: location.pathname }, "*");
  }
  send();
  window.addEventListener("load", send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
  else setInterval(send, 1000);
})();
`;
