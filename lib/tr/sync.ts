/**
 * Sheet -> database sync for Track Record v2.
 *
 * For each sheet-fed service: download the sheet, parse every trade, attach
 * its Airtable position (if any) and its S&P 500 comparison, then REPLACE the
 * service's stored trades in one transaction. The sheet is the record, so a
 * row deleted or corrected there is deleted or corrected here on the next run.
 *
 * One run at a time per process; a second request while one is running gets
 * the running one's promise.
 */
import { prisma } from "../prisma";
import { loadBenchmarkSeries, type BenchmarkSeries } from "../managed/benchmark";
import { SHEET_SERVICES, serviceByCode } from "./services";
import { parseService } from "./sheets/parse";
import type { ParsedTrade } from "./sheets/types";
import { parseSheetOcc } from "./sheets/types";
import { fetchSheetXlsx, readWorkbook } from "./sheets/workbook";

export const BENCHMARK = "SPY";

export interface SyncReport {
  code: string;
  ok: boolean;
  trades: number;
  airtableMatched: number;
  message: string;
  ms: number;
}

// ---- keys -------------------------------------------------------------------

function sourceKeys(trades: ParsedTrade[]): string[] {
  const seen = new Map<string, number>();
  return trades.map((t) => {
    const base = [t.serviceCode, t.tab, t.symbol, t.openDate, t.closeDate ?? "", t.returnPct?.toFixed(6) ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

// ---- Airtable matching ----------------------------------------------------

/** A contract in a form both Airtable and the sheets reduce to. */
function contractKey(sym: string): string | null {
  const o = parseSheetOcc(sym);
  return o ? `${o.underlying}|${o.expiry}|${o.right}|${o.strike}` : null;
}

interface MirrorPos {
  airtableId: string;
  underlyings: Set<string>;
  contracts: Set<string>;
  open: number | null;
  close: number | null;
}

const DAY = 86_400_000;

async function loadMirror(pubCode: string): Promise<MirrorPos[]> {
  const rows = await prisma.position.findMany({
    where: { portfolio: { pubCode } },
    select: { airtableId: true, symbols: true, openDate: true, closeDate: true, name: true },
  });
  return rows.map((p) => {
    const contracts = new Set<string>();
    const underlyings = new Set<string>();
    for (const s of p.symbols) {
      for (const part of s.split(/[,\s]+/).filter(Boolean)) {
        const k = contractKey(part);
        if (k) {
          contracts.add(k);
          underlyings.add(k.split("|")[0]);
        } else underlyings.add(part.toUpperCase());
      }
    }
    const first = p.name.trim().split(/\s+/)[0]?.toUpperCase();
    if (first && /^[A-Z.]{1,6}$/.test(first)) underlyings.add(first);
    return {
      airtableId: p.airtableId,
      contracts,
      underlyings,
      open: p.openDate ? Date.UTC(p.openDate.getUTCFullYear(), p.openDate.getUTCMonth(), p.openDate.getUTCDate()) : null,
      close: p.closeDate ? Date.UTC(p.closeDate.getUTCFullYear(), p.closeDate.getUTCMonth(), p.closeDate.getUTCDate()) : null,
    };
  });
}

/**
 * The Airtable position for a sheet trade: same contract opened within 3
 * days, else same underlying opened within 1 day. Closest open date wins;
 * a matching close date breaks ties. No match = flagged in the UI.
 */
function matchAirtable(t: ParsedTrade, byUnderlying: Map<string, MirrorPos[]>): string | null {
  const cands = byUnderlying.get(t.underlying) ?? [];
  if (!cands.length) return null;
  const open = Date.parse(t.openDate);
  const close = t.closeDate ? Date.parse(t.closeDate) : null;
  const legs = t.symbol.split(/[,\s]+/).map(contractKey).filter((k): k is string => !!k);

  let best: { id: string; score: number } | null = null;
  for (const p of cands) {
    if (p.open === null) continue;
    const dOpen = Math.abs(p.open - open) / DAY;
    const sameContract = legs.length > 0 && legs.some((k) => p.contracts.has(k));
    if (sameContract ? dOpen > 3 : dOpen > 1) continue;
    const dClose = close !== null && p.close !== null ? Math.abs(p.close - close) / DAY : 5;
    const score = (sameContract ? 0 : 10) + dOpen + Math.min(dClose, 5) / 10;
    if (!best || score < best.score) best = { id: p.airtableId, score };
  }
  return best?.id ?? null;
}

// ---- S&P 500 ------------------------------------------------------------------

export interface Dividend {
  exDate: string;
  amount: number;
}

/**
 * SPY's cash dividends since `from`. A buy-and-hold investor collects these, and
 * price alone drops by each one on its ex-date — a price-only comparison
 * understated the S&P by ~0.3% for every quarter a trade was held.
 */
async function loadDividends(ticker: string, from: string): Promise<Dividend[]> {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return [];
  const base = (process.env.MASSIVE_BASE ?? "https://api.massive.com").replace(/\/+$/, "");
  const out: Dividend[] = [];
  let url: string | null =
    `${base}/v3/reference/dividends?ticker=${ticker}&ex_dividend_date.gte=${from}&order=asc&sort=ex_dividend_date&limit=1000`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return out;
    const body = (await res.json()) as {
      results?: { ex_dividend_date?: string; cash_amount?: number }[];
      next_url?: string;
    };
    for (const r of body.results ?? []) {
      if (r.ex_dividend_date && typeof r.cash_amount === "number") {
        out.push({ exDate: r.ex_dividend_date, amount: r.cash_amount });
      }
    }
    url = body.next_url ?? null;
  }
  return out;
}

/**
 * What buying the S&P 500 (SPY) at the close on the open date and selling at
 * the close on the close date returned, dividends included: (end close +
 * dividends with an ex-date inside the hold) / start close - 1. An open trade
 * is measured to the latest close.
 */
export function spxReturn(
  series: BenchmarkSeries,
  dividends: Dividend[],
  open: string,
  close: string | null,
): number | null {
  const a = series.on(new Date(`${open}T00:00:00Z`));
  const b = close ? series.on(new Date(`${close}T00:00:00Z`)) : series.latest();
  if (!a || !b || a.isZero()) return null;
  const end = close ?? "9999-12-31";
  const divs = dividends
    .filter((d) => d.exDate > open && d.exDate <= end)
    .reduce((sum, d) => sum + d.amount, 0);
  return b.plus(divs).div(a).minus(1).toNumber();
}

// ---- sync -------------------------------------------------------------------

async function syncOne(code: string, spy: BenchmarkSeries | null, dividends: Dividend[]): Promise<SyncReport> {
  const started = Date.now();
  const def = serviceByCode(code);
  if (!def?.sheetId) throw new Error(`${code} has no sheet`);

  try {
    const wb = await readWorkbook(await fetchSheetXlsx(def.sheetId));
    const res = parseService(code, wb);
    if (res.trades.length === 0) {
      // An empty parse of a sheet that has history is a broken read (a tab
      // renamed, the sheet blanked), never "this service has no trades".
      // Keep the last good copy.
      throw new Error("The sheet parsed to zero trades; keeping the previous copy.");
    }

    const mirror = await loadMirror(code);
    const byUnderlying = new Map<string, MirrorPos[]>();
    for (const p of mirror) for (const u of p.underlyings) {
      if (!byUnderlying.has(u)) byUnderlying.set(u, []);
      byUnderlying.get(u)!.push(p);
    }

    const keys = sourceKeys(res.trades);
    let matched = 0;
    const data = res.trades.map((t, i) => {
      const airtableId = matchAirtable(t, byUnderlying);
      if (airtableId) matched++;
      return {
        serviceCode: code,
        sourceKey: keys[i],
        sheetTab: t.tab,
        sheetRow: t.row,
        portfolio: t.portfolio,
        guru: t.guru,
        name: t.name,
        symbol: t.symbol,
        underlying: t.underlying,
        assetType: t.assetType,
        structure: t.structure,
        optionType: t.optionType,
        strike: t.strike,
        expiry: t.expiry ? new Date(`${t.expiry}T00:00:00Z`) : null,
        side: t.side,
        status: t.status,
        openDate: new Date(`${t.openDate}T00:00:00Z`),
        closeDate: t.closeDate ? new Date(`${t.closeDate}T00:00:00Z`) : null,
        closeAfterBell: t.closeAfterBell,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        returnPct: t.returnPct,
        weight: t.weight,
        premiumCapture: t.premiumCapture,
        holdDays: t.holdDays === null ? null : Math.round(t.holdDays),
        notes: t.notes,
        airtableId,
        spxReturnPct: spy ? spxReturn(spy, dividends, t.openDate, t.closeDate) : null,
      };
    });

    const issues = {
      skipped: res.skipped,
      crossLabelled: res.crossLabelled ?? [],
      pending: res.pending ?? [],
    };
    const message =
      `${data.length} trades` +
      (issues.pending.length ? `; ${issues.pending.length} not yet in Since Inception` : "") +
      (issues.skipped.length ? `; ${issues.skipped.length} rows skipped` : "") +
      (issues.crossLabelled.length ? `; ${issues.crossLabelled.length} labelled as another service` : "");

    await prisma.$transaction(
      async (tx) => {
        await tx.trTrade.deleteMany({ where: { serviceCode: code } });
        await tx.trTrade.createMany({ data });
        await tx.trService.upsert({
          where: { code },
          create: { code, lastSyncedAt: new Date(), lastSyncOk: true, lastSyncMessage: message, lastSyncIssues: issues },
          update: { lastSyncedAt: new Date(), lastSyncOk: true, lastSyncMessage: message, lastSyncIssues: issues },
        });
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    return { code, ok: true, trades: data.length, airtableMatched: matched, message, ms: Date.now() - started };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Record the failure but leave the stored trades alone.
    await prisma.trService.upsert({
      where: { code },
      create: { code, lastSyncedAt: new Date(), lastSyncOk: false, lastSyncMessage: message },
      update: { lastSyncedAt: new Date(), lastSyncOk: false, lastSyncMessage: message },
    });
    return { code, ok: false, trades: 0, airtableMatched: 0, message, ms: Date.now() - started };
  }
}

let running: Promise<SyncReport[]> | null = null;

export function syncSheets(codes?: string[]): Promise<SyncReport[]> {
  if (running) return running;
  running = (async () => {
    const targets = SHEET_SERVICES.filter((s) => !codes?.length || codes.includes(s.code));
    // The War Room's history starts in 2019; one bulk request warms it all.
    const spy = await loadBenchmarkSeries(BENCHMARK, new Date("2019-01-01T00:00:00Z")).catch(() => null);
    const dividends = await loadDividends(BENCHMARK, "2019-01-01").catch(() => []);
    const out: SyncReport[] = [];
    for (const s of targets) out.push(await syncOne(s.code, spy && spy.count > 0 ? spy : null, dividends));
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}
