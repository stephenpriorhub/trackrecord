"use client";

import Link from "next/link";
import { useState } from "react";
import { StatsTable } from "./StatsTable";
import { pct, tone } from "@/lib/tr/format";
import type { PeriodKey, PeriodStats } from "@/lib/tr/stats";

export interface CardView {
  key: string;
  label: string;
  stats: Record<PeriodKey, PeriodStats>;
}

/**
 * One service on the home page: its summary table (with a Combined / per-editor
 * switch where the service publishes editors separately), this week's best
 * trade, and the way into the full record.
 */
export function ServiceCard({
  name,
  href,
  logoUrl,
  gurus,
  views,
  weighted,
  note,
}: {
  name: string;
  href: string;
  logoUrl: string | null;
  gurus: string[];
  views: CardView[];
  weighted: boolean;
  note?: string;
}) {
  const [active, setActive] = useState(views[0].key);
  const view = views.find((v) => v.key === active) ?? views[0];
  const best = view.stats.week.best;

  return (
    <section className="rounded-2xl border border-line bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={name} className="h-14 w-auto max-w-[260px] object-contain" />
          ) : (
            <h2 className="text-lg font-semibold leading-tight text-ink">{name}</h2>
          )}
          <p className="mt-1 text-sm text-muted">{gurus.join(" & ")}</p>
        </div>
        {views.length > 1 && (
          <div className="flex rounded-lg border border-line bg-paper p-0.5 text-xs" role="tablist">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={v.key === active}
                onClick={() => setActive(v.key)}
                className={`rounded-md px-2.5 py-1 ${v.key === active ? "bg-card font-medium text-brand shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="px-5 py-3">
        <StatsTable stats={view.stats} weighted={weighted} compact />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-sm text-muted">
          {best ? (
            <>
              This week&apos;s best trade:{" "}
              <span className="font-medium text-ink">{best.name}</span>{" "}
              <span className={`font-semibold ${tone(best.returnPct)}`}>{pct(best.returnPct)}</span>
              {best.days !== null && <span className="text-faint"> · {best.days} days</span>}
            </>
          ) : (
            "No trades closed yet this week."
          )}
          {note && <span className="mt-1 block text-xs text-faint">{note}</span>}
        </p>
        <Link
          href={href}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          View full track record →
        </Link>
      </footer>
    </section>
  );
}
