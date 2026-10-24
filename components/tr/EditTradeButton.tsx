"use client";

import { useState, useTransition } from "react";
import { editTrade } from "@/app/(tr)/actions";
import { signedPct, tone } from "@/lib/tr/format";

export interface EditableTrade {
  id: string;
  name: string;
  openDate: string;
  closeDate: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  returnPct: number | null;
  /** Credit trades (put sells, strangles) measure return on the credit kept. */
  credit: boolean;
  /** The sheet computes the return itself (PMK's =H/F-1) — not editable. */
  returnFromSheet: boolean;
  sheetTab: string;
  sheetRow: number;
}

/**
 * Edit a trade's dates, prices and return. Saves into the trade's row in the
 * service's spreadsheet — the record — and re-reads it.
 */
export function EditTradeButton({ trade }: { trade: EditableTrade }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    openDate: trade.openDate,
    closeDate: trade.closeDate ?? "",
    entryPrice: trade.entryPrice?.toString() ?? "",
    exitPrice: trade.exitPrice?.toString() ?? "",
    returnPct: trade.returnPct !== null ? String(Number((trade.returnPct * 100).toPrecision(12))) : "",
  });
  // Off by default: several sheets measure return on a basis other than
  // exit/entry (cost basis, capital at risk), so recalculating silently would
  // change a published figure.
  const [autoReturn, setAutoReturn] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const entry = Number(f.entryPrice);
  const exit = Number(f.exitPrice);
  const computed =
    entry && Number.isFinite(exit) && f.exitPrice !== ""
      ? trade.credit
        ? (Math.abs(entry) - Math.abs(exit)) / Math.abs(entry)
        : exit / entry - 1
      : null;
  const shownReturn = trade.returnFromSheet || autoReturn ? computed : Number(f.returnPct) / 100;

  const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";
  const label = "mb-1 block text-xs font-medium text-muted";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-xs text-muted hover:bg-brand-soft hover:text-brand"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !pending && setOpen(false)}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          start(async () => {
            const r = await editTrade({
              id: trade.id,
              ...f,
              returnPct: shownReturn !== null && Number.isFinite(shownReturn) ? (shownReturn * 100).toString() : f.returnPct,
            });
            setMsg({ ok: r.ok, text: r.ok ? r.message : r.error });
            if (r.ok) setTimeout(() => setOpen(false), 900);
          });
        }}
        className="w-full max-w-lg space-y-4 rounded-2xl bg-card p-6 text-left shadow-xl"
      >
        <div>
          <h3 className="text-lg font-semibold text-ink">Edit trade</h3>
          <p className="text-sm text-muted">{trade.name}</p>
          <p className="text-xs text-faint">
            Saves to the spreadsheet: “{trade.sheetTab}”, row {trade.sheetRow}.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor={`e-od-${trade.id}`}>Date opened</label>
            <input id={`e-od-${trade.id}`} type="date" value={f.openDate} onChange={(e) => setF({ ...f, openDate: e.target.value })} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor={`e-cd-${trade.id}`}>Date closed</label>
            <input id={`e-cd-${trade.id}`} type="date" value={f.closeDate} onChange={(e) => setF({ ...f, closeDate: e.target.value })} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor={`e-ep-${trade.id}`}>Entry price ($)</label>
            <input id={`e-ep-${trade.id}`} inputMode="decimal" value={f.entryPrice} onChange={(e) => setF({ ...f, entryPrice: e.target.value })} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor={`e-xp-${trade.id}`}>Exit price ($)</label>
            <input id={`e-xp-${trade.id}`} inputMode="decimal" value={f.exitPrice} onChange={(e) => setF({ ...f, exitPrice: e.target.value })} className={field} required />
          </div>
        </div>
        <div className="rounded-xl bg-paper p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">Return</span>
            <span className={`num text-xl font-semibold ${tone(shownReturn)}`}>{signedPct(shownReturn)}</span>
          </div>
          {trade.returnFromSheet ? (
            <p className="mt-1 text-xs text-faint">The sheet calculates this from the prices.</p>
          ) : (
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={autoReturn} onChange={(e) => setAutoReturn(e.target.checked)} />
                Calculate from the prices
              </label>
              {!autoReturn && (
                <div>
                  <label className={label} htmlFor={`e-r-${trade.id}`}>Return (%)</label>
                  <input id={`e-r-${trade.id}`} inputMode="decimal" value={f.returnPct} onChange={(e) => setF({ ...f, returnPct: e.target.value })} className={field} required />
                </div>
              )}
            </div>
          )}
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-gain" : "text-loss"}`}>{msg.text}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Saving to the sheet…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
