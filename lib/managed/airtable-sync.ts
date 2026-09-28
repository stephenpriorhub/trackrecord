/**
 * Keep Airtable-sourced positions in step with Airtable's trades.
 *
 * WHY THIS EXISTS
 *   lib/managed/import.ts SEEDS Portfolio Manager once and then skips any
 *   position it already has. So a trade added in Airtable afterwards — a
 *   partial exit, a scale-in, a close — never arrived, and the embeds kept
 *   publishing the position as it stood on import day. The seed also opened
 *   every position at 1 unit and only replayed FULL closes, so a partial exit
 *   could not have been represented even at import time.
 *
 * THE MODEL
 *   Airtable records size as "Weight" per trade: 1 for a whole position, 0.5
 *   for half, 0.25 for a quarter ("Weight: Effective" defaults blanks to 1).
 *   Portfolio Manager stores whole-number quantities, so Airtable weight is
 *   scaled by UNITS_PER_WEIGHT: a position is opened at 100 units and a half
 *   exit sells 50. The embed's Weight column then reads 0.5, exactly Airtable's
 *   figure.
 *
 * SAFETY
 *   - Only positions with source AIRTABLE_IMPORT are touched. Hand-entered
 *     positions are never read against Airtable.
 *   - A position with ANY execution entered in the hub (not by the importer)
 *     is left alone and reported — the sync never overwrites a person's work.
 *   - Replaced fills are SOFT-deleted (deletedAt), never removed, so a rebuild
 *     can be inspected or reversed. Position rows, comments on the position,
 *     guidance prices and ownership are untouched.
 *   - A trade that cannot be matched to a leg, or exits more than was opened,
 *     stops that position and is reported rather than guessed at.
 *   - Dry run by default.
 */
import { prisma } from "../prisma";
import { dec, type D } from "../money";
import { recomputePosition } from "./positions";
import { MAIN_PORTFOLIO_NAME } from "./portfolios";
import {
  commitImport,
  fetchPub,
  fetchTradeGroupNames,
  one,
  isTradableTrade,
  name,
  numOrNull,
  skipReason,
} from "./import";

/** Airtable weight 1 = this many Portfolio Manager units. */
export const UNITS_PER_WEIGHT = 100;

/** Who the importer writes as. Anything else is a person's edit. */
export const IMPORT_ACTOR = "import@oxfordhub.app";

/**
 * Editorial merge decisions for Airtable trade groups, shared with
 * scripts/import-commit.ts so a sync never splits a book the import merged.
 * Confirmed with Stephen 2026-08-22.
 */
export const TRADE_GROUP_MERGES: Record<string, Record<string, string>> = {
  TPU: {
    "Main Stock & Option Portfolio": "Main Portfolio",
    "Monument Trend Advisory Main Portfolio": "Main Portfolio",
  },
  WAR: {
    "Main Stock & Option Portfolio": "Main Portfolio",
  },
};

export interface DesiredFill {
  tradeId: string;
  symbol: string;
  intent: "OPEN" | "CLOSE";
  /** The OPENING direction's side for OPEN, the trade's own side for CLOSE. */
  side: "BUY" | "SELL";
  quantity: number;
  price: D;
  executedAt: Date;
}

export interface LegRef {
  id: string;
  marketTicker: string;
  side: "BUY" | "SELL";
  ratio: number;
}

/** Symbols compared the same way everywhere: letters and digits, no "O:" prefix. */
export function symbolKey(s: string): string {
  return s
    .toUpperCase()
    .replace(/^O:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Airtable trades -> the fills Portfolio Manager should hold. Pure.
 *
 * Skips what the import skips (cash, dividends, no symbol, no price) and
 * anything still "Waiting for Fill?", which has not happened yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Airtable records, as in import.ts
export function desiredFills(trades: any[]): DesiredFill[] {
  const out: DesiredFill[] = [];
  for (const t of trades) {
    const action = (name(t.fields["Action"]) ?? "Buy").toLowerCase();
    // An option that expired worthless is a real exit at $0, but it carries no
    // Trade Price, so the import's tradable-trade test would drop it and leave
    // the contract open forever.
    const expired =
      action === "expire" &&
      !!t.fields["SYMBOL"] &&
      (name(t.fields["To Open or Close"]) ?? "").toLowerCase() === "close";
    if (!expired && !isTradableTrade(t)) continue;
    if (t.fields["Waiting for Fill?"]) continue;
    const intentRaw = (name(t.fields["To Open or Close"]) ?? "").toLowerCase();
    const intent = intentRaw === "close" ? "CLOSE" : intentRaw === "open" ? "OPEN" : null;
    if (!intent) continue;
    const date = t.fields["Trade Date"];
    if (!date) continue;
    const weight =
      numOrNull(t.fields["Weight: Effective"]) ??
      numOrNull(t.fields["Weight"]) ??
      dec(1);
    const quantity = Math.round(weight.abs().times(UNITS_PER_WEIGHT).toNumber());
    if (quantity <= 0) continue;
    out.push({
      tradeId: t.id,
      symbol: String(t.fields["SYMBOL"]),
      intent,
      side: action === "sell" ? "SELL" : "BUY",
      quantity,
      // Airtable may store a credit as a negative price; the side carries direction.
      price: expired ? dec(0) : numOrNull(t.fields["Trade Price"])!.abs(),
      executedAt: new Date(date),
    });
  }
  // Chronological, opens before closes on the same instant, so a replay never
  // exits something before it was bought.
  return out.sort(
    (a, b) =>
      a.executedAt.getTime() - b.executedAt.getTime() ||
      (a.intent === b.intent ? 0 : a.intent === "OPEN" ? -1 : 1),
  );
}

export type PlanOutcome =
  | { kind: "unchanged" }
  | { kind: "rebuild"; fills: (DesiredFill & { legId: string })[] }
  | { kind: "conflict"; reason: string };

/** A fill as it is stored, reduced to what is compared. */
export interface StoredFill {
  legId: string;
  intent: string;
  quantity: number;
  price: string;
  executedAt: Date;
}

function fingerprint(
  fills: { legId: string; intent: string; quantity: number; price: string; executedAt: Date }[],
): string {
  return fills
    .map(
      (f) =>
        `${f.legId}|${f.intent}|${f.quantity}|${dec(f.price).toFixed(6)}|${f.executedAt.toISOString().slice(0, 10)}`,
    )
    .sort()
    .join("\n");
}

/**
 * Decide what to do with one position. Pure: everything it needs is passed in.
 */
export function planPosition(
  legs: LegRef[],
  stored: StoredFill[],
  desired: DesiredFill[],
  humanEdited: boolean,
): PlanOutcome {
  if (humanEdited) {
    return { kind: "conflict", reason: "has trades entered in the hub — left as is" };
  }
  if (desired.length === 0) return { kind: "unchanged" };

  const byKey = new Map(legs.map((l) => [symbolKey(l.marketTicker), l]));
  const mapped: (DesiredFill & { legId: string })[] = [];
  for (const f of desired) {
    const leg = byKey.get(symbolKey(f.symbol));
    if (!leg) {
      return { kind: "conflict", reason: `Airtable trade in ${f.symbol} matches no leg` };
    }
    mapped.push({ ...f, legId: leg.id });
  }

  // Never exit more than is held at any point in time.
  const held = new Map<string, number>();
  for (const f of mapped) {
    const now = held.get(f.legId) ?? 0;
    const next = f.intent === "OPEN" ? now + f.quantity : now - f.quantity;
    if (next < 0) {
      return {
        kind: "conflict",
        reason: `Airtable closes more ${f.symbol} than was opened (by ${f.executedAt.toISOString().slice(0, 10)})`,
      };
    }
    held.set(f.legId, next);
  }
  if (!mapped.some((f) => f.intent === "OPEN")) {
    return { kind: "conflict", reason: "no opening trade in Airtable" };
  }

  const want = fingerprint(
    mapped.map((f) => ({ ...f, price: f.price.toString() })),
  );
  // Compare SHAPE, not scale. Positions imported before this sync were opened
  // at 1 unit rather than 100; if the only difference is that uniform factor,
  // the record is already right and rewriting it would be churn (3,500 War
  // Room positions' worth). A partial exit changes the shape, so it still
  // triggers a rebuild.
  const openOf = (fs: { intent: string; quantity: number }[]) =>
    fs.filter((f) => f.intent === "OPEN").reduce((a, f) => a + f.quantity, 0);
  const storedOpen = openOf(stored);
  const factor = storedOpen > 0 ? openOf(mapped) / storedOpen : 1;
  const scaled = stored.map((f) => ({
    ...f,
    quantity: Math.round(f.quantity * factor),
  }));
  return want === fingerprint(scaled)
    ? { kind: "unchanged" }
    : { kind: "rebuild", fills: mapped };
}

export interface SyncReport {
  pubCode: string;
  dryRun: boolean;
  created: number;
  /** Dry run: Airtable positions not in Portfolio Manager yet, and where they would go. */
  toCreate: { position: string; portfolio: string; newPortfolio: boolean; publicPortfolio: boolean; trades: string }[];
  rebuilt: { position: string; before: string; after: string }[];
  unchanged: number;
  conflicts: { position: string; reason: string }[];
  errors: { position: string; message: string }[];
}

function describe(fills: { intent: string; quantity: number; price: string | D; executedAt: Date }[]): string {
  return fills
    .slice()
    .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
    .map(
      (f) =>
        `${f.intent === "OPEN" ? "open" : "close"} ${Number((f.quantity / UNITS_PER_WEIGHT).toFixed(4))} @ ${dec(f.price.toString()).toFixed(2)} ${f.executedAt.toISOString().slice(0, 10)}`,
    )
    .join("; ");
}

/**
 * Bring one publication's Airtable-sourced positions in line with Airtable.
 *
 * New positions are created through the existing import first (so portfolio
 * routing and trade-group merges stay in one place), then every Airtable
 * position's fills are compared and rebuilt where they differ.
 */
export async function syncPublicationFromAirtable(
  pubCode: string,
  opts: { dryRun?: boolean } = {},
): Promise<SyncReport> {
  const dryRun = opts.dryRun ?? true;
  const report: SyncReport = {
    pubCode,
    dryRun,
    created: 0,
    toCreate: [],
    rebuilt: [],
    unchanged: 0,
    conflicts: [],
    errors: [],
  };

  // Only publications whose books already came from Airtable. The sheet-fed
  // ones (DPL, PSU, NBS) keep a partial open book in Airtable, and importing it
  // would duplicate positions their sheets supplied.
  const fed = await prisma.managedPosition.count({
    where: {
      source: "AIRTABLE_IMPORT",
      deletedAt: null,
      portfolio: { service: { pubCode } },
    },
  });
  if (fed === 0) {
    throw new Error(`${pubCode} is not maintained from Airtable; nothing synced.`);
  }

  if (!dryRun) {
    const imported = await commitImport(pubCode, {
      rename: TRADE_GROUP_MERGES[pubCode.toUpperCase()],
      actorEmail: IMPORT_ACTOR,
    });
    report.created = imported.positionsCreated;
    for (const e of imported.errors) report.errors.push(e);
  }

  const [{ positions, tradesByPosition }, groups] = await Promise.all([
    fetchPub(pubCode),
    fetchTradeGroupNames(),
  ]);
  const rename = TRADE_GROUP_MERGES[pubCode.toUpperCase()] ?? {};
  const portfolios = await prisma.managedPortfolio.findMany({
    where: { service: { pubCode }, archivedAt: null },
    select: { name: true, visibility: true },
  });

  for (const pos of positions) {
    const label = String(pos.fields["Position Name"] ?? pos.id);
    const trades = tradesByPosition.get(pos.id) ?? [];
    if (skipReason(pos, trades)) continue;

    const managed = await prisma.managedPosition.findUnique({
      where: { airtableId: pos.id },
      include: {
        legs: { orderBy: { legIndex: "asc" } },
        executions: {
          where: { deletedAt: null },
          include: { fills: { where: { deletedAt: null } } },
        },
      },
    });
    if (!managed) {
      // Only reachable on a dry run (apply imports first). Say where it would
      // land, because a NEW portfolio starts private and would not appear on
      // any embed until someone publishes it.
      if (dryRun) {
        const gid = one(pos.fields["Trade Group"]) ?? null;
        const raw = (gid && groups.get(gid)?.name) || MAIN_PORTFOLIO_NAME;
        const target = rename[raw] ?? raw;
        const existing = portfolios.find((p) => p.name === target);
        report.toCreate.push({
          position: label,
          portfolio: target,
          newPortfolio: !existing,
          publicPortfolio: existing?.visibility === "PUBLIC",
          trades: describe(desiredFills(trades)),
        });
      }
      continue;
    }
    if (managed.deletedAt) continue;
    if (managed.source !== "AIRTABLE_IMPORT") continue;

    const stored: StoredFill[] = managed.executions.flatMap((e) =>
      e.fills.map((f) => ({
        legId: f.legId,
        intent: f.intent,
        quantity: f.quantity,
        price: f.price.toString(),
        executedAt: f.executedAt,
      })),
    );
    const humanEdited = managed.executions.some(
      (e) => e.createdByEmail !== null && e.createdByEmail !== IMPORT_ACTOR,
    );

    const plan = planPosition(
      managed.legs.map((l) => ({
        id: l.id,
        marketTicker: l.marketTicker,
        side: l.side,
        ratio: l.ratio,
      })),
      stored,
      desiredFills(trades),
      humanEdited,
    );

    if (plan.kind === "unchanged") {
      report.unchanged += 1;
      continue;
    }
    if (plan.kind === "conflict") {
      report.conflicts.push({ position: label, reason: plan.reason });
      continue;
    }

    report.rebuilt.push({
      position: label,
      before: describe(stored),
      after: describe(plan.fills.map((f) => ({ ...f, price: f.price }))),
    });
    if (dryRun) continue;

    try {
      await rebuildFills(managed.id, managed.legs, plan.fills);
    } catch (err) {
      report.errors.push({
        position: label,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

/** Soft-delete the old fills and write Airtable's, one execution per trade instant. */
async function rebuildFills(
  positionId: string,
  legs: { id: string; side: "BUY" | "SELL"; ratio: number; multiplier: number }[],
  fills: (DesiredFill & { legId: string })[],
) {
  const legById = new Map(legs.map((l) => [l.id, l]));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.managedFill.updateMany({
      where: { positionId, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.managedExecution.updateMany({
      where: { positionId, deletedAt: null },
      data: { deletedAt: now },
    });

    // Legs of one spread trade share an instant, so they become one execution.
    const groups = new Map<string, (DesiredFill & { legId: string })[]>();
    for (const f of fills) {
      const key = `${f.intent}|${f.executedAt.toISOString()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f);
    }

    for (const group of groups.values()) {
      const first = group[0];
      const firstLeg = legById.get(first.legId)!;
      const execution = await tx.managedExecution.create({
        data: {
          positionId,
          intent: first.intent,
          units:
            first.intent === "OPEN"
              ? Math.max(1, Math.round(first.quantity / Math.max(1, firstLeg.ratio)))
              : null,
          executedAt: first.executedAt,
          note: `Airtable ${group.map((g) => g.tradeId).join(", ")}`,
          createdByEmail: IMPORT_ACTOR,
        },
      });
      for (const f of group) {
        const leg = legById.get(f.legId)!;
        // An exit reverses the leg's opening direction, whatever Airtable's
        // Action says, so a close can never be booked as a second entry.
        const side =
          f.intent === "OPEN" ? leg.side : leg.side === "BUY" ? "SELL" : "BUY";
        const gross = f.price.times(f.quantity).times(leg.multiplier);
        await tx.managedFill.create({
          data: {
            executionId: execution.id,
            legId: leg.id,
            positionId,
            intent: f.intent,
            side,
            quantity: f.quantity,
            price: f.price.toString(),
            multiplier: leg.multiplier,
            cashFlow: (side === "BUY" ? gross.negated() : gross).toString(),
            executedAt: f.executedAt,
          },
        });
      }
    }
  });

  await recomputePosition(positionId);
}

/** The report, flattened for a page or an API response. */
export function summariseSync(r: SyncReport) {
  return {
    pubCode: r.pubCode,
    dryRun: r.dryRun,
    created: r.created,
    toCreate: r.toCreate,
    rebuilt: r.rebuilt.length,
    unchanged: r.unchanged,
    changes: r.rebuilt,
    conflicts: r.conflicts,
    errors: r.errors,
  };
}
export type SyncSummary = ReturnType<typeof summariseSync>;

/** Stamp "Last pulled" on the publication's Airtable-fed portfolios. */
export async function recordSync(r: SyncReport) {
  const s = summariseSync(r);
  await prisma.managedPortfolio.updateMany({
    where: {
      service: { pubCode: r.pubCode },
      positions: { some: { source: "AIRTABLE_IMPORT" } },
    },
    data: {
      syncedAt: new Date(),
      syncNote: `${s.created} new, ${s.rebuilt} updated, ${s.conflicts.length} need a look`,
    },
  });
}
