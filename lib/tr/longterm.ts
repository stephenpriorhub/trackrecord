/**
 * Long-term (McCall) services: no trade sheet, just model portfolios kept in
 * Portfolio Manager. Stephen, 2026-10-24: "they won't be trades. They are
 * long-term. Just need a summary of portfolio."
 */
import { prisma } from "../prisma";
import { parseEmbedOptions, loadServiceEmbed, type EmbedView } from "../managed/embed";
import { serviceStats, withBenchmark } from "../managed/stats";
import type { ServiceDef } from "./services";

export interface LongTermSummary {
  serviceSlug: string | null;
  positions: number;
  open: number;
  closed: number;
  avgReturn: number | null;
  winRate: number | null;
  best: number | null;
  since: Date | null;
  spx: number | null;
}

async function managedService(def: ServiceDef) {
  if (!def.managedPubCode) return null;
  return prisma.service.findUnique({ where: { pubCode: def.managedPubCode }, select: { id: true, slug: true } });
}

export async function longTermSummary(def: ServiceDef): Promise<LongTermSummary> {
  const svc = await managedService(def);
  const empty: LongTermSummary = {
    serviceSlug: svc?.slug ?? null, positions: 0, open: 0, closed: 0,
    avgReturn: null, winRate: null, best: null, since: null, spx: null,
  };
  if (!svc) return empty;
  const { stats, benchmark } = await withBenchmark(await serviceStats(svc.id), "SPY");
  return {
    serviceSlug: svc.slug,
    positions: stats.positions,
    open: stats.open,
    closed: stats.closed,
    avgReturn: stats.avgReturn?.toNumber() ?? null,
    winRate: stats.winRate?.toNumber() ?? null,
    best: stats.bestReturn?.toNumber() ?? null,
    since: stats.since,
    spx: benchmark.return?.toNumber() ?? null,
  };
}

/**
 * The full holdings view, one block per sub-portfolio. Built by the same
 * loader as the public widgets, so this page and every embed agree.
 * `publicOnly` restricts it to portfolios published for embedding.
 */
export async function longTermView(def: ServiceDef, publicOnly: boolean): Promise<EmbedView | null> {
  const svc = await managedService(def);
  if (!svc) return null;
  const options = parseEmbedOptions({ layout: "grouped", show: "both", limit: "all" });
  return loadServiceEmbed(svc.slug, options, !publicOnly);
}
