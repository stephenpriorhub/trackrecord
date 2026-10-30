/**
 * Makes the weekly report DRAFT. Never sends: sending is only ever an admin
 * pressing Send in /report/[id].
 *
 * Called by GitHub Actions at 16:00 and 17:00 UTC on Fridays (noon ET in
 * daylight and standard time); only acts between 12:00 and 13:59 New York time
 * unless ?force=1. Idempotent: an existing draft for the week is left alone.
 * Authenticated by CRON_SECRET (header x-cron-secret).
 */
import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyDraft } from "@/lib/tr/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const noonFriday = parts.weekday === "Fri" && ["12", "13"].includes(parts.hour);
  if (!noonFriday && req.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ skipped: `Not Friday noon in New York (${parts.weekday} ${parts.hour}:00).` });
  }
  const { created, report } = await generateWeeklyDraft();
  return NextResponse.json({ created, id: report.id, status: report.status });
}
