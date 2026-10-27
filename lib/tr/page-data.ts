/**
 * Everything a service page needs, for both the signed-in page (/s/[slug])
 * and the public read-only page (/t/[token]) — one loader so they can't drift.
 */
import { prisma } from "../prisma";
import { longTermBooks } from "./longterm";
import { publicationInfo } from "./publications";
import { listOpen, listTrades, loadSummaryTrades, parseFilters, summarise } from "./queries";
import type { ServiceDef } from "./services";
import type { PeriodKey } from "./stats";

export type SearchParams = Record<string, string | string[] | undefined>;

export function flatParams(sp: SearchParams): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

export function breakdownPeriod(sp: SearchParams): PeriodKey {
  const v = flatParams(sp).bp;
  return v === "week" || v === "month" || v === "year" ? v : "inception";
}

export async function loadServicePage(def: ServiceDef, sp: SearchParams, publicOnly: boolean) {
  const [info, settings] = await Promise.all([
    publicationInfo(def.code),
    prisma.trService.findUnique({ where: { code: def.code } }),
  ]);

  if (!def.sheetId) {
    return { kind: "longterm" as const, info, settings, books: await longTermBooks(def, publicOnly) };
  }

  const filters = parseFilters(sp);
  // Open positions are internal: they're live recommendations, so the
  // public page never carries them.
  const [byCode, list, open] = await Promise.all([
    loadSummaryTrades([def.code]),
    listTrades(def.code, filters),
    publicOnly
      ? Promise.resolve([])
      : listOpen(def.code, flatParams(sp).osort, flatParams(sp).odir === "asc" ? "asc" : flatParams(sp).odir === "desc" ? "desc" : undefined),
  ]);
  return {
    kind: "trading" as const,
    info,
    settings,
    summary: summarise(def, byCode.get(def.code) ?? []),
    list,
    open,
    filters,
  };
}
