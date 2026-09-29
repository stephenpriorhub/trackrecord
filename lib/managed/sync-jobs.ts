/**
 * Background runner for the Airtable -> Portfolio Manager sync.
 *
 * WHY
 *   The hub button used to run the sync inside the request. The War Room's
 *   ~3,500 positions took minutes, the browser gave up, and the button read
 *   "failed" even when the work finished. Now the button starts a job and
 *   polls it.
 *
 * ONE RUN PER PUBLICATION AT A TIME. The button and the daily schedule both
 * come through here, and two overlapping applies could each create the same
 * new position. A second request for a publication that is already running
 * gets the running job back instead of starting another.
 *
 * State is in memory: the app runs as one long-lived Node process on
 * Railway. A restart forgets job status (the sync itself is idempotent, so
 * re-running is always safe).
 */
import {
  recordSync,
  summariseSync,
  syncPublicationFromAirtable,
  type SyncSummary,
} from "./airtable-sync";

export interface SyncJob {
  pubCode: string;
  apply: boolean;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summary: SyncSummary | null;
  error: string | null;
}

const jobs = new Map<string, SyncJob>();

/** Start a sync, or return the one already running for this publication. */
export function startSyncJob(
  pubCode: string,
  apply: boolean,
  onDone?: () => void,
): SyncJob {
  const current = jobs.get(pubCode);
  if (current?.status === "running") return current;

  const job: SyncJob = {
    pubCode,
    apply,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    error: null,
  };
  jobs.set(pubCode, job);

  void (async () => {
    try {
      const report = await syncPublicationFromAirtable(pubCode, { dryRun: !apply });
      if (apply) await recordSync(report);
      job.summary = summariseSync(report);
      job.status = "done";
      console.log("[managed-sync]", pubCode, apply ? "apply" : "preview", JSON.stringify({
        created: job.summary.created,
        rebuilt: job.summary.rebuilt,
        unchanged: job.summary.unchanged,
        conflicts: job.summary.conflicts.length,
        errors: job.summary.errors.length,
        fixes: job.summary.fixes,
      }));
      onDone?.();
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      console.error("[managed-sync]", pubCode, job.error);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();

  return job;
}

export function getSyncJob(pubCode: string): SyncJob | null {
  return jobs.get(pubCode) ?? null;
}
