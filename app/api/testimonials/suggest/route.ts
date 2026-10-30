import { NextRequest, NextResponse } from "next/server";
import { currentViewer } from "@/lib/tr/viewer";
import { integrationKey, WIKI_URL } from "@/lib/tr/wiki-link";

export const dynamic = "force-dynamic";

/**
 * POST /api/testimonials/suggest — testimonials from the MTA Wiki that match a
 * page of trades. Signed-in viewers only; this relays to the wiki's match API
 * with the shared key so the browser never holds it.
 */
export async function POST(req: NextRequest) {
  if (!(await currentViewer())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = integrationKey();
  if (!key) return NextResponse.json({ matches: {}, gridUrls: {}, error: "Wiki link not configured" });

  const body = await req.text();
  try {
    const res = await fetch(`${WIKI_URL}/api/testimonials/match`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-integration-key": key },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return NextResponse.json({ matches: {}, gridUrls: {}, error: `Wiki returned ${res.status}` });
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ matches: {}, gridUrls: {}, error: e instanceof Error ? e.message : "Wiki unreachable" });
  }
}
