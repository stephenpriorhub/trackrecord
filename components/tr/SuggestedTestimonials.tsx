"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { fmtDate, pct, signedPct, tone } from "@/lib/tr/format";

/**
 * Member testimonials from the MTA Wiki that line up with a trade: same
 * service, same ticker, posted while it was open or within a few days of the
 * close. One request per page of trades (the provider), one button per row.
 */

export interface MatchTrade {
  id: string;
  name: string;
  pubCode: string;
  ticker: string;
  openDate: string;
  closeDate: string | null;
  returnPct: number | null;
  guru: string | null;
}

interface Testimonial {
  id: string;
  username: string | null;
  guru: string | null;
  postedAt: string;
  text: string;
  returnPct: number | null;
  profitUsd: number | null;
  timeFrame: string | null;
  isBigWin: boolean;
  isTopPick: boolean;
  imageUrl: string | null;
}

interface MatchState {
  loading: boolean;
  error: string | null;
  matches: Record<string, Testimonial[]>;
  gridUrls: Record<string, string>;
  trades: Record<string, MatchTrade>;
}

const Ctx = createContext<MatchState | null>(null);

export function TestimonialMatchProvider({ trades, children }: { trades: MatchTrade[]; children: React.ReactNode }) {
  const [state, setState] = useState<MatchState>({
    loading: true,
    error: null,
    matches: {},
    gridUrls: {},
    trades: Object.fromEntries(trades.map((t) => [t.id, t])),
  });
  const key = trades.map((t) => t.id).join(",");

  useEffect(() => {
    if (!trades.length) return;
    let live = true;
    fetch("/api/testimonials/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trades }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setState((s) => ({ ...s, loading: false, error: d.error ?? null, matches: d.matches ?? {}, gridUrls: d.gridUrls ?? {} }));
      })
      .catch((e) => live && setState((s) => ({ ...s, loading: false, error: String(e) })));
    return () => {
      live = false;
    };
    // The trade list is identified by its ids; re-fetch only when the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

function money(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function SuggestedTestimonialsButton({ tradeId }: { tradeId: string }) {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (zoom ? setZoom(null) : setOpen(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, zoom]);

  if (!ctx) return null;
  if (ctx.loading) return <span className="text-xs text-faint">…</span>;
  const items = ctx.matches[tradeId] ?? [];
  if (!items.length) return <span className="text-xs text-faint" title={ctx.error ?? "No matching testimonials in the wiki"}>—</span>;
  const trade = ctx.trades[tradeId];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-md border border-line px-2 py-1 text-xs font-medium text-brand hover:border-brand hover:bg-brand-soft"
      >
        {items.length} suggested
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Suggested testimonials"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-card text-left shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <h3 className="text-lg font-semibold text-ink">Suggested testimonials</h3>
                <p className="text-sm text-muted">
                  {trade.name} · {fmtDate(trade.openDate)} → {trade.closeDate ? fmtDate(trade.closeDate) : "open"} ·{" "}
                  <span className={`font-semibold ${tone(trade.returnPct)}`}>{signedPct(trade.returnPct)}</span>
                </p>
                <p className="mt-1 text-xs text-faint">
                  Same service and ticker, posted while the trade was open or within 3 days of the close. Check the
                  member is talking about this trade before using one.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 py-1 text-muted hover:text-ink">
                ✕
              </button>
            </div>
            <ul className="divide-y divide-line overflow-y-auto">
              {items.map((t) => (
                <li key={t.id} className="flex gap-4 p-5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-xs text-muted">
                      <span className="font-medium text-ink">{t.username ?? "Member"}</span> · {fmtDate(t.postedAt)}
                      {t.guru && <> · {t.guru}</>}
                    </p>
                    <p className="whitespace-pre-line text-sm text-ink">{t.text}</p>
                    <p className="flex flex-wrap gap-1.5 text-[11px]">
                      {t.returnPct !== null && (
                        <span className="rounded bg-gain-soft px-1.5 py-0.5 font-semibold text-gain">{pct(t.returnPct, 0)} stated</span>
                      )}
                      {t.profitUsd !== null && (
                        <span className="rounded bg-gain-soft px-1.5 py-0.5 font-semibold text-gain">{money(t.profitUsd)}</span>
                      )}
                      {t.timeFrame && <span className="rounded bg-paper px-1.5 py-0.5 text-muted">{t.timeFrame}</span>}
                      {t.isTopPick && <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">Top / Allstar</span>}
                    </p>
                  </div>
                  {t.imageUrl && (
                    <button type="button" onClick={() => setZoom(t.imageUrl)} className="shrink-0 self-start" title="Enlarge screenshot">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.imageUrl} alt="" loading="lazy" className="h-16 w-48 rounded border border-line bg-white object-contain hover:border-brand" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {ctx.gridUrls[tradeId] && (
              <div className="border-t border-line p-4 text-right">
                <a href={ctx.gridUrls[tradeId]} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand hover:underline">
                  Open in the wiki&apos;s testimonials ↗
                </a>
              </div>
            )}
          </div>
          {zoom && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 p-6" onClick={(e) => { e.stopPropagation(); setZoom(null); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={zoom} alt="Testimonial screenshot" className="max-h-full max-w-full rounded-lg bg-white shadow-2xl" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
