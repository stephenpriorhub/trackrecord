import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/tr/format";
import { requireViewer } from "@/lib/tr/viewer";
import { reportSettings, weekEndingFor, type ReportContent } from "@/lib/tr/weekly";
import { GenerateButton, RecipientsForm } from "./ReportControls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly report · Track Record" };

const STATUS: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-800",
  SENDING: "bg-sky-100 text-sky-800",
  SENT: "bg-emerald-100 text-emerald-800",
};

export default async function ReportsPage() {
  const viewer = await requireViewer();
  if (!viewer.canAdmin) {
    return <p className="text-sm text-muted">The weekly report is for track-record admins.</p>;
  }
  const [reports, settings] = await Promise.all([
    prisma.trWeeklyReport.findMany({ orderBy: { weekEnding: "desc" }, take: 30 }),
    reportSettings(),
  ]);
  const thisWeek = weekEndingFor();
  const hasThisWeek = reports.some((r) => r.weekEnding.toISOString().slice(0, 10) === thisWeek);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Weekly performance report</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A draft is made every Friday at 12:00 PM ET from the track record&apos;s own numbers. Review and edit it, then
          send it. Nothing is ever emailed until an admin presses Send.
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Reports</h2>
          {!hasThisWeek && <GenerateButton label={`Make the draft for week ending ${fmtDate(thisWeek)} now`} />}
        </div>
        {reports.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No reports yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {reports.map((r) => {
              const c = r.content as unknown as ReportContent;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <Link href={`/report/${r.id}`} className="font-medium text-brand hover:underline">
                    {c.subject}
                  </Link>
                  <span className="flex items-center gap-3 text-muted">
                    {r.status === "SENT" && r.sentAt
                      ? `Sent ${r.sentAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} by ${r.sentBy}`
                      : r.editedAt
                        ? `Edited by ${r.editedBy}`
                        : `Generated ${r.generatedAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}`}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status] ?? ""}`}>{r.status.toLowerCase()}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Recipients</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The same list every week. Paste addresses straight from an Outlook To or Cc line, or one per line. Replies go to
          the admin who sends.
        </p>
        <RecipientsForm to={settings.to} cc={settings.cc} updatedBy={settings.updatedBy ?? null} />
      </section>
    </div>
  );
}
