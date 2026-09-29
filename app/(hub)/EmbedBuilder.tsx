"use client";

/**
 * The one embed builder, on its own page (/embeds): pick a publication, then
 * the entire publication or any single portfolio in it, then how it looks.
 *
 * It used to be repeated on every portfolio and publication page, each copy
 * offering only its own slice of the options. One place means every variation
 * is reachable from the same controls.
 *
 * The options are controls rather than a URL people hand-edit, because getting a
 * query string subtly wrong is silent — the embed just renders the default and
 * nobody notices the column they wanted hidden is still there. Every change
 * rewrites the code AND the live preview beside it, so what you see is exactly
 * what you paste.
 *
 * The first choice is WHAT to embed: every portfolio in the publication, any
 * combination of them, or just one. Several are grouped by sub-portfolio (or
 * merged into one table); one on its own is simply that portfolio's embed. "Entire publication" names no books in its URL, so a portfolio
 * added next month appears on every page that already embeds it. A single
 * sub-portfolio is simply that portfolio's own embed URL.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteSavedEmbedAction,
  saveEmbedAction,
  setPortfolioVisibilityAction,
} from "./actions";

type Show = "both" | "open" | "closed";
type Summary = "benchmark" | "portfolio" | "none";
type Layout = "grouped" | "merged";
type Bg = "default" | "white" | "none" | "custom";

const SUMMARY_LABELS: Record<Summary, string> = {
  benchmark: "Portfolio vs S&P 500",
  portfolio: "Portfolio only",
  none: "None",
};

/**
 * Columns that can be switched off, keyed as HIDEABLE_COLUMNS in
 * lib/managed/embed.ts, with which table(s) each appears in.
 */
const OPTIONAL_COLUMNS = [
  { key: "added", label: "Date added", open: true, closed: true },
  { key: "closed", label: "Date closed", open: false, closed: true },
  { key: "entry", label: "Entry price", open: true, closed: true },
  { key: "current", label: "Current / closed price", open: true, closed: true },
  { key: "buyupto", label: "Buy up to", open: true, closed: false },
  { key: "stop", label: "Stop-loss", open: true, closed: false },
  { key: "held", label: "Time held", open: false, closed: true },
  { key: "company", label: "Company", open: true, closed: true },
  { key: "weight", label: "Weight", open: true, closed: true },
];

/** Matches DEFAULT_CLOSED_LIMIT in lib/managed/embed.ts. */
const DEFAULT_LIMIT = 200;

export interface EmbedBook {
  slug: string;
  name: string;
  isPublic: boolean;
  positions: number;
}

export interface EmbedService {
  id: string;
  slug: string;
  name: string;
  books: EmbedBook[];
}

export interface SavedEmbedRow {
  id: string;
  code: string;
  name: string;
  serviceSlug: string;
  target: string;
  query: string;
  updatedAt: string;
  updatedBy: string | null;
}

export default function EmbedBuilder({
  origin,
  services,
  initialService,
  initialTarget,
  editing,
  savedList = [],
}: {
  origin: string;
  /** Publications this person may manage, each with the portfolios they may see. */
  services: EmbedService[];
  initialService?: string;
  /** A portfolio slug to open on alone, or omitted for the entire publication. */
  initialTarget?: string;
  /** A saved embed to open for editing; its settings seed every control. */
  editing?: SavedEmbedRow;
  /** Saved embeds this person may manage. */
  savedList?: SavedEmbedRow[];
}) {
  // A saved embed's stored query string seeds the controls. The builder only
  // ever writes non-default values, so an absent key means the default —
  // except layout, where absent means the original merged table.
  const q = new URLSearchParams(editing?.query ?? "");
  const g = (k: string) => q.get(k);
  const list = (k: string) => (g(k) ? g(k)!.split(",").filter(Boolean) : []);
  const savedTarget = editing?.target.split("/") ?? null;
  const savedBg = g("bg");

  // ---- what ----
  const [serviceSlug, setServiceSlug] = useState<string>(
    editing
      ? editing.serviceSlug
      : services.some((sv) => sv.slug === initialService)
        ? initialService!
        : (services[0]?.slug ?? ""),
  );
  const service = services.find((sv) => sv.slug === serviceSlug) ?? services[0];
  const books = service?.books ?? [];
  const slug = service?.slug ?? "";
  // null = EVERY portfolio, including ones added later (no list in the URL).
  // A list = exactly these, in the publication's own display order.
  const [picked, setPicked] = useState<string[] | null>(
    savedTarget
      ? savedTarget[0] === "p"
        ? [savedTarget[1]]
        : list("only").length
          ? list("only")
          : null
      : initialTarget && books.some((b) => b.slug === initialTarget)
        ? [initialTarget]
        : null,
  );
  const [layout, setLayout] = useState<Layout>(
    editing ? (g("layout") === "grouped" ? "grouped" : "merged") : "grouped",
  );
  const [tabs, setTabs] = useState(editing ? g("tabs") === "1" : true);
  const [allTab, setAllTab] = useState(g("all") !== "0");
  const [order, setOrder] = useState<"default" | "alpha" | "outperformance">(
    g("order") === "alpha" || g("order") === "outperformance"
      ? (g("order") as "alpha" | "outperformance")
      : "default",
  );
  const [sortable, setSortable] = useState(g("sort") !== "0");
  // ---- content ----
  const [show, setShow] = useState<Show>(
    g("show") === "open" || g("show") === "closed" ? (g("show") as Show) : "both",
  );
  const [summary, setSummary] = useState<Summary>(
    g("summary") === "portfolio" || g("summary") === "none" ? (g("summary") as Summary) : "benchmark",
  );
  const [returns, setReturns] = useState(g("returns") !== "0");
  const [comments, setComments] = useState(g("comments") !== "0");
  const [bookColumn, setBookColumn] = useState(g("portfolio") !== "0");
  const [limit, setLimit] = useState(
    g("limit") !== null ? Math.max(0, Number.parseInt(g("limit")!, 10) || 0) : DEFAULT_LIMIT,
  );
  const [hiddenCols, setHiddenCols] = useState<string[]>(list("hidecols"));
  // ---- publication total ----
  const [showTotal, setShowTotal] = useState(g("total") !== "0");
  const [notInTotal, setNotInTotal] = useState<string[]>(list("exclude"));
  // ---- look ----
  const [theme, setTheme] = useState<"light" | "dark">(g("theme") === "dark" ? "dark" : "light");
  const [bg, setBg] = useState<Bg>(
    savedBg === "none"
      ? "none"
      : savedBg === "ffffff" || savedBg === "000000"
        ? "white"
        : savedBg
          ? "custom"
          : "default",
  );
  const [bgColor, setBgColor] = useState(
    savedBg && savedBg !== "none" && savedBg !== "ffffff" && savedBg !== "000000"
      ? `#${savedBg}`
      : "#f5f5f4",
  );
  const [cards, setCards] = useState(g("cards") !== "0");
  const [accentOn, setAccentOn] = useState(!!g("accent"));
  const [accent, setAccent] = useState(g("accent") ? `#${g("accent")}` : "#1d4ed8");
  const [font, setFont] = useState<"sans" | "serif">(g("font") === "serif" ? "serif" : "sans");
  const [density, setDensity] = useState<"comfortable" | "compact">(
    g("density") === "compact" ? "compact" : "comfortable",
  );
  const [corners, setCorners] = useState<"rounded" | "square">(
    g("corners") === "square" ? "square" : "rounded",
  );
  const [title, setTitle] = useState(g("title") !== "0");
  // ---- saving ----
  const router = useRouter();
  const [current, setCurrent] = useState<
    { id: string; code: string; name: string; query: string; target: string } | null
  >(editing ? { id: editing.id, code: editing.code, name: editing.name, query: editing.query, target: editing.target } : null);
  const [saveName, setSaveName] = useState(editing?.name ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  // ---- snippet ----
  const [autoHeight, setAutoHeight] = useState(true);
  const [copied, setCopied] = useState(false);

  const selected = picked
    ? books.filter((b) => picked.includes(b.slug))
    : books;
  // One portfolio on its own is that portfolio's embed; two or more are a
  // publication embed narrowed (or not) to them.
  const chosen = selected.length === 1 ? selected[0] : null;
  const whole = !chosen;
  const multi = selected.length > 1;
  const subset = picked !== null && selected.length < books.length;
  const targetPublic = selected.some((b) => b.isPublic);
  // A merged table's only headline IS the total, so it cannot be switched off
  // there; it can still leave books out of it.
  const totalShown = whole && summary !== "none" && (layout === "merged" || showTotal);

  function toggleBook(bookSlug: string) {
    const current = selected.map((b) => b.slug);
    const next = current.includes(bookSlug)
      ? current.filter((x) => x !== bookSlug)
      : [...current, bookSlug];
    if (next.length === 0) return; // at least one must stay selected
    // Ticking every box is the same as "all", and "all" is the better URL:
    // it picks up portfolios added later.
    setPicked(next.length === books.length ? null : next);
  }

  const { url, query, target } = useMemo(() => {
    const p = new URLSearchParams();
    // Only non-default values go in, so the common case is a clean URL.
    if (whole) {
      if (subset) p.set("only", selected.map((b) => b.slug).join(","));
      if (layout === "grouped") p.set("layout", "grouped");
      if (layout === "grouped" && tabs && multi) {
        p.set("tabs", "1");
        if (!allTab) p.set("all", "0");
      }
      if (layout === "merged" && !bookColumn) p.set("portfolio", "0");
      if (layout === "grouped" && !showTotal) p.set("total", "0");
      if (layout === "grouped" && multi && order !== "default") p.set("order", order);
      // Only books actually in the embed; a stale slug would be meaningless.
      const excluded = notInTotal.filter((x) => selected.some((b) => b.slug === x));
      if (totalShown && excluded.length) p.set("exclude", excluded.join(","));
    }
    if (show !== "both") p.set("show", show);
    if (summary !== "benchmark") p.set("summary", summary);
    if (!returns) p.set("returns", "0");
    if (!comments) p.set("comments", "0");
    if (hiddenCols.length) p.set("hidecols", hiddenCols.join(","));
    if (!sortable) p.set("sort", "0");
    if (limit !== DEFAULT_LIMIT) p.set("limit", String(limit));
    if (theme === "dark") p.set("theme", "dark");
    if (bg === "none") p.set("bg", "none");
    if (bg === "white") p.set("bg", theme === "dark" ? "000000" : "ffffff");
    if (bg === "custom") p.set("bg", bgColor.replace("#", ""));
    if (!cards) p.set("cards", "0");
    if (accentOn) p.set("accent", accent.replace("#", ""));
    if (font === "serif") p.set("font", "serif");
    if (density === "compact") p.set("density", "compact");
    if (corners === "square") p.set("corners", "square");
    if (!title) p.set("title", "0");
    const qs = p.toString();
    const path = whole || !chosen ? `s/${slug}` : `p/${chosen.slug}`;
    return {
      url: `${origin}/embed/${path}${qs ? `?${qs}` : ""}`,
      query: qs,
      target: path,
    };
  }, [
    origin, slug, whole, chosen, multi, subset, selected, layout, tabs, allTab, bookColumn, show, summary,
    showTotal, notInTotal, totalShown, hiddenCols, order, sortable,
    returns, comments, limit, theme, bg, bgColor, cards, accentOn, accent, font,
    density, corners, title,
  ]);

  // Preview carries an extra flag the public URL must not have: it renders
  // unpublished books, but only for a signed-in manager. It is deliberately not
  // part of the snippet.
  const previewUrl = url + (url.includes("?") ? "&" : "?") + "preview=1";

  // A saved embed's link is what goes in the page, so later edits reach it.
  const savedUrl = current ? `${origin}/embed/e/${current.code}` : null;
  const dirty =
    !!current &&
    (current.query !== query || current.target !== target || current.name !== saveName.trim());

  function save(asNew: boolean) {
    setSaveError(null);
    startSave(async () => {
      const r = await saveEmbedAction({
        id: asNew ? undefined : current?.id,
        name: saveName,
        serviceId: service?.id ?? "",
        target,
        query,
      });
      if (!r.ok) {
        setSaveError(r.error);
        return;
      }
      setCurrent({ id: r.id, code: r.code, name: saveName.trim(), query, target });
      router.replace(`/embeds?saved=${r.id}`, { scroll: false });
      router.refresh();
    });
  }

  const snippet = useMemo(() => {
    const transparent = bg === "none" ? ' allowtransparency="true"' : "";
    const iframe = `<iframe data-mta-embed src="${savedUrl ?? url}" title="${whole ? "Track record" : "Portfolio"}" width="100%" height="600" style="border:0;width:100%;background:transparent;color-scheme:${theme}"${transparent} loading="lazy"></iframe>`;
    if (!autoHeight) return iframe;
    // The embed posts its height on load and whenever it reflows (including
    // when a reader switches portfolio in the dropdown). Matching on the
    // message's source window means several embeds can share one page.
    return `${iframe}
<script>
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "oxfordhub:portfolio-embed:height") return;
    document.querySelectorAll("iframe[data-mta-embed]").forEach(function (f) {
      if (f.contentWindow !== e.source) return;
      f.style.height = e.data.height + "px";
      if (e.data.scheme) f.style.colorScheme = e.data.scheme;
    });
  });
</script>`;
  }, [url, savedUrl, autoHeight, whole, bg, theme]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function reset() {
    setTheme("light");
    setBg("default");
    setCards(true);
    setAccentOn(false);
    setFont("sans");
    setDensity("comfortable");
    setCorners("rounded");
    setTitle(true);
  }

  return (
    <div className="space-y-5">
      <PublishBar
        books={selected}
        allPrivate={!targetPublic}
        onChanged={() => router.refresh()}
      />

      <Panel title="What to embed">
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-gray-500">
                Publication
              </span>
              <select
                value={serviceSlug}
                onChange={(e) => {
                  setServiceSlug(e.target.value);
                  // Portfolio slugs from another publication mean nothing here.
                  setPicked(null);
                }}
                className="min-w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              >
                {services.map((sv) => (
                  <option key={sv.slug} value={sv.slug}>
                    {sv.name}
                  </option>
                ))}
              </select>
            </label>

            {whole && (
              <Group label="Layout">
                <Choice active={layout === "grouped"} onClick={() => setLayout("grouped")}>
                  Grouped by portfolio
                </Choice>
                <Choice active={layout === "merged"} onClick={() => setLayout("merged")}>
                  One combined table
                </Choice>
              </Group>
            )}

            {whole && layout === "grouped" && multi && (
              <Group label="Portfolio order">
                <Choice active={order === "default"} onClick={() => setOrder("default")}>
                  As listed
                </Choice>
                <Choice active={order === "alpha"} onClick={() => setOrder("alpha")}>
                  A–Z
                </Choice>
                <Choice active={order === "outperformance"} onClick={() => setOrder("outperformance")}>
                  Best vs S&amp;P 500 first
                </Choice>
              </Group>
            )}

            {whole && layout === "grouped" && multi && (
              <Group label="Reader">
                <Choice active={tabs} onClick={() => setTabs(!tabs)}>
                  Portfolio tabs
                </Choice>
                {tabs && (
                  <Choice active={allTab} onClick={() => setAllTab(!allTab)}>
                    &quot;All portfolios&quot; tab
                  </Choice>
                )}
              </Group>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-gray-500">Portfolios</span>
              <button
                type="button"
                onClick={() => setPicked(null)}
                disabled={picked === null}
                className="text-xs text-blue-400 hover:underline disabled:cursor-default disabled:text-gray-600 disabled:no-underline"
              >
                {picked === null ? "All selected" : "Select all"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {books.map((b) => {
                const on = selected.some((x) => x.slug === b.slug);
                return (
                  <button
                    key={b.slug}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleBook(b.slug)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      on
                        ? "bg-blue-600 text-white"
                        : "border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[10px] leading-none ${
                        on ? "border-white bg-white text-blue-600" : "border-gray-500"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    {b.name}
                    <span className="opacity-60">{b.positions}</span>
                    {!b.isPublic && <span className="text-yellow-400/80">private</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-2 text-xs text-gray-600">
            {!whole
              ? "Just this portfolio, with its own return against the S&P 500 since it started."
              : layout === "grouped"
                ? `The publication's overall return up top, then each portfolio as its own section with its own return vs the S&P 500 since that portfolio began.${tabs && multi ? (allTab ? " Readers switch between portfolios with tabs across the top, starting on All portfolios." : " Readers switch between portfolios with tabs across the top, starting on the first portfolio; there is no All view.") : ""}${subset ? " Only the portfolios ticked above." : " Portfolios added later appear automatically."}`
                : `The selected portfolios merged into one open table and one closed table.${subset ? "" : " Portfolios added later appear automatically."}`}
            {whole && books.some((b) => !b.isPublic) && (
              <>
                {" "}
                {books.filter((b) => !b.isPublic).length} private portfolio
                {books.filter((b) => !b.isPublic).length === 1 ? " is" : "s are"} left out
                until published.
              </>
            )}
          </p>
        </Panel>

      {whole && summary !== "none" && (
        <Panel title="Publication total">
          <div className="flex flex-wrap gap-4">
            {layout === "grouped" && (
              <Group label="Total return">
                <Choice active={showTotal} onClick={() => setShowTotal(true)}>
                  Show
                </Choice>
                <Choice active={!showTotal} onClick={() => setShowTotal(false)}>
                  Hide — portfolio returns only
                </Choice>
              </Group>
            )}
            {totalShown && (
              <Group label="Count in the total">
                {selected.map((b) => {
                  const counted = !notInTotal.includes(b.slug);
                  return (
                    <Choice
                      key={b.slug}
                      active={counted}
                      onClick={() =>
                        setNotInTotal((prev) =>
                          counted ? [...prev, b.slug] : prev.filter((x) => x !== b.slug),
                        )
                      }
                    >
                      {counted ? "✓ " : ""}
                      {b.name}
                    </Choice>
                  );
                })}
              </Group>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-600">
            {!totalShown
              ? "No publication-wide figure — each portfolio shows its own return vs the S&P 500."
              : selected.every((b) => notInTotal.includes(b.slug))
                ? "Every portfolio is left out, so no total will show."
                : notInTotal.some((x) => selected.some((b) => b.slug === x))
                  ? "Unticked portfolios still appear in the embed with their own return, but are left out of the total — and the total's label says so."
                  : "Untick a portfolio to keep it in the embed but leave it out of the total. Portfolios not in the embed are never counted."}
          </p>
        </Panel>
      )}

      <Panel title="Content">
        <div className="flex flex-wrap gap-4">
          <Group label="Show">
            {(["both", "open", "closed"] as Show[]).map((v) => (
              <Choice key={v} active={show === v} onClick={() => setShow(v)}>
                {v === "both" ? "Open + closed" : v === "open" ? "Open only" : "Closed only"}
              </Choice>
            ))}
          </Group>

          <Group label="Header return">
            {(["benchmark", "portfolio", "none"] as Summary[]).map((v) => (
              <Choice key={v} active={summary === v} onClick={() => setSummary(v)}>
                {SUMMARY_LABELS[v]}
              </Choice>
            ))}
          </Group>

          <Group label="Columns">
            <Choice active={returns} onClick={() => setReturns(!returns)}>
              % returns
            </Choice>
            <Choice active={comments} onClick={() => setComments(!comments)}>
              Comments
            </Choice>
            {whole && layout === "merged" && (
              <Choice active={bookColumn} onClick={() => setBookColumn(!bookColumn)}>
                Portfolio name
              </Choice>
            )}
            {OPTIONAL_COLUMNS.filter(
              (c) =>
                (show !== "closed" || c.closed) && (show !== "open" || c.open),
            ).map((c) => {
              const on = !hiddenCols.includes(c.key);
              return (
                <Choice
                  key={c.key}
                  active={on}
                  onClick={() =>
                    setHiddenCols((prev) =>
                      on ? [...prev, c.key] : prev.filter((x) => x !== c.key),
                    )
                  }
                >
                  {c.label}
                </Choice>
              );
            })}
          </Group>

          <Group label="Readers can">
            <Choice active={sortable} onClick={() => setSortable(!sortable)}>
              Sort by clicking a column
            </Choice>
          </Group>

          <Group label={whole && layout === "grouped" ? "Closed rows per portfolio" : "Closed rows"}>
            {[50, DEFAULT_LIMIT, 0].map((n) => (
              <Choice key={n} active={limit === n} onClick={() => setLimit(n)}>
                {n === 0 ? "All" : `Latest ${n}`}
              </Choice>
            ))}
          </Group>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Returns are equal-weighted: every position counts as 1. A partly sold
          position is split by size — sell half and each half counts 0.5 — so it
          still counts once in total. The Weight column shows each row&apos;s share,
          and the embed states the method under the header. The header always
          covers the whole record, whatever the row limit.
        </p>
      </Panel>

      <Panel
        title="Look & feel"
        action={
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-300">
            Reset
          </button>
        }
      >
        <div className="flex flex-wrap gap-4">
          <Group label="Theme">
            <Choice active={theme === "light"} onClick={() => setTheme("light")}>Light</Choice>
            <Choice active={theme === "dark"} onClick={() => setTheme("dark")}>Dark</Choice>
          </Group>

          <Group label="Background">
            <Choice active={bg === "default"} onClick={() => setBg("default")}>
              {theme === "dark" ? "Charcoal" : "Soft gray"}
            </Choice>
            <Choice active={bg === "white"} onClick={() => setBg("white")}>
              {theme === "dark" ? "Black" : "White"}
            </Choice>
            <Choice active={bg === "none"} onClick={() => setBg("none")}>None (transparent)</Choice>
            <Choice active={bg === "custom"} onClick={() => setBg("custom")}>Custom</Choice>
            {bg === "custom" && (
              <ColorInput value={bgColor} onChange={setBgColor} label="Background colour" />
            )}
          </Group>

          <Group label="Tables">
            <Choice active={cards} onClick={() => setCards(true)}>Cards</Choice>
            <Choice active={!cards} onClick={() => setCards(false)}>Flat</Choice>
          </Group>

          <Group label="Accent">
            <Choice active={!accentOn} onClick={() => setAccentOn(false)}>Default</Choice>
            <Choice active={accentOn} onClick={() => setAccentOn(true)}>Brand colour</Choice>
            {accentOn && <ColorInput value={accent} onChange={setAccent} label="Accent colour" />}
          </Group>

          <Group label="Font">
            <Choice active={font === "sans"} onClick={() => setFont("sans")}>Sans</Choice>
            <Choice active={font === "serif"} onClick={() => setFont("serif")}>Serif</Choice>
          </Group>

          <Group label="Density">
            <Choice active={density === "comfortable"} onClick={() => setDensity("comfortable")}>
              Comfortable
            </Choice>
            <Choice active={density === "compact"} onClick={() => setDensity("compact")}>
              Compact
            </Choice>
          </Group>

          <Group label="Corners">
            <Choice active={corners === "rounded"} onClick={() => setCorners("rounded")}>Rounded</Choice>
            <Choice active={corners === "square"} onClick={() => setCorners("square")}>Square</Choice>
          </Group>

          <Group label="Header">
            <Choice active={title} onClick={() => setTitle(!title)}>Show title</Choice>
          </Group>
        </div>
      </Panel>

      <LivePreview src={previewUrl} />

      <Panel title={current ? `Saved embed: ${current.name}` : "Save this embed"}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name"
            aria-label="Saved embed name"
            className="min-w-64 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
          />
          {current ? (
            <>
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving || !dirty || !saveName.trim()}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
              <button
                type="button"
                onClick={() => save(true)}
                disabled={saving || !saveName.trim()}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40"
              >
                Save as new
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving || !saveName.trim()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save embed"}
            </button>
          )}
        </div>
        {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}
        <p className="mt-2 text-xs text-gray-600">
          {current
            ? dirty
              ? "Unsaved changes — pages using this embed still show the last saved version until you save."
              : "Pages using the code below update whenever you save changes here — no need to re-paste."
            : "Saving gives this embed a permanent link. Paste it once; adjust it here any time and every page using it updates."}
        </p>
      </Panel>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Paste this into the page
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={autoHeight}
                onChange={(e) => setAutoHeight(e.target.checked)}
              />
              Auto height
            </label>
            <button
              type="button"
              onClick={copy}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">
          <code>{snippet}</code>
        </pre>
      </div>

      <p className="text-xs text-gray-600">
        <a href={previewUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
          Open preview
        </a>{" "}
        — shows unpublished portfolios to you only.{" "}
        {limit === 0 && (
          <span className="text-yellow-500">
            &quot;All&quot; renders every closed position; a long record makes a very
            large page.{" "}
          </span>
        )}
        Live URL: <span className="break-all text-gray-500">{url}</span>
      </p>

      {savedList.length > 0 && (
        <SavedList rows={savedList} origin={origin} currentId={current?.id ?? null} />
      )}
    </div>
  );
}

/**
 * Which of the selected portfolios are private, with a Publish button each.
 *
 * Every portfolio starts private, and a private one is left out of the live
 * embed (or 404s on its own), which is why the preview carries a "not
 * published" banner. Publishing is the same switch as "Embed: Public" in
 * Portfolio settings, offered here where the question actually comes up.
 */
function PublishBar({
  books,
  allPrivate,
  onChanged,
}: {
  books: EmbedBook[];
  allPrivate: boolean;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const privateBooks = books.filter((b) => !b.isPublic && !done.includes(b.slug));
  if (privateBooks.length === 0) return null;

  function publish(slugs: string[]) {
    setError(null);
    start(async () => {
      for (const slug of slugs) {
        const r = await setPortfolioVisibilityAction(slug, true);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setDone((d) => [...d, slug]);
      }
      onChanged();
    });
  }

  return (
    <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3 text-xs text-yellow-200">
      <p className="mb-2">
        {allPrivate
          ? "Nothing selected is published yet, so the live link shows Not Found. The preview below works now."
          : `${privateBooks.length} selected portfolio${privateBooks.length === 1 ? " is" : "s are"} private and left out of the live embed.`}{" "}
        Publish to make {privateBooks.length === 1 ? "it" : "them"} visible to readers:
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {privateBooks.map((b) => (
          <button
            key={b.slug}
            type="button"
            disabled={pending}
            onClick={() => publish([b.slug])}
            className="rounded-full border border-yellow-700/60 bg-yellow-900/40 px-3 py-1 font-medium hover:bg-yellow-800/50 disabled:opacity-50"
          >
            Publish {b.name}
          </button>
        ))}
        {privateBooks.length > 1 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => publish(privateBooks.map((b) => b.slug))}
            className="rounded-full bg-yellow-600 px-3 py-1 font-semibold text-gray-950 hover:bg-yellow-500 disabled:opacity-50"
          >
            Publish all {privateBooks.length}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-red-300">{error}</p>}
    </div>
  );
}

/** Every saved embed this person can manage, with edit and delete. */
function SavedList({
  rows,
  origin,
  currentId,
}: {
  rows: SavedEmbedRow[];
  origin: string;
  currentId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(row: SavedEmbedRow) {
    if (!window.confirm(`Delete "${row.name}"? Pages using its link will show Not Found.`)) return;
    start(async () => {
      const r = await deleteSavedEmbedAction(row.id);
      if (!r.ok) setError(r.error);
      else {
        if (row.id === currentId) router.replace("/embeds");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-200">Saved embeds</h3>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Link</th>
              <th className="p-2">Last changed</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-gray-800 ${r.id === currentId ? "bg-blue-950/30" : ""}`}>
                <td className="p-2 font-medium text-gray-200">{r.name}</td>
                <td className="p-2 font-mono text-gray-500">{`${origin}/embed/e/${r.code}`}</td>
                <td className="p-2 text-gray-500">
                  {new Date(r.updatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
                  {r.updatedBy ? ` · ${r.updatedBy}` : ""}
                </td>
                <td className="whitespace-nowrap p-2 text-right">
                  <a href={`/embeds?saved=${r.id}`} className="text-blue-400 hover:underline">
                    Edit
                  </a>
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    disabled={pending}
                    className="ml-3 text-red-400 hover:underline disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The embed itself, framed on a mock host page so a transparent background can
 * actually be judged. Reloads are debounced: dragging a colour picker would
 * otherwise re-render the whole record dozens of times a second.
 */
function LivePreview({ src }: { src: string }) {
  const [shown, setShown] = useState(src);
  const [host, setHost] = useState<"light" | "dark">("light");
  const [height, setHeight] = useState(600);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setShown(src), 350);
    return () => clearTimeout(t);
  }, [src]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type !== "oxfordhub:portfolio-embed:height") return;
      if (e.source !== frame.current?.contentWindow) return;
      setHeight(Math.max(200, Number(e.data.height) || 600));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-gray-500">Live preview</span>
        <div className="flex gap-1.5">
          <span className="self-center text-xs text-gray-600">Host page</span>
          <Choice active={host === "light"} onClick={() => setHost("light")}>Light</Choice>
          <Choice active={host === "dark"} onClick={() => setHost("dark")}>Dark</Choice>
        </div>
      </div>
      <div
        className={`max-h-[760px] overflow-auto rounded-lg border border-gray-800 p-4 ${
          host === "light" ? "bg-white" : "bg-gray-950"
        }`}
      >
        <iframe
          ref={frame}
          key={shown}
          src={shown}
          title="Embed preview"
          className="w-full border-0 bg-transparent"
          // Same matching rule as the pasted snippet, or the preview would show
          // the opaque backdrop the fix exists to prevent.
          style={{ height, colorScheme: /[?&]theme=dark/.test(shown) ? "dark" : "light" }}
        />
      </div>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function ColorInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 bg-gray-800 py-1 pl-1 pr-2.5">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
      />
      <span className="font-mono text-xs text-gray-400">{value}</span>
    </span>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
