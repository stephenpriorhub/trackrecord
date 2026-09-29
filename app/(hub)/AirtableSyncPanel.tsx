"use client";

/**
 * "Sync from Airtable" for one publication: preview first, then apply.
 *
 * Two clicks on purpose. The preview lists every position that would change,
 * before and after, so a surprising Airtable edit is caught here rather than
 * on a live embed. Apply runs the same plan for real.
 *
 * Both run in the BACKGROUND on the server (lib/managed/sync-jobs.ts) and this
 * panel polls for the result. Running inside the request made the War Room
 * time out in the browser and read as a failure.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { airtableSyncAction, airtableSyncStatusAction } from "./actions";
import type { SyncJob } from "@/lib/managed/sync-jobs";

export default function AirtableSyncPanel({
  serviceId,
  lastPulled,
}: {
  serviceId: string;
  lastPulled: string | null;
}) {
  const router = useRouter();
  const [job, setJob] = useState<SyncJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force one more status check (after starting a job).
  const [tick, setTick] = useState(0);

  // Poll while a job runs; on first render this also picks up a sync that is
  // already running (another tab, or the daily schedule).
  useEffect(() => {
    let cancelled = false;
    const delay = tick === 0 ? 0 : job?.status === "running" ? 2500 : 1500;
    const t = setTimeout(async () => {
      const r = await airtableSyncStatusAction(serviceId).catch(() => null);
      if (cancelled) return;
      if (!r) {
        // A dropped poll is not a failed sync; try again.
        setTick((n) => n + 1);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setJob(r.job);
      if (r.job?.status === "running") setTick((n) => n + 1);
      else if (r.job?.status === "done" && r.job.apply) router.refresh();
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by tick only
  }, [tick, serviceId]);

  async function run(apply: boolean) {
    setError(null);
    const r = await airtableSyncAction(serviceId, apply).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not reach the server.",
    }));
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setJob(r.job);
    setTick((n) => n + 1);
  }

  const pending = job?.status === "running";
  const applied = job?.status === "done" && job.apply;
  const s = job?.status === "done" ? job.summary : null;
  const adds = s?.toCreate.length ?? 0;
  const nothingToDo = s && s.rebuilt === 0 && s.created === 0 && adds === 0;

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
            {pending && !job?.apply ? "Checking Airtable…" : "Preview changes"}
          </button>
          {s && s.dryRun && !nothingToDo && (
            <button
              type="button"
              onClick={() => run(true)}
              disabled={pending}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {`Apply ${adds + s.rebuilt} change${adds + s.rebuilt === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      {pending && (
        <p className="mt-3 text-sm text-gray-400">
          {job?.apply ? "Syncing" : "Checking Airtable"} in the background — started{" "}
          {new Date(job!.startedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET.
          A large publication can take a minute or two; you can leave this page.
        </p>
      )}

      {(error || job?.status === "failed") && (
        <p className="mt-3 rounded-lg border border-red-800/60 bg-red-900/20 p-3 text-sm text-red-300">
          {error ?? `The sync stopped: ${job?.error}`}
        </p>
      )}

      {s && (
        <div className="mt-4 space-y-3 text-sm">
          <p className={applied ? "text-green-400" : "text-gray-300"}>
            {applied
              ? `Synced: ${s.created} new position${s.created === 1 ? "" : "s"}, ${s.rebuilt} updated, ${s.unchanged} already current.`
              : nothingToDo
                ? `Everything matches Airtable (${s.unchanged} positions checked).`
                : `${adds} to add, ${s.rebuilt} to update, ${s.unchanged} already match.`}
          </p>

          {!applied && s.toCreate.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 text-left text-gray-500">
                  <tr>
                    <th className="p-2">New position</th>
                    <th className="p-2">Goes into</th>
                    <th className="p-2">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {s.toCreate.map((c) => (
                    <tr key={c.position} className="border-t border-gray-800 align-top">
                      <td className="p-2 font-medium text-gray-200">{c.position}</td>
                      <td className="p-2 text-gray-300">
                        {c.portfolio}
                        {c.newPortfolio ? (
                          <span className="block text-yellow-400">
                            new portfolio — starts private, not on any embed until published
                          </span>
                        ) : !c.publicPortfolio ? (
                          <span className="block text-yellow-400">private — not on embeds</span>
                        ) : null}
                      </td>
                      <td className="p-2 text-gray-400">{c.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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

          {!applied && s.adopted.length > 0 && (
            <details className="rounded-lg border border-gray-800 p-3 text-xs text-gray-400">
              <summary className="cursor-pointer text-gray-300">
                Re-linked to Airtable&apos;s current record ({s.adopted.length})
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {s.adopted.map((c) => (
                  <li key={c.position}>
                    {c.position} — {c.matches}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!applied && s.alreadyHere.length > 0 && (
            <details className="rounded-lg border border-gray-800 p-3 text-xs text-gray-400">
              <summary className="cursor-pointer text-gray-300">
                Already here, not added again ({s.alreadyHere.length})
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {s.alreadyHere.map((c) => (
                  <li key={c.position}>
                    {c.position} — matches {c.matches}
                  </li>
                ))}
              </ul>
            </details>
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
