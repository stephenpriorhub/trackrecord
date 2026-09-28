import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePubCode } from "@/lib/publications";
import { syncPublicationFromAirtable, type SyncReport } from "@/lib/managed/airtable-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pull Airtable's trades into Portfolio Manager for one publication.
 *
 *   POST /api/managed-sync?pubCode=XAI            dry run: returns what WOULD change
 *   POST /api/managed-sync?pubCode=XAI&apply=1    applies it, in the background
 *
 * Same key as /api/sync (header x-sync-key). A dry run is the default on
 * purpose: it touches nothing and answers "what will this do" before it does it.
 * See lib/managed/airtable-sync.ts for what is and is never touched.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-sync-key");
  if (!process.env.SYNC_API_KEY || key !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("pubCode");
  if (!raw) return NextResponse.json({ error: "pubCode is required" }, { status: 400 });
  const pubCode = resolvePubCode(raw);
  const apply = req.nextUrl.searchParams.get("apply") === "1";

  if (!apply) {
    const report = await syncPublicationFromAirtable(pubCode, { dryRun: true });
    return NextResponse.json(summarise(report));
  }

  after(async () => {
    const report = await syncPublicationFromAirtable(pubCode, { dryRun: false });
    const s = summarise(report);
    console.log("[managed-sync]", JSON.stringify(s));
    // "Last pulled" on each Airtable-fed portfolio's source panel.
    await prisma.managedPortfolio.updateMany({
      where: {
        service: { pubCode },
        positions: { some: { source: "AIRTABLE_IMPORT" } },
      },
      data: {
        syncedAt: new Date(),
        syncNote: `${s.created} new, ${s.rebuilt} updated, ${s.conflicts.length} need a look`,
      },
    });
  });
  return NextResponse.json({ message: "Sync started", pubCode }, { status: 202 });
}

function summarise(r: SyncReport) {
  return {
    pubCode: r.pubCode,
    dryRun: r.dryRun,
    created: r.created,
    rebuilt: r.rebuilt.length,
    unchanged: r.unchanged,
    changes: r.rebuilt,
    conflicts: r.conflicts,
    errors: r.errors,
  };
}
