import Link from "next/link";
import { SyncButton } from "@/components/tr/SyncButton";
import { serviceAccountEmail } from "@/lib/tr/google";
import { airtableMissingCounts, syncStatus } from "@/lib/tr/queries";
import { SHEET_SERVICES } from "@/lib/tr/services";
import { int } from "@/lib/tr/format";
import { requireViewer } from "@/lib/tr/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sheet sync · Track Record" };

interface Issues {
  skipped?: { tab: string; row: number; symbol: string; reason: string }[];
  crossLabelled?: { row: number; symbol: string; label: string }[];
  pending?: { row: number; tab: string; symbol: string }[];
}

export default async function StatusPage() {
  const viewer = await requireViewer();
  const [status, missing] = await Promise.all([syncStatus(), airtableMissingCounts()]);
  const sa = serviceAccountEmail();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sheet sync &amp; data checks</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            The track record re-reads each service&apos;s Google Sheet every 15 minutes during market hours. Anything the
            sheet needs fixed shows up here.
          </p>
        </div>
        {viewer.canAdmin && <SyncButton />}
      </header>

      <section className="rounded-2xl border border-line bg-card p-5 text-sm shadow-sm">
        <h2 className="font-semibold">Sheet access</h2>
        <p className="mt-1 text-muted">
          {sa ? (
            <>
              Share each sheet with <code className="rounded bg-paper px-1.5 py-0.5 text-ink">{sa}</code> as an{" "}
              <strong>Editor</strong>. Reading works through that account or the sheet&apos;s public link; logging trades
              needs Editor access.
            </>
          ) : (
            <>No Google service account is configured, so sheets are read through their public links and trades can&apos;t be logged.</>
          )}
        </p>
      </section>

      {SHEET_SERVICES.map((def) => {
        const s = status.find((x) => x.code === def.code);
        const issues = (s?.lastSyncIssues ?? {}) as Issues;
        return (
          <section key={def.code} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                <Link href={`/s/${def.slug}`} className="hover:underline">{def.name}</Link>
              </h2>
              <a
                href={`https://docs.google.com/spreadsheets/d/${def.sheetId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand hover:underline"
              >
                Open sheet ↗
              </a>
            </div>
            <p className={`mt-1 text-sm ${s?.lastSyncOk === false ? "text-loss" : "text-muted"}`}>
              {s?.lastSyncedAt
                ? `${s.lastSyncOk ? "Synced" : "Sync failed"} ${s.lastSyncedAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET — ${s.lastSyncMessage}`
                : "Not synced yet."}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href={`/s/${def.slug}?airtable=missing#trades`} className="text-brand hover:underline">
                  {int(missing[def.code] ?? 0)} trades with no matching Airtable position
                </Link>
              </li>
              {issues.pending && issues.pending.length > 0 && (
                <li>
                  <p className="font-medium">Not yet copied into “Since Inception” (counted from their period tab):</p>
                  <p className="text-muted">{issues.pending.map((p) => `${p.symbol} (${p.tab} row ${p.row})`).join(", ")}</p>
                </li>
              )}
              {issues.crossLabelled && issues.crossLabelled.length > 0 && (
                <li>
                  <p className="font-medium">Rows whose Portfolio column names another service (counted here, as the sheet does):</p>
                  <p className="text-muted">{issues.crossLabelled.map((c) => `${c.symbol} → “${c.label}” (row ${c.row})`).join(", ")}</p>
                </li>
              )}
              {issues.skipped && issues.skipped.length > 0 && (
                <li>
                  <p className="font-medium">Rows that could not be read:</p>
                  <p className="text-muted">{issues.skipped.map((k) => `${k.tab} row ${k.row} ${k.symbol}: ${k.reason}`).join("; ")}</p>
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
