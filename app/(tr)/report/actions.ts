"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/tr/viewer";
import {
  MAX_RECIPIENTS,
  generateWeeklyDraft,
  parseRecipients,
  rebuiltContent,
  refreshedContent,
  sendReport,
  sendTest,
  type ReportContent,
} from "@/lib/tr/weekly";

/** Every action here is admin-only and re-checks it itself. */

export async function generateNow(): Promise<string> {
  const v = await requireAdmin();
  const { report } = await generateWeeklyDraft(undefined, v.user.email);
  revalidatePath("/report");
  return report.id;
}

async function editable(id: string) {
  const r = await prisma.trWeeklyReport.findUniqueOrThrow({ where: { id } });
  if (r.status !== "DRAFT") throw new Error("A sent report can't be changed.");
  return r;
}

export async function saveReport(id: string, content: ReportContent) {
  const v = await requireAdmin();
  await editable(id);
  if (!content.subject?.trim()) throw new Error("The subject can't be empty.");
  await prisma.trWeeklyReport.updateMany({
    where: { id, status: "DRAFT" },
    data: { content: content as object, editedAt: new Date(), editedBy: v.user.email },
  });
  revalidatePath(`/report/${id}`);
}

export async function refreshNumbers(id: string, content: ReportContent): Promise<ReportContent> {
  const v = await requireAdmin();
  const r = await editable(id);
  const next = await refreshedContent(content);
  await prisma.trWeeklyReport.updateMany({
    where: { id: r.id, status: "DRAFT" },
    data: { content: next as object, generatedAt: new Date(), editedAt: new Date(), editedBy: v.user.email },
  });
  revalidatePath(`/report/${id}`);
  return next;
}

export async function sendTestToMe(id: string) {
  const v = await requireAdmin();
  await sendTest(id, v.user.email);
}

export async function sendToList(id: string) {
  const v = await requireAdmin();
  await sendReport(id, v.user.email);
  revalidatePath(`/report/${id}`);
  revalidatePath("/report");
}

export async function saveRecipients(toText: string, ccText: string): Promise<{ bad: string[] }> {
  const v = await requireAdmin();
  const to = parseRecipients(toText);
  const cc = parseRecipients(ccText);
  const ccOnly = cc.ok.filter((c) => !to.ok.some((t) => t.toLowerCase().includes(c.replace(/.*</, "").replace(/>$/, ""))));
  if (to.ok.length + ccOnly.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} recipients (To + Cc).`);
  await prisma.trReportSettings.upsert({
    where: { id: "weekly" },
    create: { id: "weekly", to: to.ok, cc: ccOnly, updatedBy: v.user.email },
    update: { to: to.ok, cc: ccOnly, updatedBy: v.user.email },
  });
  revalidatePath("/report");
  return { bad: [...to.bad, ...cc.bad] };
}

/** Start the draft over from the current template and numbers (discards edits). */
export async function rebuildDraft(id: string): Promise<ReportContent> {
  await requireAdmin();
  const r = await editable(id);
  const next = await rebuiltContent(r.content as unknown as ReportContent);
  await prisma.trWeeklyReport.updateMany({
    where: { id: r.id, status: "DRAFT" },
    data: { content: next as object, generatedAt: new Date(), editedAt: null, editedBy: null },
  });
  revalidatePath(`/report/${id}`);
  return next;
}
