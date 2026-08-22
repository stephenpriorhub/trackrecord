/**
 * Price refresh. One batched Massive call covers every managed portfolio.
 *
 * Authenticated by CRON_SECRET, not by hub session: the caller is Railway's
 * scheduler, which has no cookies. Accepts the secret in a header or a query
 * param so it works from both a cron config and a manual curl.
 */
import { NextRequest, NextResponse } from "next/server";
import { refreshPrices, retireUnusedInstruments } from "@/lib/managed/pricing";
import { getHubUser, isHubAdmin } from "@/lib/hub-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const given =
    req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("key");
  if (secret && given === secret) return true;
  // A hub admin may also trigger it by hand from a browser, which is how you
  // check the integration without digging the secret out of Railway.
  return isHubAdmin(await getHubUser(req));
}

async function run(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await refreshPrices();
  const retired = req.nextUrl.searchParams.get("retire") === "1"
    ? await retireUnusedInstruments()
    : 0;

  // 200 even with partial errors: a rate limit on one batch is a normal
  // occurrence the next run converges on, not a failed job. The report says
  // exactly what was missed so a red status is reserved for a real outage.
  return NextResponse.json({
    ...report,
    unpricedCount: report.unpriced.length,
    // Cap the list so one bad day of expired contracts cannot produce a
    // megabyte of JSON in the cron log.
    unpriced: report.unpriced.slice(0, 50),
    retired,
  });
}

export const GET = run;
export const POST = run;
