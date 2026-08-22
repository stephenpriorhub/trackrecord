"use client";

/**
 * Build the iframe snippet for a portfolio.
 *
 * The options are buttons rather than a URL people hand-edit, because getting a
 * query string subtly wrong is silent — the embed just renders the default and
 * nobody notices the column they wanted hidden is still there. Toggling rewrites
 * the code in place so what you see is exactly what you paste.
 */
import { useMemo, useState } from "react";

type Show = "both" | "open" | "closed";

export default function EmbedBuilder({
  slug,
  origin,
  isPublic,
}: {
  slug: string;
  origin: string;
  isPublic: boolean;
}) {
  const [show, setShow] = useState<Show>("both");
  const [returns, setReturns] = useState(true);
  const [comments, setComments] = useState(true);
  const [autoHeight, setAutoHeight] = useState(true);
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    // Only non-default values go in, so the common case is a clean URL.
    if (show !== "both") p.set("show", show);
    if (!returns) p.set("returns", "0");
    if (!comments) p.set("comments", "0");
    const qs = p.toString();
    return `${origin}/embed/p/${slug}${qs ? `?${qs}` : ""}`;
  }, [origin, slug, show, returns, comments]);

  const snippet = useMemo(() => {
    const iframe = `<iframe src="${url}" title="Portfolio" width="100%" height="600" style="border:0;width:100%" loading="lazy"></iframe>`;
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
  }, [url, autoHeight]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isPublic && (
        <p className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3 text-xs text-yellow-300">
          This portfolio is private, so the link below returns Not Found. Set Embed to
          Public in Portfolio settings to make it live.
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        <Group label="Show">
          {(["both", "open", "closed"] as Show[]).map((v) => (
            <Choice key={v} active={show === v} onClick={() => setShow(v)}>
              {v === "both" ? "Open + closed" : v === "open" ? "Open only" : "Closed only"}
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
        </Group>

        <Group label="Sizing">
          <Choice active={autoHeight} onClick={() => setAutoHeight(!autoHeight)}>
            Auto height
          </Choice>
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
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">
          <code>{snippet}</code>
        </pre>
      </div>

      <p className="text-xs text-gray-600">
        Preview:{" "}
        <a href={url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
          {url}
        </a>
      </p>
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
