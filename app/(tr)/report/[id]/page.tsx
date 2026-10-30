import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireViewer } from "@/lib/tr/viewer";
import { reportSettings, type ReportContent } from "@/lib/tr/weekly";
import { ReportEditor } from "./ReportEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly report · Track Record" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.canAdmin) return <p className="text-sm text-muted">The weekly report is for track-record admins.</p>;
  const r = await prisma.trWeeklyReport.findUnique({ where: { id: (await params).id } });
  if (!r) notFound();
  const s = await reportSettings();
  const sentTo = r.sentTo as { to: string[]; cc: string[] } | null;
  return (
    <div className="space-y-4">
      <Link href="/report" className="text-sm text-brand hover:underline">← All reports</Link>
      <ReportEditor
        id={r.id}
        initial={r.content as unknown as ReportContent}
        generatedAt={r.generatedAt.toISOString()}
        status={r.status}
        lastError={r.lastError}
        sent={
          r.status === "SENT" && r.sentAt
            ? {
                at: r.sentAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }),
                by: r.sentBy ?? "",
                count: (sentTo?.to.length ?? 0) + (sentTo?.cc.length ?? 0),
              }
            : null
        }
        recipients={{ to: s.to.length, cc: s.cc.length }}
        me={viewer.user.email}
      />
    </div>
  );
}
