"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { renderEmail, type ReportContent } from "@/lib/tr/weekly-render";
import { refreshNumbers, saveReport, sendTestToMe, sendToList } from "../actions";

const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";
const label = "mb-1 block text-xs font-medium text-muted";
const btn = "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60";

export function ReportEditor({
  id,
  initial,
  generatedAt,
  status,
  lastError,
  sent,
  recipients,
  me,
}: {
  id: string;
  initial: ReportContent;
  generatedAt: string;
  status: string;
  lastError: string | null;
  sent: { at: string; by: string; count: number } | null;
  recipients: { to: number; cc: number };
  me: string;
}) {
  const router = useRouter();
  const [c, setC] = useState<ReportContent>(initial);
  const [genAt, setGenAt] = useState(generatedAt);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(lastError ? `Last send failed: ${lastError}` : null);
  const [pending, start] = useTransition();
  const locked = status !== "DRAFT";
  const html = useMemo(() => renderEmail(c, new Date(genAt)), [c, genAt]);

  const edit = (next: ReportContent) => {
    setC(next);
    setDirty(true);
  };
  const setSection = (i: number, patch: Partial<ReportContent["sections"][number]>) =>
    edit({ ...c, sections: c.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setCell = (si: number, ti: number, ri: number, ci: number, v: string) =>
    edit({
      ...c,
      sections: c.sections.map((s, j) =>
        j !== si
          ? s
          : {
              ...s,
              tables: s.tables.map((t, k) =>
                k !== ti ? t : { ...t, rows: t.rows.map((r, m) => (m !== ri ? r : r.map((x, n) => (n === ci ? v : x)))) },
              ),
            },
      ),
    });

  const run = (fn: () => Promise<string | void>) =>
    start(async () => {
      setMsg(null);
      try {
        const m = await fn();
        if (m) setMsg(m);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Something went wrong.");
      }
    });

  const save = () =>
    run(async () => {
      await saveReport(id, c);
      setDirty(false);
      return "Saved.";
    });

  const total = recipients.to + recipients.cc;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{c.subject}</h1>
          <p className="mt-1 text-sm text-muted">
            {sent
              ? `Sent ${sent.at} ET by ${sent.by} to ${sent.count} recipients. A sent report can't be changed.`
              : `Draft. Numbers as of ${new Date(genAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET.`}
          </p>
        </div>
        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || !dirty} onClick={save} className={`${btn} border border-line bg-card text-ink hover:border-brand`}>
              {dirty ? "Save changes" : "Saved"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  if (dirty && !confirm("Refresh the numbers? Your notes are kept, but any table cells you typed over are replaced.")) return;
                  const next = await refreshNumbers(id, c);
                  setC(next);
                  setGenAt(new Date().toISOString());
                  setDirty(false);
                  return "Numbers refreshed from the track record.";
                })
              }
              className={`${btn} border border-line bg-card text-ink hover:border-brand`}
            >
              Refresh numbers
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  if (dirty) await saveReport(id, c);
                  setDirty(false);
                  await sendTestToMe(id);
                  return `Test sent to ${me}.`;
                })
              }
              className={`${btn} border border-brand bg-card text-brand`}
            >
              Send test to me
            </button>
            <button
              type="button"
              disabled={pending || total === 0}
              title={total === 0 ? "Add recipients on the Weekly report page first" : undefined}
              onClick={() =>
                run(async () => {
                  if (!confirm(`Send "${c.subject}" to ${recipients.to} To + ${recipients.cc} Cc recipients now? This can't be undone.`)) return;
                  if (dirty) await saveReport(id, c);
                  setDirty(false);
                  await sendToList(id);
                  router.refresh();
                  return "Sent.";
                })
              }
              className={`${btn} bg-brand text-white hover:bg-brand/90`}
            >
              {pending ? "Working…" : `Send to list (${total})`}
            </button>
          </div>
        )}
      </header>
      {msg && <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">{msg}</p>}
      {total === 0 && !locked && (
        <p className="text-sm text-muted">
          No recipients yet. <Link href="/report" className="text-brand hover:underline">Add them</Link> before sending.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <fieldset disabled={locked} className="min-w-0 space-y-4">
          <div>
            <label className={label} htmlFor="e-subj">Subject</label>
            <input id="e-subj" value={c.subject} onChange={(e) => edit({ ...c, subject: e.target.value })} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="e-intro">Opening</label>
            <textarea id="e-intro" rows={5} value={c.intro} onChange={(e) => edit({ ...c, intro: e.target.value })} className={field} />
          </div>
          {c.sections.map((s, si) => (
            <section key={s.code} className="rounded-xl border border-line bg-card p-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={s.include} onChange={(e) => setSection(si, { include: e.target.checked })} className="accent-brand" />
                {s.name}
                {s.closedThisWeek >= 0 && <span className="font-normal text-faint">· {s.closedThisWeek} closed this week</span>}
              </label>
              {s.include && (
                <div className="mt-3 space-y-3">
                  {s.tables.map((t, ti) => (
                    <div key={ti} className="overflow-x-auto">
                      <p className="mb-1 text-xs font-medium text-muted">{t.title}</p>
                      <table className="num w-full text-xs">
                        <thead>
                          <tr>
                            <th />
                            {t.columns.map((col) => (
                              <th key={col} className="px-1 pb-1 text-center font-medium text-muted">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {t.rows.map((r, ri) => (
                            <tr key={ri}>
                              <td className="whitespace-nowrap pr-2 text-right text-muted">{r[0]}</td>
                              {r.slice(1).map((v, ci) => (
                                <td key={ci} className="px-0.5 py-0.5">
                                  <input
                                    value={v}
                                    aria-label={`${t.title} ${r[0]} ${t.columns[ci]}`}
                                    onChange={(e) => setCell(si, ti, ri, ci + 1, e.target.value)}
                                    className="w-full rounded border border-line bg-white px-1.5 py-1 text-center text-xs focus:border-brand focus:outline-none"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <div>
                    <label className={label} htmlFor={`e-note-${s.code}`}>Note under {s.name}</label>
                    <textarea id={`e-note-${s.code}`} rows={2} value={s.note} onChange={(e) => setSection(si, { note: e.target.value })} className={field} />
                  </div>
                </div>
              )}
            </section>
          ))}
          <div>
            <label className={label} htmlFor="e-close">Closing</label>
            <textarea id="e-close" rows={3} value={c.closing} onChange={(e) => edit({ ...c, closing: e.target.value })} className={field} />
          </div>
        </fieldset>

        <div className="min-w-0">
          <p className={label}>Preview, exactly as it will be emailed</p>
          <iframe title="Email preview" srcDoc={html} sandbox="allow-popups" className="h-[1400px] w-full rounded-xl border border-line bg-white" />
        </div>
      </div>
    </div>
  );
}
