/**
 * Track-record sheet sync: re-reads every service's Google Sheet and replaces
 * its stored trades. Called by GitHub Actions on a schedule.
 *
 * Authenticated by CRON_SECRET (header x-cron-secret or ?key=), or a hub admin
 * from a browser. ?codes=WAR,DPL limits the run.
 */
import { NextRequest, NextResponse } from "next/server";
import { getHubUser, isHubAdmin } from "@/lib/hub-auth";
import { syncSheets } from "@/lib/tr/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("key");
  if (secret && given === secret) return true;
  return isHubAdmin(await getHubUser(req));
}

async function run(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const codes = (req.nextUrl.searchParams.get("codes") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const report = await syncSheets(codes);
  const ok = report.every((r) => r.ok);
  return NextResponse.json({ ok, report }, { status: ok ? 200 : 207 });
}

export const GET = run;
export const POST = run;
