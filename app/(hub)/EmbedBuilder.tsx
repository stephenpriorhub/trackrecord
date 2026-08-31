"use client";

/**
 * Build the iframe snippet for a portfolio, or for a whole publication.
 *
 * The options are buttons rather than a URL people hand-edit, because getting a
 * query string subtly wrong is silent — the embed just renders the default and
 * nobody notices the column they wanted hidden is still there. Toggling rewrites
 * the code in place so what you see is exactly what you paste.
 */
import { useMemo, useState } from "react";

type Show = "both" | "open" | "closed";
type Summary = "benchmark" | "portfolio" | "none";

const SUMMARY_LABELS: Record<Summary, string> = {
  benchmark: "Portfolio vs S&P 500",
  portfolio: "Portfolio only",
  none: "None",
};

export interface EmbedBook {
  slug: string;
  name: string;
  isPublic: boolean;
  positions: number;
}

export default function EmbedBuilder({
  mode,
  slug,
  origin,
  isPublic,
  books = [],
}: {
  mode: "portfolio" | "service";
  slug: string;
  origin: string;
  /** Portfolio mode: is this book published? Service mode: is ANY book published? */
  isPublic: boolean;
  /** Service mode only: the books that can be included. */
  books?: EmbedBook[];
}) {
  const [show, setShow] = useState<Show>("both");
  const [returns, setReturns] = useState(true);
  const [summary, setSummary] = useState<Summary>("benchmark");
  const [comments, setComments] = useState(true);
  const [bookColumn, setBookColumn] = useState(true);
  const [autoHeight, setAutoHeight] = useState(true);
  // Matches DEFAULT_CLOSED_LIMIT in lib/managed/embed.ts. 0 means every row.
  const [limit, setLimit] = useState(200);
  const [copied, setCopied] = useState(false);

  // The embed shows every published book by default and the URL names only what
  // to LEAVE OUT. That way a portfolio added next month appears automatically in
  // pages that already embed this publication — an include-list would freeze
  // today's line-up into every live iframe.
  const publishable = books.filter((b) => b.isPublic);
  const [hidden, setHidden] = useState<string[]>([]);

  function toggleHidden(s: string) {
    setHidden((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  const url = useMemo(() => {
    const p = new URLSearchParams();
    // Only non-default values go in, so the common case is a clean URL.
    if (show !== "both") p.set("show", show);
    if (!returns) p.set("returns", "0");
    // Always explicit once it differs from the default, so the URL cannot be
    // read two ways depending on what else is set.
    if (summary !== "benchmark") p.set("summary", summary);
    if (!comments) p.set("comments", "0");
    if (limit !== 200) p.set("limit", String(limit));
    if (mode === "service") {
      if (!bookColumn) p.set("portfolio", "0");
      if (hidden.length) p.set("hide", hidden.join(","));
    }
    const qs = p.toString();
    const path = mode === "service" ? "s" : "p";
    return `${origin}/embed/${path}/${slug}${qs ? `?${qs}` : ""}`;
  }, [
    origin,
    slug,
    mode,
    show,
    returns,
    summary,
    comments,
    limit,
    bookColumn,
    hidden,
  ]);

  // Preview carries an extra flag the public URL must not have: it renders
  // unpublished books, but only for a signed-in manager. It is deliberately not
  // part of the snippet.
  const previewUrl = url + (url.includes("?") ? "&" : "?") + "preview=1";

  const snippet = useMemo(() => {
    const iframe = `<iframe src="${url}" title="${mode === "service" ? "Track record" : "Portfolio"}" width="100%" height="600" style="border:0;width:100%" loading="lazy"></iframe>`;
    if (!autoHeight) return iframe;
    // The embed posts its height on load and whenever it reflows, so the host
    // page can size the frame instead of showing an inner scrollbar.
    return `${iframe.replace("<iframe ", '<iframe id="mta-portfolio" ')}
<script>
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "oxfordhub:portfolio-embed:height") return;
    var f = document.getElementById("mta-portfolio");
    if (f) f.style.height = e.data.height + "px";
  });
</script>`;
  }, [url, autoHeight, mode]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const nothingSelected =
    mode === "service" && publishable.length > 0 && hidden.length === publishable.length;

  return (
    <div className="space-y-4">
      {!isPublic && (
        <p className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3 text-xs text-yellow-300">
          {mode === "service"
            ? "No portfolio in this publication is public yet, so the link below returns Not Found. Set at least one to Public in its settings. Preview works now."
            : "This portfolio is private, so the link below returns Not Found. Set Embed to Public in Portfolio settings to make it live. Preview works now."}
        </p>
      )}

      {mode === "service" && (
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wide text-gray-500">
            Hide from this embed
          </div>
          {publishable.length === 0 ? (
            <p className="text-xs text-gray-500">
              Nothing published yet — every portfolio here is private.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {publishable.map((b) => (
                  <Choice
                    key={b.slug}
                    active={hidden.includes(b.slug)}
                    danger
                    onClick={() => toggleHidden(b.slug)}
                  >
                    {b.name} <span className="opacity-60">{b.positions}</span>
                  </Choice>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-600">
                {hidden.length === 0
                  ? "All portfolios shown. Portfolios added later appear here automatically."
                  : `${hidden.length} hidden on this page only — the portfolio itself is unchanged.`}
              </p>
            </>
          )}
          {books.some((b) => !b.isPublic) && (
            <p className="mt-1.5 text-xs text-gray-600">
              {books.filter((b) => !b.isPublic).length} private portfolio
              {books.filter((b) => !b.isPublic).length === 1 ? "" : "s"} cannot
              be included until published.
            </p>
          )}
        </div>
      )}

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
          {mode === "service" && (
            <Choice active={bookColumn} onClick={() => setBookColumn(!bookColumn)}>
              Portfolio name
            </Choice>
          )}
        </Group>

        <Group label="Sizing">
          <Choice active={autoHeight} onClick={() => setAutoHeight(!autoHeight)}>
            Auto height
          </Choice>
        </Group>

        <Group label="Closed rows">
          {[50, 200, 0].map((n) => (
            <Choice key={n} active={limit === n} onClick={() => setLimit(n)}>
              {n === 0 ? "All" : `Latest ${n}`}
            </Choice>
          ))}
        </Group>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Paste this into the page
          </span>
          <button
            type="button"
            onClick={copy}
            disabled={nothingSelected}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        {nothingSelected ? (
          <p className="rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-500">
            Every portfolio is hidden — leave at least one showing.
          </p>
        ) : (
          <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">
            <code>{snippet}</code>
          </pre>
        )}
      </div>

      {!nothingSelected && (
        <p className="text-xs text-gray-600">
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline"
          >
            Preview
          </a>{" "}
          — shows unpublished portfolios to you only.{" "}
          {limit === 0 && (
            <span className="text-yellow-500">
              &quot;All&quot; renders every closed position; a long record makes
              a very large page.{" "}
            </span>
          )}
          Live URL:{" "}
          <span className="break-all text-gray-500">{url}</span>
        </p>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
  danger = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Active means "excluded" rather than "chosen", so it reads as a removal. */
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? danger
            ? "bg-red-900/70 text-red-200 line-through"
            : "bg-blue-600 text-white"
          : "border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
