/**
 * Writing positions: create, scale in, close (fully or partly), recompute.
 *
 * SHAPE OF A POSITION
 *   A position has one leg per instrument. A stock recommendation has one leg; a
 *   vertical spread has two. Every entry and exit is an Execution holding one
 *   Fill per leg it touched. So "multiple entries and exits" needs no special
 *   case — it is just more Executions, and lib/pnl.ts reduces the fills into
 *   weighted-average entry, weighted-average exit and realized P&L.
 *
 * QUANTITY IS NOTIONAL, NOT SHARES
 *   These are model portfolios: the published figure is a percentage return per
 *   recommendation, not a dollar P&L on a real account. So a leg's quantity
 *   defaults to 1 "unit" and returns are price-based — (exit - entry) / entry —
 *   which is exactly what the embed shows. A guru is never asked how many shares
 *   to buy, because the answer would be fictional.
 *
 * ONE RULE INHERITED FROM lib/pnl.ts
 *   A leg that reaches openQty 0 is closed forever. Re-entering the same
 *   contract later is a NEW position, which is what keeps weighted-average entry
 *   unambiguous. Attempting to add an entry to a closed leg is rejected.
 */
import { prisma } from "../prisma";
import { D, dec, ZERO, fraction } from "../money";
import { buildOcc, describeOcc, normalizeUnderlying } from "../occ";
import { classifyStructure, netCashPerUnit, type LegSpec } from "../structure";
import { reduceLegFills, type FillLike, type LegLike } from "../pnl";
import { ensureGurus } from "./gurus";

export const STOCK_MULTIPLIER = 1;
export const OPTION_MULTIPLIER = 100;

export interface LegInput {
  kind: "STOCK" | "OPTION";
  /** Opening direction: BUY = long, SELL = short. */
  side: "BUY" | "SELL";
  /** Entry price per share / per contract. Always positive. */
  price: D;
  /**
   * Contracts of THIS leg per one unit of the position. Stays 1 for a normal
   * leg; it is 2 only for something like the short side of a 1x2 ratio spread.
   * This is the SHAPE of the position, not how much of it is held — see
   * CreatePositionInput.units for that.
   */
  ratio?: number;
  // option-only
  expiry?: string; // "YYYY-MM-DD"
  strike?: D;
  right?: "CALL" | "PUT";
}

export interface CreatePositionInput {
  portfolioId: string;
  /** Underlying ticker, e.g. "NVDA". Normalized here. */
  underlying: string;
  companyName?: string | null;
  openedAt: Date;
  legs: LegInput[];
  /**
   * How many units of the position were opened. Defaults to 1.
   *
   * Separate from a leg's `ratio` on purpose: ratio describes the structure and
   * so belongs in the price arithmetic, while units describes size and must NOT.
   * Conflating them scaled every displayed price by the size — a $26.40 entry
   * held in two halves rendered as $52.80.
   */
  units?: number;
  buyUpToPrice?: D | null;
  stopLossPrice?: D | null;
  targetPrice?: D | null;
  thesis?: string | null;
  comment?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  source?: "MANUAL" | "AIRTABLE_IMPORT";
  airtableId?: string | null;
  /** Who made the pick. Resolve it with lib/managed/war-room-owners.ts. */
  guruSlug?: string | null;
}

/** The market ticker a leg prices against: a bare symbol, or an OCC option symbol. */
function marketTickerFor(underlying: string, leg: LegInput): string {
  if (leg.kind === "STOCK") return underlying;
  if (!leg.expiry || !leg.strike || !leg.right) {
    throw new Error("An option leg needs an expiry, a strike and call/put.");
  }
  return buildOcc({
    underlying,
    expiry: leg.expiry,
    right: leg.right === "CALL" ? "C" : "P",
    // buildOcc multiplies by 1000 internally; a Decimal keeps that exact, but
    // the OccParts contract is a number.
    strike: leg.strike.toNumber(),
  });
}

/**
 * Register the instrument a leg prices against, so the price cron knows to fetch
 * it. Reactivates a row that was previously retired rather than inserting a
 * duplicate, which keeps the last known price attached to closed history.
 */
async function ensureInstrument(
  ticker: string,
  underlying: string,
  leg: LegInput,
) {
  const base = {
    kind: leg.kind,
    underlying,
    expiry:
      leg.kind === "OPTION" && leg.expiry
        ? new Date(`${leg.expiry}T00:00:00Z`)
        : null,
    strike: leg.kind === "OPTION" && leg.strike ? leg.strike.toString() : null,
    right: leg.kind === "OPTION" ? leg.right : null,
    active: true,
  };
  return prisma.marketInstrument.upsert({
    where: { ticker },
    update: { active: true },
    create: { ticker, ...base },
  });
}

/** Human label: "NVDA", "NVDA 1/16/27 $200 Call", "SPY 550/560 Call Debit Spread". */
function buildLabel(
  underlying: string,
  legs: LegInput[],
  structure: string,
  tickers: string[],
): string {
  if (legs.length === 1) {
    return legs[0].kind === "STOCK" ? underlying : describeOcc(tickers[0]);
  }
  const strikes = legs
    .map((l) => l.strike?.toString())
    .filter(Boolean)
    .join("/");
  const pretty = structure
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return `${underlying} ${strikes} ${pretty}`.replace(/\s+/g, " ").trim();
}

export async function createPosition(input: CreatePositionInput) {
  if (input.legs.length === 0)
    throw new Error("A position needs at least one leg.");

  const underlying = normalizeUnderlying(input.underlying);
  if (!underlying) throw new Error("Enter a ticker symbol.");

  for (const leg of input.legs) {
    if (!leg.price.isFinite() || leg.price.lte(0)) {
      throw new Error("Every entry price must be greater than zero.");
    }
  }

  const specs: LegSpec[] = input.legs.map((l) => ({
    kind: l.kind,
    side: l.side,
    ratio: l.ratio ?? 1,
    multiplier: l.kind === "OPTION" ? OPTION_MULTIPLIER : STOCK_MULTIPLIER,
    price: l.price,
    strike: l.strike,
    right: l.right,
    expiry: l.expiry,
  }));
  // classifyStructure needs the net entry cash (to tell a debit spread from a
  // credit one) and the distinct expiries (to spot a calendar).
  const entryCash = netCashPerUnit(specs);
  const distinctExpiries = [
    ...new Set(input.legs.map((l) => l.expiry).filter((e): e is string => !!e)),
  ];
  const structure = classifyStructure(specs, entryCash, distinctExpiries);

  const tickers = input.legs.map((l) => marketTickerFor(underlying, l));
  for (let i = 0; i < input.legs.length; i += 1) {
    await ensureInstrument(tickers[i], underlying, input.legs[i]);
  }

  const units = Math.max(1, Math.floor(input.units ?? 1));
  const instrument = input.legs.every((l) => l.kind === "STOCK")
    ? "STOCK"
    : "OPTION";
  const label = buildLabel(underlying, input.legs, structure, tickers);

  // Create the Guru row if it is missing rather than dropping the attribution.
  // The table used to be populated only as a side effect of the Airtable sync, so
  // importing into a database where the sync had not run produced silently
  // unowned positions. An unrecognised slug still leaves the owner blank rather
  // than failing the write — a blank an editor can fix beats losing their work.
  const guruId = input.guruSlug
    ? ((await ensureGurus()).get(input.guruSlug) ?? null)
    : null;

  const position = await prisma.$transaction(async (tx) => {
    const created = await tx.managedPosition.create({
      data: {
        portfolioId: input.portfolioId,
        underlying,
        companyName: input.companyName ?? null,
        instrument,
        structure,
        label,
        openedAt: input.openedAt,
        buyUpToPrice: input.buyUpToPrice?.toString() ?? null,
        stopLossPrice: input.stopLossPrice?.toString() ?? null,
        targetPrice: input.targetPrice?.toString() ?? null,
        thesis: input.thesis ?? null,
        guruId,
        source: input.source ?? "MANUAL",
        airtableId: input.airtableId ?? null,
        createdByEmail: input.actorEmail ?? null,
        updatedByEmail: input.actorEmail ?? null,
      },
    });

    const execution = await tx.managedExecution.create({
      data: {
        positionId: created.id,
        intent: "OPEN",
        units,
        executedAt: input.openedAt,
        createdByEmail: input.actorEmail ?? null,
      },
    });

    for (let i = 0; i < input.legs.length; i += 1) {
      const leg = input.legs[i];
      const multiplier =
        leg.kind === "OPTION" ? OPTION_MULTIPLIER : STOCK_MULTIPLIER;
      const ratio = leg.ratio ?? 1;
      // Contracts of this leg = units of the position x this leg's ratio.
      const quantity = units * ratio;

      const createdLeg = await tx.managedLeg.create({
        data: {
          positionId: created.id,
          legIndex: i,
          kind: leg.kind,
          underlying,
          marketTicker: tickers[i],
          expiry:
            leg.kind === "OPTION" && leg.expiry
              ? new Date(`${leg.expiry}T00:00:00Z`)
              : null,
          strike: leg.strike?.toString() ?? null,
          right: leg.kind === "OPTION" ? leg.right : null,
          side: leg.side,
          ratio,
          multiplier,
        },
      });

      await tx.managedFill.create({
        data: {
          executionId: execution.id,
          legId: createdLeg.id,
          positionId: created.id,
          intent: "OPEN",
          side: leg.side,
          quantity,
          price: leg.price.toString(),
          multiplier,
          cashFlow: signedCash(
            leg.side,
            leg.price,
            quantity,
            multiplier,
          ).toString(),
          executedAt: input.openedAt,
        },
      });
    }

    if (input.comment) {
      await tx.managedComment.create({
        data: {
          positionId: created.id,
          executionId: execution.id,
          body: input.comment,
          authorEmail: input.actorEmail ?? null,
          authorName: input.actorName ?? null,
        },
      });
    }

    return created;
  });

  await recomputePosition(position.id);
  return position;
}

/** Signed cash for a fill: buying pays out, selling takes in. */
function signedCash(
  side: "BUY" | "SELL",
  price: D,
  quantity: number,
  multiplier: number,
): D {
  const gross = price.times(quantity).times(multiplier);
  return side === "BUY" ? gross.negated() : gross;
}

export interface CloseInput {
  positionId: string;
  executedAt: Date;
  /** Exit price per leg, keyed by legId. A leg omitted is left open. */
  prices: Record<string, D>;
  /**
   * Units to close per leg, keyed by legId. Omitted means "all of it", which is
   * what the plain Close button sends.
   */
  quantities?: Record<string, number>;
  note?: string | null;
  comment?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
}

/**
 * Close some or all of a position. A partial close is the same operation with
 * smaller quantities, so scaling out repeatedly needs no separate path.
 */
export async function closePosition(input: CloseInput) {
  const position = await prisma.managedPosition.findUnique({
    where: { id: input.positionId },
    include: { legs: { include: { fills: true } } },
  });
  if (!position) throw new Error("Position not found.");

  const targets = position.legs.filter((l) => input.prices[l.id] !== undefined);
  if (targets.length === 0) throw new Error("Enter a closing price.");

  for (const leg of targets) {
    const price = input.prices[leg.id];
    if (!price.isFinite() || price.lt(0)) {
      throw new Error("A closing price cannot be negative.");
    }
    if (leg.openQty <= 0) {
      throw new Error(
        `${leg.marketTicker} is already closed. Re-entering it is a new position.`,
      );
    }
    const want = input.quantities?.[leg.id] ?? leg.openQty;
    if (want <= 0) throw new Error("Closing quantity must be at least 1.");
    if (want > leg.openQty) {
      throw new Error(
        `Cannot close ${want} of ${leg.marketTicker} — only ${leg.openQty} is open.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const execution = await tx.managedExecution.create({
      data: {
        positionId: position.id,
        intent: "CLOSE",
        executedAt: input.executedAt,
        // Flag a close that touches only part of a multi-leg position, since the
        // remaining legs keep running and the label no longer describes it.
        leggedOut:
          position.legs.length > 1 && targets.length < position.legs.length,
        note: input.note ?? null,
        createdByEmail: input.actorEmail ?? null,
      },
    });

    for (const leg of targets) {
      const quantity = input.quantities?.[leg.id] ?? leg.openQty;
      const price = input.prices[leg.id];
      // Closing reverses the opening direction.
      const side = leg.side === "BUY" ? "SELL" : "BUY";
      await tx.managedFill.create({
        data: {
          executionId: execution.id,
          legId: leg.id,
          positionId: position.id,
          intent: "CLOSE",
          side,
          quantity,
          price: price.toString(),
          multiplier: leg.multiplier,
          cashFlow: signedCash(
            side,
            price,
            quantity,
            leg.multiplier,
          ).toString(),
          executedAt: input.executedAt,
        },
      });
    }

    if (input.comment) {
      await tx.managedComment.create({
        data: {
          positionId: position.id,
          executionId: execution.id,
          body: input.comment,
          authorEmail: input.actorEmail ?? null,
          authorName: input.actorName ?? null,
        },
      });
    }
  });

  return recomputePosition(position.id);
}

/**
 * Rebuild every cached figure on a position from its fills.
 *
 * Always a full rebuild, never a delta. Editing one fill ripples through
 * weighted-average entry, realized P&L and the leg's open quantity in ways a
 * delta gets wrong; recomputing from the fills is the only version that is
 * correct after a correction.
 */
export async function recomputePosition(positionId: string) {
  const position = await prisma.managedPosition.findUnique({
    where: { id: positionId },
    include: {
      legs: {
        orderBy: { legIndex: "asc" },
        include: {
          fills: { orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }] },
          instrument: true,
        },
      },
    },
  });
  if (!position) return null;

  let realized = ZERO;
  let entryBasis = ZERO;
  let currentValue = ZERO;
  let unpriced = false;
  let manualPriced = false;
  let allLegsClosed = true;
  let lastExit: Date | null = null;

  for (const leg of position.legs) {
    const legLike: LegLike = {
      id: leg.id,
      legIndex: leg.legIndex,
      multiplier: leg.multiplier,
      side: leg.side,
      fills: leg.fills.map((f): FillLike => ({
        id: f.id,
        intent: f.intent,
        side: f.side,
        quantity: f.quantity,
        price: dec(f.price.toString()),
        multiplier: f.multiplier,
        executedAt: f.executedAt,
        createdAt: f.createdAt,
        deletedAt: f.deletedAt,
      })),
    };
    const state = reduceLegFills(legLike);

    await prisma.managedLeg.update({
      where: { id: leg.id },
      data: {
        openQty: state.openQty,
        closedQty: state.closedQty,
        wavgEntry: state.wavgEntry?.toString() ?? null,
        wavgExit: state.wavgExit?.toString() ?? null,
        realizedPnl: state.realizedPnl.toString(),
        closedAt:
          state.openQty === 0 && state.closedQty > 0
            ? (leg.closedAt ?? lastFillDate(leg.fills))
            : null,
      },
    });

    realized = realized.plus(state.realizedPnl);
    if (state.openQty > 0) allLegsClosed = false;

    // Entry basis and current value are per-unit price sums, since quantity here
    // is notional (see the header). A long leg adds, a short leg subtracts, so a
    // credit spread's basis is its net debit.
    const sign = leg.side === "BUY" ? 1 : -1;
    if (state.wavgEntry) {
      entryBasis = entryBasis.plus(
        state.wavgEntry.times(sign).times(leg.ratio),
      );
    }

    if (state.openQty > 0) {
      // Mark ladder: a live provider price always wins. An editor-entered price
      // is the fallback, and only exists for instruments the provider cannot
      // price at all (interval and private funds have no exchange quote).
      const live = leg.instrument.lastPrice
        ? dec(leg.instrument.lastPrice.toString())
        : null;
      const manual = leg.instrument.manualPrice
        ? dec(leg.instrument.manualPrice.toString())
        : null;
      const mark = live ?? manual;
      if (mark) {
        if (!live) manualPriced = true;
        currentValue = currentValue.plus(mark.times(sign).times(leg.ratio));
      } else {
        // NEVER value a missing price at zero — that would publish a total loss
        // on a position that is merely illiquid.
        unpriced = true;
      }
    } else if (state.wavgExit) {
      currentValue = currentValue.plus(
        state.wavgExit.times(sign).times(leg.ratio),
      );
      const d = lastFillDate(leg.fills);
      if (d && (!lastExit || d > lastExit)) lastExit = d;
    }
  }

  // Return on the entry basis. Null rather than zero when there is no basis or a
  // leg could not be priced, so a page renders "—" instead of a false 0.0%.
  const returnPct =
    unpriced || entryBasis.isZero()
      ? null
      : fraction(currentValue.minus(entryBasis), entryBasis.abs());

  const status = allLegsClosed && position.legs.length > 0 ? "CLOSED" : "OPEN";

  return prisma.managedPosition.update({
    where: { id: positionId },
    data: {
      status,
      closedAt:
        status === "CLOSED"
          ? (position.closedAt ?? lastExit ?? new Date())
          : null,
      cachedEntryPrice: entryBasis.isZero() ? null : entryBasis.toString(),
      cachedCurrentPrice:
        unpriced || currentValue.isZero() ? null : currentValue.toString(),
      cachedReturnPct: returnPct?.toString() ?? null,
      cachedRealizedPnl: realized.toString(),
      cachedUnrealizedPnl:
        status === "CLOSED" || unpriced
          ? null
          : currentValue.minus(entryBasis).toString(),
      cachedUnpriced: unpriced,
      cachedManualPriced: manualPriced,
      cachedAt: new Date(),
    },
  });
}

function lastFillDate(
  fills: { executedAt: Date; deletedAt: Date | null }[],
): Date | null {
  const live = fills.filter((f) => !f.deletedAt);
  if (live.length === 0) return null;
  return live.reduce((a, b) => (b.executedAt > a.executedAt ? b : a))
    .executedAt;
}

/** Recompute every position in a portfolio — used after a price refresh. */
export async function recomputePortfolio(portfolioId: string) {
  const ids = await prisma.managedPosition.findMany({
    where: { portfolioId, deletedAt: null },
    select: { id: true },
  });
  for (const { id } of ids) await recomputePosition(id);
  return ids.length;
}
