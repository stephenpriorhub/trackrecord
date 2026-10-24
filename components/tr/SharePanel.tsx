"use client";

import { useState, useTransition } from "react";
import { rotatePublicToken, setPublicBenchmark, setPublicEnabled } from "@/app/(tr)/actions";

/** Admin-only: the service's public, read-only link and what it shows. */
export function SharePanel({
  code,
  origin,
  token,
  enabled,
  showBenchmark,
}: {
  code: string;
  origin: string;
  token: string | null;
  enabled: boolean;
  showBenchmark: boolean;
}) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = token ? `${origin}/t/${token}` : null;

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none select-none rounded-lg border border-line bg-paper px-4 py-2 text-sm font-medium text-brand hover:border-brand">
        Share {enabled ? "· public link on" : ""}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-80 space-y-3 rounded-xl border border-line bg-card p-4 text-sm shadow-lg">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => run(() => setPublicEnabled(code, e.target.checked))}
          />
          Public read-only page
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showBenchmark}
            disabled={pending}
            onChange={(e) => run(() => setPublicBenchmark(code, e.target.checked))}
          />
          Show S&amp;P 500 comparison
        </label>
        {enabled && url && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input readOnly value={url} className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-xs" />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex items-center justify-between text-xs">
              <a href={url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                Open public page ↗
              </a>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm("Make a new link? The current link will stop working.")) run(() => rotatePublicToken(code));
                }}
                className="text-muted hover:text-loss"
              >
                Replace link
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-faint">
          Readers see the summary and every trade. They can&apos;t edit anything, and widgets, Airtable links and data
          checks stay hidden.
        </p>
        {error && <p className="text-xs text-loss">{error}</p>}
      </div>
    </details>
  );
}
