"use client";

/**
 * "Sync from Airtable" for one publication: preview first, then apply.
 *
 * Two clicks on purpose. The preview lists every position that would change,
 * before and after, so a surprising Airtable edit is caught here rather than
 * on a live embed. Apply runs the same plan for real.
 */
import { useState, useTransition } from "react";
import { airtableSyncAction, type AirtableSyncResult } from "./actions";

export default function AirtableSyncPanel({
  serviceId,
  lastPulled,
}: {
  serviceId: string;
  lastPulled: string | null;
}) {
  const [result, setResult] = useState<AirtableSyncResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [pending, start] = useTransition();

  function run(apply: boolean) {
    start(async () => {
      const r = await airtableSyncAction(serviceId, apply);
      setResult(r);
      setApplied(apply && r.ok);
    });
  }

  const s = result?.ok ? result.summary : null;
  const nothingToDo = s && s.rebuilt === 0 && s.created === 0;

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Sync from Airtable</h3>
          <p className="mt-1 max-w-prose text-xs text-gray-500">
            Pulls new positions and any new trades — partial exits, scale-ins,
            closes — from Airtable into these portfolios. Positions with trades
            entered here are never overwritten.
            {lastPulled ? ` Last pulled ${lastPulled}.` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={pending}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {pending && !s ? "Checking Airtable…" : "Preview changes"}
          </button>
          {s && s.dryRun && !nothingToDo && (
            <button
              type="button"
              onClick={() => run(true)}
              disabled={pending}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {pending ? "Syncing…" : `Apply ${s.rebuilt} change${s.rebuilt === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      {result && !result.ok && (
        <p className="mt-3 rounded-lg border border-red-800/60 bg-red-900/20 p-3 text-sm text-red-300">
          {result.error}
        </p>
      )}

      {s && (
        <div className="mt-4 space-y-3 text-sm">
          <p className={applied ? "text-green-400" : "text-gray-300"}>
            {applied
              ? `Synced: ${s.created} new position${s.created === 1 ? "" : "s"}, ${s.rebuilt} updated, ${s.unchanged} already current.`
              : nothingToDo
                ? `Everything matches Airtable (${s.unchanged} positions checked). New Airtable positions, if any, are added when you apply.`
                : `${s.rebuilt} position${s.rebuilt === 1 ? "" : "s"} would change; ${s.unchanged} already match. New Airtable positions are added on apply.`}
          </p>

          {s.changes.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 text-left text-gray-500">
                  <tr>
                    <th className="p-2">Position</th>
                    <th className="p-2">Now</th>
                    <th className="p-2">{applied ? "Synced to" : "After sync"}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.changes.map((c) => (
                    <tr key={c.position} className="border-t border-gray-800 align-top">
                      <td className="p-2 font-medium text-gray-200">{c.position}</td>
                      <td className="p-2 text-gray-500">{c.before || "—"}</td>
                      <td className="p-2 text-gray-300">{c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {s.conflicts.length > 0 && (
            <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3 text-xs text-yellow-300">
              <p className="mb-1 font-semibold">Left alone — needs a look ({s.conflicts.length})</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {s.conflicts.map((c) => (
                  <li key={c.position}>
                    {c.position}: {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.errors.length > 0 && (
            <div className="rounded-lg border border-red-800/60 bg-red-900/20 p-3 text-xs text-red-300">
              <p className="mb-1 font-semibold">Errors ({s.errors.length})</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {s.errors.map((e, i) => (
                  <li key={i}>
                    {e.position}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
