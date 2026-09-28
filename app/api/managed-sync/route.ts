import { NextRequest, NextResponse, after } from "next/server";
import { resolvePubCode } from "@/lib/publications";
import {
  recordSync,
  summariseSync,
  syncPublicationFromAirtable,
} from "@/lib/managed/airtable-sync";

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
    try {
      const report = await syncPublicationFromAirtable(pubCode, { dryRun: true });
      return NextResponse.json(summariseSync(report));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 422 },
      );
    }
  }

  after(async () => {
    const report = await syncPublicationFromAirtable(pubCode, { dryRun: false });
    console.log("[managed-sync]", JSON.stringify(summariseSync(report)));
    await recordSync(report);
  });
  return NextResponse.json({ message: "Sync started", pubCode }, { status: 202 });
}
