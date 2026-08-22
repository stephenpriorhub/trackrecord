/**
 * One-time import of existing positions from the Airtable Portfolio Tracker.
 *
 * This SEEDS Portfolio Manager; it is not a sync. After import the rows are
 * guru-authored like any other, nothing is ever written back to Airtable, and
 * re-running only fills gaps (every row is keyed on its Airtable record id).
 *
 * MAPPING
 *   Airtable Trade Group  ->  ManagedPortfolio
 *   Airtable Position     ->  ManagedPosition (+ one ManagedLeg per symbol)
 *   Airtable Trades       ->  ManagedExecution / ManagedFill
 *
 * A position with no Trade Group goes to "Main Portfolio". Verified against the
 * live base: Trade Group really is the portfolio level in every MTA service —
 * the War Room's are Strangles / Put Sells / Hedges, and the McCall Innovation
 * Report's are themes including "SpaceX Playbook".
 *
 * ALWAYS PLAN BEFORE COMMITTING. planImport() touches nothing and returns what
 * would happen, because the grouping is a judgement call about someone else's
 * data and deserves a human look before 3,500 rows are written.
 */
import { prisma } from "../prisma";
import { airtableFetch, TABLES } from "../airtable";
import { dec, type D } from "../money";
import {
  AIRTABLE_TO_PUB_CODE,
  PUB_NAMES,
  resolvePubCode,
} from "../publications";
import {
  ensureService,
  createPortfolio,
  MAIN_PORTFOLIO_NAME,
} from "./portfolios";
import { createPosition, type LegInput } from "./positions";
import { resolveWarRoomOwner } from "./war-room-owners";
import { guruSlugs, soleEditor } from "./gurus";

/** The Trade Group table. Not in lib/airtable.ts TABLES because only the import needs it. */
const TRADE_GROUP_TABLE = "tbl80YmMPJzACPX7b";

export interface PlannedPortfolio {
  name: string;
  tradeGroupId: string | null;
  positions: number;
  /** Already imported, so a re-run would skip them. */
  alreadyImported: number;
  sortOrder: number | null;
}

export interface ImportPlan {
  pubCode: string;
  serviceName: string;
  airtablePortfolios: string[];
  portfolios: PlannedPortfolio[];
  totalPositions: number;
  skipped: { reason: string; count: number }[];
  warnings: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function one(v: any): any {
  return Array.isArray(v) ? v[0] : v;
}
function name(v: any): string | null {
  const x = one(v);
  if (!x) return null;
  return typeof x === "string" ? x : (x.name ?? null);
}
function numOrNull(v: any): D | null {
  const x = one(v);
  if (x === null || x === undefined || x === "") return null;
  try {
    const d = dec(x);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * A price field, or null. Airtable writes 0 for "no limit set" throughout this
 * base, so a zero must not become a $0.00 stop-loss on a public page.
 */
function positiveOrNull(v: any): D | null {
  const d = numOrNull(v);
  return d && d.gt(0) ? d : null;
}

/** Airtable's Pub Code for a real pub code (MTA for WAR, PMR for PMK). */
function airtableCodeFor(pubCode: string): string {
  const real = resolvePubCode(pubCode);
  return (
    Object.keys(AIRTABLE_TO_PUB_CODE).find(
      (k) => AIRTABLE_TO_PUB_CODE[k] === real,
    ) ?? real
  );
}

async function fetchTradeGroupNames(): Promise<
  Map<string, { name: string; sort: number | null }>
> {
  const rows = await airtableFetch(TRADE_GROUP_TABLE, {});
  const map = new Map<string, { name: string; sort: number | null }>();
  for (const r of rows) {
    const n = r.fields["Trade Group"];
    if (typeof n === "string" && n.trim()) {
      map.set(r.id, {
        name: n.trim(),
        sort:
          typeof r.fields["Sort Order"] === "number"
            ? r.fields["Sort Order"]
            : null,
      });
    }
  }
  return map;
}

/** Every Airtable position belonging to a publication, with its trades attached. */
async function fetchPub(pubCode: string) {
  const airtableCode = airtableCodeFor(pubCode);

  const portfolios = await airtableFetch(TABLES.portfolios, {
    filterByFormula: `{Pub Code} = "${airtableCode}"`,
  });
  const portfolioNames = portfolios
    .map((p: any) => p.fields["Portfolio Name"])
    .filter((n: any): n is string => typeof n === "string" && !!n);

  const positions: any[] = [];
  const trades: any[] = [];
  for (const pName of portfolioNames) {
    positions.push(
      ...(await airtableFetch(TABLES.positions, {
        filterByFormula: `FIND("${pName}", ARRAYJOIN({Portfolio Name (from Portfolio)}))`,
      })),
    );
    trades.push(
      ...(await airtableFetch(TABLES.trades, {
        filterByFormula: `FIND("${pName}", ARRAYJOIN({Portfolio (from Parent Position)}))`,
      })),
    );
  }

  const tradesByPosition = new Map<string, any[]>();
  for (const t of trades) {
    for (const link of (t.fields["Parent Position"] ?? []) as any[]) {
      const id = typeof link === "object" ? link.id : link;
      if (!id) continue;
      if (!tradesByPosition.has(id)) tradesByPosition.set(id, []);
      tradesByPosition.get(id)!.push(t);
    }
  }

  return { portfolioNames, positions, tradesByPosition };
}

export async function planImport(pubCode: string): Promise<ImportPlan> {
  const real = resolvePubCode(pubCode);
  const [groups, { portfolioNames, positions, tradesByPosition }] =
    await Promise.all([fetchTradeGroupNames(), fetchPub(real)]);

  const existing = new Set(
    (
      await prisma.managedPosition.findMany({
        where: { airtableId: { not: null } },
        select: { airtableId: true },
      })
    ).map((p) => p.airtableId!),
  );

  const buckets = new Map<string, PlannedPortfolio>();
  const skipped = new Map<string, number>();
  const warnings: string[] = [];

  for (const pos of positions) {
    const tradeLinks = tradesByPosition.get(pos.id) ?? [];
    const reason = skipReason(pos, tradeLinks);
    if (reason) {
      skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      continue;
    }

    const gid = one(pos.fields["Trade Group"]) ?? null;
    const g = gid ? groups.get(gid) : null;
    const bucketName = g?.name ?? MAIN_PORTFOLIO_NAME;
    const key = `${bucketName}::${gid ?? ""}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        name: bucketName,
        tradeGroupId: g ? gid : null,
        positions: 0,
        alreadyImported: 0,
        sortOrder: g?.sort ?? null,
      });
    }
    const b = buckets.get(key)!;
    b.positions += 1;
    if (existing.has(pos.id)) b.alreadyImported += 1;
  }

  const list = [...buckets.values()].sort(
    (a, b) =>
      (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) ||
      b.positions - a.positions,
  );

  if (list.length > 20) {
    warnings.push(
      `${list.length} portfolios would be created. If Trade Group is being used for something other than portfolios in this service, merge or drop them before committing.`,
    );
  }
  if (portfolioNames.length === 0) {
    warnings.push(
      `No Airtable portfolio carries Pub Code "${airtableCodeFor(real)}".`,
    );
  }

  return {
    pubCode: real,
    serviceName: PUB_NAMES[real] ?? real,
    airtablePortfolios: portfolioNames,
    portfolios: list,
    totalPositions: list.reduce((n, b) => n + b.positions, 0),
    skipped: [...skipped.entries()].map(([reason, count]) => ({
      reason,
      count,
    })),
    warnings,
  };
}

/**
 * Is this trade an actual position leg?
 *
 * Airtable attaches dividend and cash rows to the same position — a stock
 * recommendation routinely shows Investment Type ["Stock","Cash","Cash"]. Those
 * are not legs, and importing them invents positions in a security called Cash.
 */
function isTradableTrade(t: any): boolean {
  const type = (name(t.fields["Investment Type"]) ?? "").toLowerCase();
  if (type === "cash" || type === "dividend") return false;
  if (!t.fields["SYMBOL"]) return false;
  return positiveOrNull(t.fields["Trade Price"]) !== null;
}

/**
 * Why a position could not be imported. Separated because "no trades" and "no
 * entry price" call for completely different responses: the first is a data
 * shape this importer does not handle, the second is an incomplete record in
 * Airtable that somebody has to fill in.
 *
 * A position with no entry price is SKIPPED rather than imported at zero. Some
 * recently-added Profit Surge Trader and Daily Profits Live positions have a
 * current price but no open price anywhere — not on the trade, not on the
 * position — and importing those would publish a fabricated return.
 */
function skipReason(pos: any, trades: any[]): string | null {
  if (!pos.fields["Open Date"]) return "no open date";

  const real = trades.filter((t) => {
    const type = (name(t.fields["Investment Type"]) ?? "").toLowerCase();
    return type !== "cash" && type !== "dividend" && !!t.fields["SYMBOL"];
  });
  if (real.length === 0) return "no stock or option trades";

  if (real.every((t) => positiveOrNull(t.fields["Trade Price"]) === null)) {
    return "no entry price recorded in Airtable";
  }
  return null;
}

export interface CommitOptions {
  /** Portfolio names to import. Omit for every one in the plan. */
  onlyPortfolios?: string[];
  /** Rename or merge on the way in: Airtable group name -> target portfolio name. */
  rename?: Record<string, string>;
  /** Cap the number of positions written, for a cautious first pass. */
  limit?: number;
  actorEmail?: string | null;
}

export interface CommitReport {
  pubCode: string;
  portfoliosCreated: string[];
  positionsCreated: number;
  positionsSkipped: number;
  errors: { position: string; message: string }[];
}

export async function commitImport(
  pubCode: string,
  opts: CommitOptions = {},
): Promise<CommitReport> {
  const real = resolvePubCode(pubCode);
  const report: CommitReport = {
    pubCode: real,
    portfoliosCreated: [],
    positionsCreated: 0,
    positionsSkipped: 0,
    errors: [],
  };

  const [groups, { positions, tradesByPosition }] = await Promise.all([
    fetchTradeGroupNames(),
    fetchPub(real),
  ]);

  const service = await ensureService(real);
  const portfolioByName = new Map<string, string>();

  for (const pos of positions) {
    if (opts.limit && report.positionsCreated >= opts.limit) break;

    // Idempotent on the Airtable record id, so a re-run tops up rather than
    // duplicating — which matters when a first pass was capped by `limit`.
    const already = await prisma.managedPosition.findUnique({
      where: { airtableId: pos.id },
      select: { id: true },
    });
    if (already) {
      report.positionsSkipped += 1;
      continue;
    }

    const tradeLinks = tradesByPosition.get(pos.id) ?? [];
    // Same rule as the plan, so a dry run and a commit never disagree about
    // what is importable.
    if (skipReason(pos, tradeLinks)) {
      report.positionsSkipped += 1;
      continue;
    }
    const tradable = tradeLinks.filter(isTradableTrade);

    const gid = one(pos.fields["Trade Group"]) ?? null;
    const g = gid ? groups.get(gid) : null;
    const rawName = g?.name ?? MAIN_PORTFOLIO_NAME;
    const target = opts.rename?.[rawName] ?? rawName;

    if (opts.onlyPortfolios && !opts.onlyPortfolios.includes(rawName)) {
      report.positionsSkipped += 1;
      continue;
    }

    let portfolioId = portfolioByName.get(target);
    if (!portfolioId) {
      const created = await createPortfolio({
        serviceId: service.id,
        name: target,
        // Only tag the portfolio with its Trade Group when nothing was merged
        // into it, so the marker keeps meaning "this one group".
        airtableTradeGroupId: target === rawName ? gid : null,
        createdByEmail: opts.actorEmail ?? null,
      });
      portfolioId = created.id;
      portfolioByName.set(target, portfolioId);
      report.portfoliosCreated.push(target);
    }

    try {
      await importOnePosition(
        pos,
        tradable,
        portfolioId,
        opts.actorEmail ?? null,
        real,
      );
      report.positionsCreated += 1;
    } catch (err) {
      report.errors.push({
        position: String(pos.fields["Position Name"] ?? pos.id),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

/**
 * Rebuild one Airtable position as a managed one.
 *
 * Only the OPENING trades become legs; closing trades are replayed afterwards by
 * the normal close path, so an imported position ends up in exactly the state a
 * guru would have produced by hand.
 */
async function importOnePosition(
  pos: any,
  trades: any[],
  portfolioId: string,
  actorEmail: string | null,
  pubCode: string,
) {
  const opens = trades.filter(
    (t) =>
      (name(t.fields["To Open or Close"]) ?? "Open").toLowerCase() === "open",
  );
  if (opens.length === 0) throw new Error("no opening trade");

  // One leg per distinct symbol, using its earliest opening trade for the price.
  const bySymbol = new Map<string, any>();
  for (const t of opens) {
    const sym = String(t.fields["SYMBOL"]).trim().toUpperCase();
    const prev = bySymbol.get(sym);
    const date = t.fields["Trade Date"]
      ? Date.parse(t.fields["Trade Date"])
      : 0;
    const prevDate = prev?.fields["Trade Date"]
      ? Date.parse(prev.fields["Trade Date"])
      : Infinity;
    if (!prev || date < prevDate) bySymbol.set(sym, t);
  }

  const legs: LegInput[] = [];
  for (const [sym, t] of bySymbol) {
    const price = numOrNull(t.fields["Trade Price"]);
    if (!price) continue;
    const isOption = /^[A-Z]+\d{6}[CP]\d{6,8}$/.test(
      sym.replace(/[^A-Z0-9]/g, ""),
    );
    const side =
      (name(t.fields["Action"]) ?? "Buy").toLowerCase() === "sell"
        ? "SELL"
        : "BUY";

    if (isOption) {
      const m = sym
        .replace(/[^A-Z0-9]/g, "")
        .match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{6,8})$/);
      if (!m) continue;
      legs.push({
        kind: "OPTION",
        side,
        // An opening SELL is a credit in Airtable and may be stored negative;
        // the leg's own side already carries the direction.
        price: price.abs(),
        expiry: `20${m[2]}-${m[3]}-${m[4]}`,
        strike: dec(parseInt(m[6], 10)).div(1000),
        right: m[5] === "C" ? "CALL" : "PUT",
      });
    } else {
      legs.push({ kind: "STOCK", side, price: price.abs() });
    }
  }
  if (legs.length === 0) throw new Error("no usable opening leg");

  const openedAt = new Date(pos.fields["Open Date"]);
  const created = await createPosition({
    portfolioId,
    underlying: underlyingFor(pos, bySymbol),
    companyName: (pos.fields["Position Name"] as string) ?? null,
    openedAt,
    legs,
    // The guidance columns the embed shows. Airtable names them differently:
    // "Limit to Open" is the buy-up-to price, and the stop is "Close Below" for
    // a long (falling through it exits) with the trailing stop as a fallback.
    // Zero means "not set" in this base, not "a stop at zero".
    buyUpToPrice: positiveOrNull(pos.fields["Limit to Open"]),
    stopLossPrice:
      positiveOrNull(pos.fields["Close Below"]) ??
      positiveOrNull(pos.fields["Trailing Stop Price"]),
    targetPrice: positiveOrNull(pos.fields["Close Above"]),
    source: "AIRTABLE_IMPORT",
    airtableId: pos.id,
    actorEmail,
    guruSlug: resolveOwner(pos, pubCode, bySymbol),
  });

  // Replay the exit, if there was one, through the normal close path so the
  // cached figures are computed the same way as a hand-entered close.
  const closes = trades.filter(
    (t) => (name(t.fields["To Open or Close"]) ?? "").toLowerCase() === "close",
  );
  if (closes.length > 0 && pos.fields["Close Date"]) {
    const { closePosition } = await import("./positions");
    const dbLegs = await prisma.managedLeg.findMany({
      where: { positionId: created.id },
      orderBy: { legIndex: "asc" },
    });
    const prices: Record<string, D> = {};
    for (const leg of dbLegs) {
      const match = closes.find(
        (t) =>
          String(t.fields["SYMBOL"])
            .replace(/[^A-Z0-9]/g, "")
            .toUpperCase() ===
          leg.marketTicker.replace(/[^A-Z0-9]/g, "").replace(/^O/, ""),
      );
      const p = numOrNull(match?.fields["Trade Price"]);
      if (p) prices[leg.id] = p.abs();
    }
    if (Object.keys(prices).length > 0) {
      await closePosition({
        positionId: created.id,
        executedAt: new Date(pos.fields["Close Date"]),
        prices,
        actorEmail,
      });
    }
  }

  return created;
}

/**
 * Who made this pick.
 *
 * Airtable's per-trade PERSON, rolled up onto the position as "Position Guru(s)",
 * is the base's own record and comes first. Note this is NOT "Reporting Guru(s)",
 * which is a formula that falls back to the portfolio's editor list and so
 * reports "Bryan, Karim" for anything unattributed — the exact false pairing this
 * app exists to avoid.
 *
 * For the War Room the verified workbook then fills Airtable's blanks, through
 * the same shared module the sync uses.
 */
function resolveOwner(
  pos: any,
  pubCode: string,
  bySymbol: Map<string, any>,
): string | null {
  // Airtable's per-trade PERSON, rolled up onto the position. NOT
  // "Reporting Guru(s)", which falls back to the portfolio's editor list and so
  // reports both editors for anything unattributed — the false pairing this app
  // exists to avoid.
  const named = guruSlugs(pos.fields["Position Guru(s)"]);

  if (pubCode === "WAR") {
    const symbols = [...bySymbol.keys()];
    const openDate = pos.fields["Open Date"]
      ? new Date(pos.fields["Open Date"])
      : null;
    return resolveWarRoomOwner(symbols, openDate, named);
  }
  // Elsewhere an ambiguous rollup is left unattributed rather than guessed.
  return named.length === 1 ? named[0] : null;
}

/**
 * The underlying ticker. Airtable's "Associated Symbols String" is a
 * comma-joined list whose first entry is the plain symbol for a stock position;
 * for an options position it is a contract, so the root is taken from the OCC
 * symbol instead.
 */
function underlyingFor(pos: any, bySymbol: Map<string, any>): string {
  const listed = String(pos.fields["Associated Symbols String"] ?? "")
    .split(",")[0]
    .replace(/[^A-Za-z0-9.]/g, "")
    .toUpperCase();
  const root = (sym: string) => {
    const clean = sym.replace(/[^A-Z0-9]/g, "");
    const m = clean.match(/^([A-Z]+)\d{6}[CP]\d{6,8}$/);
    return m ? m[1] : clean;
  };
  const fromList = listed ? root(listed) : "";
  if (fromList) return fromList;
  return root([...bySymbol.keys()][0] ?? "");
}
