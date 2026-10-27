/**
 * What the track-record pages read. Every figure is computed here from
 * TrTrade rows — never copied from a sheet's summary tab.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { type ServiceDef, SHEET_SERVICES } from "./services";
import {
  type PeriodKey,
  type PeriodStats,
  type StatTrade,
  computeStats,
  inPeriod,
  periodBounds,
  statsByPeriod,
  todayNY,
} from "./stats";

export interface SummaryTrade extends StatTrade {
  portfolio: string;
  guru: string | null;
  spxReturnPct: number | null;
}

const SUMMARY_SELECT = {
  returnPct: true,
  weight: true,
  holdDays: true,
  openDate: true,
  closeDate: true,
  closeAfterBell: true,
  status: true,
  name: true,
  symbol: true,
  premiumCapture: true,
  portfolio: true,
  guru: true,
  spxReturnPct: true,
  serviceCode: true,
  airtableId: true,
} as const;

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function loadSummaryTrades(codes: string[]): Promise<Map<string, SummaryTrade[]>> {
  const rows = await prisma.trTrade.findMany({ where: { serviceCode: { in: codes } }, select: SUMMARY_SELECT });
  const out = new Map<string, SummaryTrade[]>(codes.map((c) => [c, []]));
  for (const r of rows) {
    out.get(r.serviceCode)!.push({
      ...r,
      openDate: ymd(r.openDate)!,
      closeDate: ymd(r.closeDate),
    });
  }
  return out;
}

/** Trades that count toward the service's headline (DPL's lotto book does not). */
export function headlineTrades(def: ServiceDef, trades: SummaryTrade[]): SummaryTrade[] {
  const excluded = new Set(def.subPortfolios.filter((p) => !p.inHeadline).map((p) => p.key));
  return excluded.size ? trades.filter((t) => !excluded.has(t.portfolio)) : trades;
}

export interface GroupSummary {
  key: string;
  label: string;
  kind: "portfolio" | "guru";
  inHeadline: boolean;
  stats: Record<PeriodKey, PeriodStats>;
}

export interface BenchmarkSummary {
  /** Closed trades with an S&P figure. */
  trades: number;
  avgTrade: number | null;
  avgSpx: number | null;
  /** Share of those trades that beat the S&P over their own holding period. */
  beatRate: number | null;
}

export interface ServiceSummary {
  code: string;
  headline: Record<PeriodKey, PeriodStats>;
  groups: GroupSummary[];
  benchmark: Record<PeriodKey, BenchmarkSummary>;
  firstTrade: string | null;
  totalTrades: number;
}

function benchmarkFor(trades: SummaryTrade[]): BenchmarkSummary {
  const xs = trades.filter((t) => t.status === "CLOSED" && t.returnPct !== null && t.spxReturnPct !== null);
  if (!xs.length) return { trades: 0, avgTrade: null, avgSpx: null, beatRate: null };
  const sum = (f: (t: SummaryTrade) => number) => xs.reduce((a, t) => a + f(t), 0);
  return {
    trades: xs.length,
    avgTrade: sum((t) => t.returnPct!) / xs.length,
    avgSpx: sum((t) => t.spxReturnPct!) / xs.length,
    beatRate: xs.filter((t) => t.returnPct! > t.spxReturnPct!).length / xs.length,
  };
}

export function summarise(def: ServiceDef, all: SummaryTrade[], today = todayNY()): ServiceSummary {
  const head = headlineTrades(def, all);
  const groups: GroupSummary[] = [];
  if (def.byGuru) {
    for (const g of def.gurus) {
      groups.push({
        key: g,
        label: g,
        kind: "guru",
        inHeadline: true,
        stats: statsByPeriod(head.filter((t) => t.guru === g), today),
      });
    }
  }
  for (const p of def.subPortfolios) {
    groups.push({
      key: p.key,
      label: p.label,
      kind: "portfolio",
      inHeadline: p.inHeadline,
      stats: statsByPeriod(all.filter((t) => t.portfolio === p.key), today),
    });
  }
  const benchmark = {} as Record<PeriodKey, BenchmarkSummary>;
  for (const k of ["week", "lastWeek", "month", "year", "inception"] as PeriodKey[]) {
    const b = periodBounds(k, today);
    benchmark[k] = benchmarkFor(head.filter((t) => inPeriod(t, b)));
  }
  const first = head.reduce<string | null>((m, t) => (!m || t.openDate < m ? t.openDate : m), null);
  return {
    code: def.code,
    headline: statsByPeriod(head, today),
    groups,
    benchmark,
    firstTrade: first,
    totalTrades: head.length,
  };
}

/** Every trading service's trades closed this week, pooled. */
export function weekAcrossServices(
  byCode: Map<string, SummaryTrade[]>,
  today = todayNY(),
): { stats: PeriodStats; top: (SummaryTrade & { serviceCode: string })[] } {
  const b = periodBounds("week", today);
  const pooled: (SummaryTrade & { serviceCode: string })[] = [];
  for (const def of SHEET_SERVICES) {
    for (const t of headlineTrades(def, byCode.get(def.code) ?? [])) {
      if (inPeriod(t, b)) pooled.push({ ...t, serviceCode: def.code });
    }
  }
  const top = pooled
    .filter((t) => (t.returnPct ?? 0) > 0)
    .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))
    .slice(0, 6);
  return { stats: computeStats(pooled), top };
}

// ---- trade list ---------------------------------------------------------------

export interface TradeFilters {
  q?: string;
  status?: "OPEN" | "CLOSED";
  portfolio?: string;
  guru?: string;
  type?: string;
  result?: "win" | "loss";
  openedFrom?: string;
  openedTo?: string;
  closedFrom?: string;
  closedTo?: string;
  airtable?: "missing" | "matched";
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
}

export const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "calls", label: "Calls" },
  { value: "puts", label: "Puts" },
  { value: "spreads", label: "Spreads" },
  { value: "butterflies", label: "Butterflies" },
  { value: "strangles", label: "Strangles" },
  { value: "put-sells", label: "Put sells" },
  { value: "stock", label: "Stock" },
];

export const SORTS: { value: string; label: string }[] = [
  { value: "closed", label: "Close date" },
  { value: "opened", label: "Open date" },
  { value: "return", label: "Return" },
  { value: "days", label: "Days held" },
  { value: "symbol", label: "Ticker" },
  { value: "spx", label: "S&P same days" },
];

/** Direction a column sorts in when first clicked. */
export const defaultDir = (sort: string) => (sort === "symbol" ? "asc" : "desc");

const isYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export function parseFilters(sp: Record<string, string | string[] | undefined>): TradeFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const status = one("status")?.toUpperCase();
  const result = one("result");
  const dir = one("dir");
  const airtable = one("airtable");
  return {
    q: one("q")?.slice(0, 40),
    status: status === "OPEN" || status === "CLOSED" ? status : undefined,
    portfolio: one("portfolio"),
    guru: one("guru"),
    type: TYPE_FILTERS.some((t) => t.value === one("type")) ? one("type") : undefined,
    result: result === "win" || result === "loss" ? result : undefined,
    openedFrom: isYmd(one("openedFrom")) ? one("openedFrom") : undefined,
    openedTo: isYmd(one("openedTo")) ? one("openedTo") : undefined,
    closedFrom: isYmd(one("closedFrom")) ? one("closedFrom") : undefined,
    closedTo: isYmd(one("closedTo")) ? one("closedTo") : undefined,
    airtable: airtable === "missing" || airtable === "matched" ? airtable : undefined,
    sort: SORTS.some((s) => s.value === one("sort")) ? one("sort") : undefined,
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
    page: Math.max(1, Number(one("page")) || 1),
  };
}

function where(code: string, f: TradeFilters): Prisma.TrTradeWhereInput {
  const and: Prisma.TrTradeWhereInput[] = [{ serviceCode: code }];
  if (f.q) {
    const q = f.q.toUpperCase();
    and.push({ OR: [{ underlying: { startsWith: q } }, { symbol: { contains: q } }, { name: { contains: f.q, mode: "insensitive" } }] });
  }
  // The trade list is the sheet's closed trades unless open ones are asked
  // for; open positions have their own table.
  // A search looks through everything, open positions included.
  if (f.status) and.push({ status: f.status });
  else if (!f.q) and.push({ status: "CLOSED" });
  if (f.portfolio) and.push({ portfolio: f.portfolio });
  if (f.guru) and.push({ guru: f.guru });
  switch (f.type) {
    case "calls": and.push({ optionType: "CALL", structure: "SINGLE" }); break;
    case "puts": and.push({ optionType: "PUT", structure: "SINGLE" }); break;
    case "spreads": and.push({ structure: "SPREAD" }); break;
    case "butterflies": and.push({ structure: "BUTTERFLY" }); break;
    case "strangles": and.push({ structure: "STRANGLE" }); break;
    case "put-sells": and.push({ structure: "PUT_SELL" }); break;
    case "stock": and.push({ assetType: "STOCK" }); break;
  }
  if (f.result === "win") and.push({ returnPct: { gt: 0 } });
  if (f.result === "loss") and.push({ returnPct: { lte: 0 } });
  if (f.openedFrom) and.push({ openDate: { gte: day(f.openedFrom) } });
  if (f.openedTo) and.push({ openDate: { lte: day(f.openedTo) } });
  if (f.closedFrom) and.push({ closeDate: { gte: day(f.closedFrom) } });
  if (f.closedTo) and.push({ closeDate: { lte: day(f.closedTo) } });
  if (f.airtable === "missing") and.push({ airtableId: null });
  if (f.airtable === "matched") and.push({ airtableId: { not: null } });
  return { AND: and };
}

function orderBy(f: TradeFilters): Prisma.TrTradeOrderByWithRelationInput[] {
  const dir = f.dir ?? (f.sort === "symbol" ? "asc" : "desc");
  const nulls = { sort: dir, nulls: "last" } as const;
  switch (f.sort) {
    case "opened": return [{ openDate: dir }, { id: "asc" }];
    case "return": return [{ returnPct: nulls }, { id: "asc" }];
    case "days": return [{ holdDays: nulls }, { id: "asc" }];
    case "spx": return [{ spxReturnPct: nulls }, { id: "asc" }];
    case "symbol": return [{ underlying: dir }, { closeDate: "desc" }, { id: "asc" }];
    default: return [{ closeDate: nulls }, { openDate: dir }, { id: "asc" }];
  }
}

export const PAGE_SIZE = 50;

const ROW_SELECT = {
  id: true, name: true, symbol: true, underlying: true, portfolio: true, guru: true,
  assetType: true, structure: true, optionType: true, side: true, status: true,
  openDate: true, closeDate: true, entryPrice: true, exitPrice: true, returnPct: true,
  premiumCapture: true, holdDays: true, airtableId: true, spxReturnPct: true, notes: true,
  sheetTab: true, sheetRow: true, currentPrice: true,
} as const;

/** Open positions (from Airtable), newest first unless a column is chosen. */
export function listOpen(code: string, sort?: string, dir?: "asc" | "desc") {
  const f: TradeFilters = { sort: sort && SORTS.some((s) => s.value === sort) && sort !== "closed" ? sort : "opened", dir };
  return prisma.trTrade.findMany({
    where: { serviceCode: code, status: "OPEN" },
    orderBy: orderBy(f),
    select: ROW_SELECT,
  });
}

export type TradeRow = Awaited<ReturnType<typeof listTrades>>["rows"][number];

export async function listTrades(code: string, f: TradeFilters) {
  const w = where(code, f);
  const page = f.page ?? 1;
  const [rows, total, agg] = await Promise.all([
    prisma.trTrade.findMany({
      where: w,
      orderBy: orderBy(f),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: ROW_SELECT,
    }),
    prisma.trTrade.count({ where: w }),
    prisma.trTrade.findMany({
      where: w,
      select: { returnPct: true, weight: true, holdDays: true, openDate: true, closeDate: true, closeAfterBell: true, status: true, name: true, symbol: true },
    }),
  ]);
  // The summary line above the table describes exactly the filtered set.
  const filtered = computeStats(
    agg.map((r) => ({ ...r, openDate: ymd(r.openDate)!, closeDate: ymd(r.closeDate) })),
  );
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), filtered };
}

export async function syncStatus() {
  return prisma.trService.findMany({
    select: { code: true, lastSyncedAt: true, lastSyncOk: true, lastSyncMessage: true, lastSyncIssues: true },
  });
}

export async function airtableMissingCounts(): Promise<Record<string, number>> {
  const rows = await prisma.trTrade.groupBy({ by: ["serviceCode"], where: { airtableId: null }, _count: true });
  return Object.fromEntries(rows.map((r) => [r.serviceCode, r._count]));
}

export const AIRTABLE_BASE_ID = "appnWWpR52p6T38EU";
export const AIRTABLE_POSITIONS_TABLE = "tbldV1JfYJoqZIoMk";
export function airtableUrl(recordId: string): string {
  return `https://airtable.com/${AIRTABLE_BASE_ID}/${AIRTABLE_POSITIONS_TABLE}/${recordId}`;
}
