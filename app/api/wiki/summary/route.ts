import { NextRequest, NextResponse } from "next/server";
import { serviceCardData } from "@/lib/tr/card";
import { loadSummaryTrades } from "@/lib/tr/queries";
import { serviceByCode } from "@/lib/tr/services";
import { prisma } from "@/lib/prisma";
import { PERIOD_LABEL, todayNY } from "@/lib/tr/stats";
import { TRACKRECORD_PUBLIC_URL, verifyIntegrationKey } from "@/lib/tr/wiki-link";

export const dynamic = "force-dynamic";

/**
 * GET /api/wiki/summary?code=WAR — a service's summary card for its MTA Wiki
 * profile (x-integration-key). Same figures as the home page card, closed
 * trades only. Long-term services read Portfolio Manager books rather than a
 * trade list, so for those the wiki gets just the link.
 */
export async function GET(req: NextRequest) {
  if (!verifyIntegrationKey(req.headers.get("x-integration-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const def = serviceByCode(new URL(req.url).searchParams.get("code") ?? "");
  if (!def) return NextResponse.json({ error: "Not tracked" }, { status: 404 });

  const base = {
    code: def.code,
    name: def.name,
    url: `${TRACKRECORD_PUBLIC_URL}/s/${def.slug}`,
    weighted: !!def.weighted,
    periods: PERIOD_LABEL,
  };
  if (!def.sheetId) return NextResponse.json({ ...base, views: [], note: null, updatedAt: null });

  const today = todayNY();
  const [trades, settings] = await Promise.all([
    loadSummaryTrades([def.code]),
    prisma.trService.findUnique({ where: { code: def.code }, select: { lastSyncedAt: true } }),
  ]);
  const { views, note } = serviceCardData(def, trades.get(def.code) ?? [], today);
  return NextResponse.json({ ...base, views, note: note ?? null, updatedAt: settings?.lastSyncedAt ?? null });
}
