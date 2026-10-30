import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentViewer } from "@/lib/tr/viewer";
import { integrationKey, WIKI_URL } from "@/lib/tr/wiki-link";

export const dynamic = "force-dynamic";

/**
 * POST /api/testimonials/suggest — testimonials from the MTA Wiki that match a
 * page of trades. Signed-in viewers only; this relays to the wiki's match API
 * with the shared key so the browser never holds it.
 *
 * Every other trade on the same tickers goes along as `context`: the wiki gives
 * each testimonial to the single trade it best fits, so it has to see the
 * two-day strangle before it can stop a year-long spread claiming its posts.
 */
export async function POST(req: NextRequest) {
  if (!(await currentViewer())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = integrationKey();
  if (!key) return NextResponse.json({ matches: {}, gridUrls: {}, error: "Wiki link not configured" });

  const input = await req.json().catch(() => null);
  const trades: { id: string; pubCode: string; ticker: string }[] = Array.isArray(input?.trades) ? input.trades : [];
  const rows = trades.length
    ? await prisma.trTrade.findMany({
        where: {
          serviceCode: { in: [...new Set(trades.map((t) => t.pubCode))] },
          underlying: { in: [...new Set(trades.map((t) => t.ticker))] },
        },
        select: { id: true, serviceCode: true, underlying: true, name: true, guru: true, openDate: true, closeDate: true },
        take: 3000,
      })
    : [];
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const context = rows.map((r) => ({
    id: r.id,
    pubCode: r.serviceCode,
    ticker: r.underlying,
    name: r.name,
    guru: r.guru,
    openDate: ymd(r.openDate),
    closeDate: ymd(r.closeDate),
  }));
  const body = JSON.stringify({ trades, context });
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
