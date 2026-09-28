import { marketDataDelayMinutes } from "@/lib/massive";
import type { EmbedBlock, EmbedRow, EmbedOptions, EmbedView } from "@/lib/managed/embed";
import type { D } from "@/lib/money";

/**
 * The rendered embed, shared by the single-portfolio and whole-service routes.
 *
 * One component on purpose: a service embed that laid its own table out would
 * drift from the per-portfolio embeds it aggregates, and the two would
 * eventually disagree about the same position. Everything that differs between
 * them is already decided in lib/managed/embed.ts and arrives here as data.
 *
 * Light by default, because this is dropped into marketing and subscriber
 * pages, which are light. Everything visual runs through CSS variables so the
 * look options (theme, background, cards, accent, font, density, corners) are
 * attribute and variable swaps, never a second stylesheet.
 *
 * Responsive without JavaScript: the tables become stacked cards under 720px
 * rather than scrolling sideways, because a reader on a phone should not have to
 * discover a horizontal scrollbar to see the return. (The optional reader
 * tabs are the one script, and without it every group simply stays visible.)
 */
export default function EmbedBody({ view }: { view: EmbedView }) {
  const options = view.options;
  const look = options.look;
  const grouped = view.groups.length > 0;

  // Only validated values reach here (see parseEmbedOptions): a #hex, "none",
  // or null for the theme default.
  const vars: Record<string, string> = {};
  if (look.background) {
    vars["--pf-bg"] = look.background === "none" ? "transparent" : look.background;
  }
  if (look.accent) vars["--pf-accent"] = look.accent;

  return (
    <>
      <style>{CSS}</style>
      <div
        className="pf"
        data-theme={look.theme}
        data-cards={look.cards ? "on" : "off"}
        data-density={look.density}
        data-corners={look.corners}
        data-font={look.font}
        data-bg={look.background === "none" ? "none" : undefined}
        style={vars as React.CSSProperties}
      >
        {view.preview && (
          // Loud and unmissable: this render includes a book that is NOT public,
          // so nobody should paste this URL into a page believing it will work.
          <p className="pf-preview">
            Preview — not published. Visitors see Not Found until this portfolio
            is set to Public.
          </p>
        )}
        <header className="pf-head">
          {look.title && <h1>{view.title}</h1>}
          {view.kind === "service" && !grouped && view.included.length > 1 && (
            <p className="pf-books">
              {view.included.map((b) => b.name).join(" · ")}
            </p>
          )}
          {options.summary !== "none" && options.total && (
            <div data-pf-overall>
              <Summary
                block={view}
                options={options}
                // Says exactly what the figure covers — never the publication's
                // name over a subset of it.
                label={view.totalLabel}
              />
            </div>
          )}
          <p className="pf-asof">{asOfLine(view.priceAsOf, view.priceSources)}</p>
        </header>

        {options.tabs && (
          // Hidden until the script runs: without JavaScript the tabs could not
          // switch anything, and every group simply stays visible below.
          <div className="pf-tabbar" hidden>
            <p className="pf-tablabel" id="pf-tablabel">Select a portfolio:</p>
            <nav className="pf-tabs" role="tablist" aria-labelledby="pf-tablabel">
              {options.allTab && (
                <button type="button" role="tab" aria-selected="false" data-pf-tab="">
                  All portfolios
                </button>
              )}
              {view.groups.map((g) => (
                <button key={g.slug} type="button" role="tab" aria-selected="false" data-pf-tab={g.slug ?? ""}>
                  {g.title}
                </button>
              ))}
            </nav>
          </div>
        )}

        {grouped ? (
          view.groups.map((g) => (
            <section key={g.slug} className="pf-group" data-group={g.slug}>
              <div className="pf-group-head">
                <h2>{g.title}</h2>
                {g.description && <p className="pf-desc">{g.description}</p>}
                {options.summary !== "none" && (
                  <Summary block={g} options={options} />
                )}
              </div>
              <Tables block={g} options={options} level={3} />
            </section>
          ))
        ) : (
          <Tables block={view} options={options} level={2} />
        )}
      </div>
      {/* Report our height so a host page can size the iframe without a scrollbar. */}
      <script dangerouslySetInnerHTML={{ __html: RESIZE }} />
      {options.tabs && <script dangerouslySetInnerHTML={{ __html: TABS }} />}
    </>
  );
}

/**
 * "{Portfolio}: +x%   S&P 500: +y% since 11/25/25".
 *
 * The portfolio figure is the TOTAL return per position — realized exits and
 * the marked remainder blended — so a partly sold winner counts once and counts
 * in full. The index is measured over the same window, from the book's start.
 */
function Summary({
  block,
  options,
  label,
}: {
  block: EmbedBlock;
  options: EmbedOptions;
  label?: string;
}) {
  const compare =
    options.summary === "benchmark" &&
    block.showBenchmark &&
    block.benchmarkReturn !== null;
  return (
    <>
      <p className="pf-summary">
        <span>
          <strong>{label ?? block.title.replace(/ Portfolio$/, "")}:</strong>{" "}
          <Pct v={block.portfolioReturn} />
        </span>
        {/* Only when the page asked for a comparison AND there is one to make.
            A book with the benchmark switched off, or one the index cannot
            cover, falls back to its own figure alone rather than printing a
            blank next to a label. */}
        {compare && (
          <span>
            <strong>{block.benchmarkName}:</strong> <Pct v={block.benchmarkReturn} />
          </span>
        )}
        {block.benchmarkFrom && (compare || options.summary === "portfolio") && (
          // The window, because "+12%" is meaningless without it — and because
          // it shows the two figures cover the same period.
          <span className="dim">since {day(block.benchmarkFrom)}</span>
        )}
      </p>
      {block.partials > 0 && (
        <p className="pf-basis">
          Total return per position, equal-weighted across {block.measured}{" "}
          position{block.measured === 1 ? "" : "s"} — includes realized gains
          on {block.partials} partially closed.
        </p>
      )}
    </>
  );
}

function Tables({
  block,
  options,
  level,
}: {
  block: EmbedBlock;
  options: EmbedOptions;
  level: 2 | 3;
}) {
  const showOpen = options.show === "open" || options.show === "both";
  const showClosed = options.show === "closed" || options.show === "both";
  return (
    <>
      {showOpen && (
        <Section title="Open Positions" rows={block.open} kind="open" options={options} level={level} />
      )}
      {showClosed && (
        <Section
          title="Closed Positions"
          rows={block.closed}
          kind="closed"
          options={options}
          level={level}
          // Say plainly that the table is a slice. The percentages above are
          // computed over the whole record, so a reader who is not told would
          // reasonably assume these rows are what produced them.
          note={
            block.closedTotal > block.closed.length
              ? `Showing the ${block.closed.length} most recent of ${block.closedTotal.toLocaleString()} closed positions. Returns above cover all of them.`
              : null
          }
        />
      )}
    </>
  );
}

/**
 * The freshness line.
 *
 * Built from the price sources actually in play, because one blanket caveat
 * would misdescribe at least one of them: an exchange print really is delayed
 * ~15 minutes, while an interval fund's NAV is a once-a-day figure that is not
 * "delayed" at all. Claiming more precision than the data has is the one thing
 * this line must never do.
 */
function asOfLine(at: Date | null, sources: string[]): string {
  if (!at && sources.length === 0) return "Current prices not yet available.";

  const notes: string[] = [];
  if (sources.includes("LAST_TRADE")) {
    notes.push(`market data delayed ${marketDataDelayMinutes()} minutes`);
  }
  if (sources.includes("NAV")) notes.push("fund prices are the last published NAV");
  if (sources.includes("PREV_CLOSE")) notes.push("some prices are the previous close");
  if (sources.includes("MANUAL")) notes.push("some prices are entered by the editor");

  if (!at) return notes.length ? `Current prices: ${notes.join(" · ")}` : "Current prices not yet available.";

  const stamp = at.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return [`Current price last updated ${stamp} ET`, ...notes].join(" · ");
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
  level,
  note = null,
}: {
  title: string;
  rows: EmbedRow[];
  kind: "open" | "closed";
  options: EmbedOptions;
  level: 2 | 3;
  note?: string | null;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const cols = columnsFor(kind, options);

  return (
    <section className="pf-card">
      <Heading className="pf-title">{title}</Heading>
      {note && <p className="pf-note">{note}</p>}

      {rows.length === 0 ? (
        <p className="pf-empty">No {kind} positions.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    data-label={c.label}
                    className={typeof c.className === "function" ? c.className(r) : c.className}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface Column {
  key: string;
  label: string;
  cell: (r: EmbedRow) => React.ReactNode;
  className?: string | ((r: EmbedRow) => string);
}

/**
 * The columns each table shows, in order, minus any the page switched off.
 *
 * One list drives both the header and every cell, so a hidden column can never
 * leave the header and the body out of step. Stock is never optional: a row
 * with no ticker is not a position anyone can read.
 */
function columnsFor(kind: "open" | "closed", options: EmbedOptions): Column[] {
  const on = (key: string) => !options.hideColumns.includes(key);
  const money = (v: D | null) => <Money v={v} />;
  const company: Column = {
    key: "company",
    label: "Underlying Company",
    cell: (r) => r.companyName ?? "—",
  };
  const all: (Column | false)[] =
    kind === "open"
      ? [
          on("added") && { key: "added", label: "Date Added", cell: (r) => day(r.openedAt) },
          { key: "stock", label: "Stock", className: "sym", cell: (r) => `$${r.ticker}` },
          // Only a merged service embed carries this column; on a single book
          // every row would answer the same, which is just noise.
          options.portfolioColumn && { key: "portfolio", label: "Portfolio", className: "book", cell: (r) => r.portfolioName },
          on("entry") && { key: "entry", label: "Entry Price", cell: (r) => money(r.entryPrice) },
          on("company") && company,
          on("current") && {
            key: "current",
            label: "Current Price",
            cell: (r) => (r.unpriced ? <span className="dim">—</span> : money(r.currentPrice)),
          },
          options.returns && { key: "return", label: "% Change", cell: (r) => <Pct v={r.returnPct} /> },
          on("buyupto") && { key: "buyupto", label: "Buy Up To Price", cell: (r) => money(r.buyUpTo) },
          on("stop") && { key: "stop", label: "Stop-Loss", cell: (r) => money(r.stopLoss) },
          options.comments && commentColumn,
        ]
      : [
          on("added") && { key: "added", label: "Date Added", cell: (r) => day(r.openedAt) },
          on("closed") && { key: "closed", label: "Date Closed", cell: (r) => day(r.closedAt) },
          { key: "stock", label: "Stock", className: "sym", cell: (r) => `$${r.ticker}` },
          options.portfolioColumn && { key: "portfolio", label: "Portfolio", className: "book", cell: (r) => r.portfolioName },
          on("entry") && { key: "entry", label: "Entry Price", cell: (r) => money(r.entryPrice) },
          on("current") && { key: "current", label: "Closed Price", cell: (r) => money(r.currentPrice) },
          options.returns && { key: "return", label: "Gain or Loss %", cell: (r) => <Pct v={r.returnPct} /> },
          on("held") && {
            key: "held",
            label: "Time Held",
            cell: (r) => (r.daysHeld === null ? "—" : `${r.daysHeld}d`),
          },
          on("company") && company,
          options.comments && commentColumn,
        ];
  return all.filter((c): c is Column => c !== false);
}

const commentColumn: Column = {
  key: "comments",
  label: "Comments",
  // `blank` hides the cell entirely in the stacked mobile layout: a "Comments"
  // label with nothing beside it reads as broken.
  className: (r) => (r.comment ? "cmt" : "cmt blank"),
  cell: (r) => r.comment ?? "",
};

/**
 * Self-contained CSS. No Tailwind and no external stylesheet: this page is
 * rendered inside someone else's site, so it must not depend on anything the
 * host loads or leak styles the host did not ask for.
 */
const CSS = `
.pf {
  --pf-bg: #e9ecef; --pf-card: #fff; --pf-text: #374151; --pf-strong: #111827;
  --pf-muted: #6b7280; --pf-dim: #9ca3af; --pf-line: #e5e7eb; --pf-line2: #f3f4f6;
  --pf-gain: #059669; --pf-loss: #dc2626; --pf-radius: 12px;
  --pf-cell: 12px 10px; --pf-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--pf-text); background: var(--pf-bg); padding: 16px; box-sizing: border-box;
}
/* Dark is only ever chosen explicitly (?theme=dark). No color-scheme is
   declared, on purpose: an iframe whose color-scheme differs from its host's
   gets an opaque canvas painted behind it, which would break a transparent
   background. */
.pf[data-theme="dark"] {
  --pf-bg: #0b0f14; --pf-card: #121821; --pf-text: #d1d5db; --pf-strong: #f9fafb;
  --pf-muted: #9ca3af; --pf-dim: #6b7280; --pf-line: #243041; --pf-line2: #1a2230;
  --pf-gain: #34d399; --pf-loss: #f87171;
}
.pf[data-font="serif"] { font-family: Georgia, "Times New Roman", serif; }
.pf[data-corners="square"] { --pf-radius: 0px; }
.pf[data-density="compact"] { --pf-cell: 6px 8px; --pf-size: 13px; }
.pf[data-bg="none"] { padding-left: 0; padding-right: 0; }
.pf * { box-sizing: border-box; }
.pf-head { padding: 4px 8px 16px; }
.pf-head h1 { margin: 0 0 8px; font-size: 26px; font-weight: 700; color: var(--pf-accent, var(--pf-strong)); }
.pf-summary { margin: 0; font-size: 15px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 22px; }
.pf-summary strong { font-weight: 700; color: var(--pf-strong); }
.pf-summary .dim { font-size: 13px; }
.pf-basis { margin: 4px 0 0; font-size: 12px; color: var(--pf-muted); }
.pf-asof { margin: 8px 0 0; font-size: 12px; color: var(--pf-muted); }
.pf-preview { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; font-size: 13px;
              font-weight: 600; color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; }
.pf-books { margin: 0 0 8px; font-size: 13px; color: var(--pf-muted); }
.pf-tabbar { margin: 0 0 18px; }
.pf-tabbar[hidden] { display: none; }
.pf-tablabel { margin: 0 0 4px; padding: 0 8px; font-size: 13px; font-weight: 600; color: var(--pf-muted); }
.pf-tabs { display: flex; gap: 4px; padding: 0 8px; overflow-x: auto;
           border-bottom: 1px solid var(--pf-line); scrollbar-width: none; }
.pf-tabs::-webkit-scrollbar { display: none; }
.pf-tabs button { font: inherit; font-size: 14px; font-weight: 600; color: var(--pf-muted);
                  background: none; border: 0; border-bottom: 2px solid transparent;
                  padding: 10px 14px; margin-bottom: -1px; white-space: nowrap; cursor: pointer; }
.pf-tabs button:hover { color: var(--pf-strong); }
.pf-tabs button[aria-selected="true"] { color: var(--pf-accent, var(--pf-strong));
                                        border-bottom-color: var(--pf-accent, var(--pf-strong)); }
.pf-tabs button:focus-visible { outline: 2px solid var(--pf-accent, #2563eb); outline-offset: -2px; }
/* On a single-book tab its own heading repeats the tab label, so drop it. */
.pf[data-tab-active] .pf-group-head h2 { display: none; }
.pf[data-tab-active] .pf-group-head { border-top: 0; padding-top: 0; }
.pf-group { margin: 8px 0 28px; }
.pf-group[hidden] { display: none; }
.pf-group-head { padding: 12px 8px 14px; border-top: 2px solid var(--pf-accent, var(--pf-line)); }
.pf-group-head h2 { margin: 0 0 6px; font-size: 21px; font-weight: 700; color: var(--pf-accent, var(--pf-strong)); }
.pf-desc { margin: 0 0 8px; font-size: 13px; color: var(--pf-muted); }
.pf .book { color: var(--pf-muted); font-size: 13px; white-space: nowrap; }
.pf-card { background: var(--pf-card); border-radius: var(--pf-radius); padding: 20px; margin-bottom: 20px;
           box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.pf[data-cards="off"] .pf-card { background: transparent; box-shadow: none; padding: 4px 8px 0; margin-bottom: 24px; }
.pf-title { margin: 0 0 16px; font-size: 19px; font-weight: 700; color: var(--pf-strong); }
h3.pf-title { font-size: 16px; margin-bottom: 12px; }
.pf-empty { margin: 0; font-size: 14px; color: var(--pf-muted); }
.pf-note { margin: -8px 0 14px; font-size: 12px; color: var(--pf-muted); }
.pf table { width: 100%; border-collapse: collapse; font-size: var(--pf-size); }
.pf th { text-align: center; font-weight: 700; color: var(--pf-text); padding: 8px 10px;
         border-bottom: 1px solid var(--pf-line); white-space: nowrap; }
.pf th:first-child, .pf td:first-child { text-align: left; }
.pf td { text-align: center; padding: var(--pf-cell); border-bottom: 1px solid var(--pf-line2); color: var(--pf-text); }
.pf tbody tr:last-child td { border-bottom: none; }
.pf .sym { font-weight: 700; color: var(--pf-accent, var(--pf-strong)); }
.pf .cmt { text-align: left; color: var(--pf-muted); font-size: 13px; }
.pf .gain { color: var(--pf-gain); font-weight: 600; }
.pf .loss { color: var(--pf-loss); font-weight: 600; }
.pf .dim { color: var(--pf-dim); }

/* Under 720px each row becomes its own card with the column name beside each
   value, so nothing needs horizontal scrolling on a phone. */
@media (max-width: 720px) {
  .pf { padding: 10px; }
  .pf-card { padding: 14px; }
  .pf thead { display: none; }
  .pf table, .pf tbody, .pf tr, .pf td { display: block; width: 100%; }
  .pf tr { border: 1px solid var(--pf-line); border-radius: min(var(--pf-radius), 10px); padding: 6px 10px; margin-bottom: 10px; }
  .pf td { display: flex; justify-content: space-between; gap: 12px; text-align: right;
           border-bottom: 1px solid var(--pf-line2); padding: 7px 0; }
  .pf tr td:last-child { border-bottom: none; }
  .pf td:first-child { text-align: right; }
  .pf td::before { content: attr(data-label); font-weight: 600; color: var(--pf-muted);
                   text-align: left; flex: 0 0 auto; }
  .pf .book { text-align: right; white-space: normal; }
  .pf .cmt { text-align: right; }
  .pf td.blank { display: none; }
  .pf-tabs button { padding: 10px 12px; font-size: 13px; }
}
`;

/**
 * The reader-facing portfolio tabs. Every group is already in the page, so
 * switching is instant and needs no request. "All portfolios" (when enabled)
 * shows the publication headline and every group; a single tab shows only that
 * book, whose own headline is then the figure being read. Whichever tab comes
 * first opens selected. Arrow keys move between tabs.
 *
 * Never scrollIntoView here: inside an iframe it scrolls the HOST page too, so
 * a reader would be yanked to the embed on load. Only the tab strip scrolls.
 */
const TABS = `
(function () {
  var bar = document.querySelector(".pf-tabbar");
  var nav = document.querySelector(".pf-tabs");
  var pf = document.querySelector(".pf");
  if (!bar || !nav || !pf) return;
  bar.hidden = false;
  var tabs = Array.prototype.slice.call(nav.querySelectorAll("[data-pf-tab]"));
  function select(tab) {
    var v = tab.getAttribute("data-pf-tab");
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll("[data-group]").forEach(function (g) {
      g.hidden = !!v && g.getAttribute("data-group") !== v;
    });
    var o = document.querySelector("[data-pf-overall]");
    if (o) o.hidden = !!v;
    if (v) pf.setAttribute("data-tab-active", v); else pf.removeAttribute("data-tab-active");
    var l = tab.offsetLeft - nav.offsetLeft, r = l + tab.offsetWidth;
    if (l < nav.scrollLeft) nav.scrollLeft = l;
    else if (r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = r - nav.clientWidth;
  }
  tabs.forEach(function (t, i) {
    t.tabIndex = i === 0 ? 0 : -1;
    t.addEventListener("click", function () { select(t); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
  if (tabs.length) select(tabs[0]);
})();
`;

/**
 * Tell the parent page how tall we are, so the iframe can be sized without an
 * inner scrollbar. Posts on load and whenever the content reflows.
 */
const RESIZE = `
(function () {
  if (window.parent === window) return;
  var last = 0;
  // Measure the embed itself, not the document: a document's scrollHeight never
  // drops below the iframe's current height, so once grown the frame could
  // never shrink back (e.g. when a reader picks one portfolio from the dropdown).
  var pf = document.querySelector(".pf");
  function send() {
    var h = pf ? Math.ceil(pf.getBoundingClientRect().height) : document.documentElement.scrollHeight;
    if (h === last) return;
    last = h;
    window.parent.postMessage({ type: "oxfordhub:portfolio-embed:height", height: h, path: location.pathname }, "*");
  }
  send();
  window.addEventListener("load", send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(pf || document.documentElement);
  else setInterval(send, 1000);
})();
`;
