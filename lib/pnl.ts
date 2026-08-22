/**
 * Fills -> position state -> mark-to-market. Pure; no Prisma, no I/O.
 *
 * THE SIGN CONVENTION THAT MAKES EVERYTHING ELSE SIMPLE:
 * a leg's mark value is SIGNED by its direction —
 *
 *     legMarkValue = direction * mark * openQty * multiplier
 *
 * with direction = +1 for a long leg and -1 for a short leg. That single choice
 * means
 *
 *     accountValue = cash + SUM(legMarkValue)
 *
 * is correct for credit spreads, condors and butterflies with NO spread-netting
 * code path anywhere. Check it at the moment of entry, where account value must
 * not move:
 *
 *   long call for $2.00      cash -200, mark value +200            -> 0 change
 *   5-wide credit spread     cash +150, short -180, long +30 = -150 -> 0 change
 *
 * ONE RULE ELIMINATES A WHOLE CLASS OF AMBIGUITY: a leg that reaches zero
 * quantity is CLOSED FOREVER. Re-entering the same contract creates a new Trade.
 * With that rule, the weighted-average entry over all opening fills is IDENTICAL
 * to the average cost basis of the remaining open quantity — the two definitions
 * cannot drift apart, which is exactly the bug that average-cost accounting
 * usually produces.
 */
import {
  D,
  dec,
  ZERO,
  sum,
  fraction,
  OPTION_MULTIPLIER,
} from "./money";

export type FillIntent = "OPEN" | "CLOSE";
export type FillSide = "BUY" | "SELL";

/** The minimum a fill must expose. Prisma rows satisfy this structurally. */
export interface FillLike {
  id: string;
  intent: FillIntent;
  side: FillSide;
  quantity: number;
  price: D;
  multiplier: number;
  commission?: D | null;
  executedAt: Date;
  createdAt: Date;
  deletedAt?: Date | null;
  supersededById?: string | null;
}

export interface LegLike {
  id: string;
  legIndex: number;
  multiplier: number;
  /** Opening direction of the leg. */
  side: "BUY" | "SELL";
  fills: FillLike[];
}

export interface LegState {
  legId: string;
  legIndex: number;
  /** +1 long, -1 short — taken from the FIRST opening fill, not from leg.side. */
  direction: 1 | -1;
  multiplier: number;
  openQty: number;
  closedQty: number;
  /** Weighted average over ALL opening fills, per share/contract. */
  wavgEntry: D | null;
  /** Weighted average over ALL closing fills. */
  wavgExit: D | null;
  /** Unsigned dollar basis still attached to the open quantity. */
  openBasis: D;
  realizedPnl: D;
  commissions: D;
  isClosed: boolean;
}

export class ReopenAfterFlatError extends Error {
  constructor(legId: string) {
    super(
      `Leg ${legId} was fully closed and cannot be reopened. Enter a new trade instead.`
    );
    this.name = "ReopenAfterFlatError";
  }
}

export class OverCloseError extends Error {
  constructor(legId: string, attempted: number, available: number) {
    super(
      `Cannot close ${attempted} on leg ${legId}: only ${available} open.`
    );
    this.name = "OverCloseError";
  }
}

/** Fills that still count: not soft-deleted, not superseded by an edit. */
export function activeFills(fills: FillLike[]): FillLike[] {
  return fills
    .filter((f) => !f.deletedAt && !f.supersededById)
    .sort((a, b) => {
      const t = a.executedAt.getTime() - b.executedAt.getTime();
      if (t !== 0) return t;
      const c = a.createdAt.getTime() - b.createdAt.getTime();
      if (c !== 0) return c;
      // Final tiebreak on id so the reduction is deterministic even for two
      // fills stamped with the same instant — otherwise realized P&L could
      // differ between two runs over identical data.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Reduce a leg's fills to its current state. Throws on a structurally impossible
 * history rather than producing a plausible-looking wrong number.
 */
export function reduceLegFills(leg: LegLike): LegState {
  const fills = activeFills(leg.fills);

  const firstOpen = fills.find((f) => f.intent === "OPEN");
  const direction: 1 | -1 = firstOpen
    ? firstOpen.side === "BUY"
      ? 1
      : -1
    : leg.side === "BUY"
      ? 1
      : -1;
  const multiplier = fills[0]?.multiplier ?? leg.multiplier;

  let openQty = 0;
  let openBasis = ZERO; // unsigned dollars
  let totalOpenQty = 0;
  let totalOpenNotional = ZERO;
  let closedQty = 0;
  let totalExitNotional = ZERO;
  let realized = ZERO;
  let commissions = ZERO;

  for (const f of fills) {
    const notional = f.price.times(f.quantity).times(f.multiplier);
    commissions = commissions.plus(f.commission ?? ZERO);

    if (f.intent === "OPEN") {
      if (openQty === 0 && totalOpenQty > 0) throw new ReopenAfterFlatError(leg.id);
      openQty += f.quantity;
      openBasis = openBasis.plus(notional);
      totalOpenQty += f.quantity;
      totalOpenNotional = totalOpenNotional.plus(notional);
    } else {
      if (f.quantity > openQty) {
        throw new OverCloseError(leg.id, f.quantity, openQty);
      }
      // Average-cost: remove basis at the running average, not at a specific lot.
      const avgNow = openBasis.div(dec(openQty).times(multiplier));
      const basisRemoved = avgNow.times(f.quantity).times(multiplier);
      // Direction-aware: a long profits when exit > entry, a short the reverse.
      realized = realized.plus(dec(direction).times(notional.minus(basisRemoved)));
      openBasis = openBasis.minus(basisRemoved);
      openQty -= f.quantity;
      closedQty += f.quantity;
      totalExitNotional = totalExitNotional.plus(notional);
    }
  }

  return {
    legId: leg.id,
    legIndex: leg.legIndex,
    direction,
    multiplier,
    openQty,
    closedQty,
    // Commissions are NOT baked into these averages: the displayed average entry
    // and exit must be the prices the trader actually got. Commissions are
    // subtracted once, at the trade level.
    wavgEntry: totalOpenQty
      ? totalOpenNotional.div(dec(totalOpenQty).times(multiplier))
      : null,
    wavgExit: closedQty
      ? totalExitNotional.div(dec(closedQty).times(multiplier))
      : null,
    openBasis,
    realizedPnl: realized,
    commissions,
    isClosed: totalOpenQty > 0 && openQty === 0,
  };
}

/** SIGNED market value of a leg's open quantity. Shorts are negative. */
export function legMarkValue(s: LegState, mark: D): D {
  return dec(s.direction).times(mark).times(s.openQty).times(s.multiplier);
}

/** SIGNED unrealized P&L on a leg's open quantity. */
export function legUnrealized(s: LegState, mark: D): D {
  if (s.openQty === 0 || s.wavgEntry === null) return ZERO;
  return dec(s.direction)
    .times(mark.minus(s.wavgEntry))
    .times(s.openQty)
    .times(s.multiplier);
}

// ------------------------------------------------------------ trade rollup

export type MarkSource =
  | "TRADER"
  | "LAST"
  | "PREV_CLOSE"
  | "CARRIED"
  | "INTRINSIC"
  | "COST"
  | "ZERO"
  | "NONE";

export interface Mark {
  mark: D | null;
  source: MarkSource;
  asOf: Date | null;
  flags?: string[];
}

export interface TradeLike {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: Date;
  closedAt: Date | null;
  /** Peak capital committed — the return-% denominator. */
  maxCapitalCommitted: D;
  legs: (LegLike & { marketTicker: string })[];
}

export interface LegValuation {
  state: LegState;
  ticker: string;
  mark: D | null;
  markSource: MarkSource;
  markAsOf: Date | null;
  markFlags: string[];
  markValue: D;
  unrealized: D;
  /**
   * True when this leg is open and the market has given us no price, so it is
   * being held at the trader's own entry price. It IS valued — just not by the
   * market. Never means "excluded".
   */
  atCost: boolean;
}

export interface TradeValuation {
  tradeId: string;
  legs: LegValuation[];
  /** SUM of signed leg mark values. Excludes unpriced legs. */
  markValue: D;
  realizedPnl: D;
  unrealizedPnl: D;
  totalPnl: D;
  capitalDenominator: D;
  returnPct: D | null;
  collateralHeld: D;
  /** Any open leg is marked CARRIED, TRADER or COST rather than by the market. */
  degraded: boolean;
  /** Open legs held at the trader's entry price because the market gave no price. */
  atCostLegs: number;
  /** The OLDEST mark timestamp across priced legs — the honest "as of". */
  asOf: Date | null;
  openQtyTotal: number;
}

/**
 * Value a whole trade against a map of marks keyed by marketTicker.
 *
 * WHEN THE MARKET HAS NO PRICE, THE LEG IS HELD AT COST — not excluded, and not
 * zero.
 *
 * This was originally written to EXCLUDE an unpriced leg, on the reasoning that
 * marking it zero would be dishonest. That reasoning was wrong: the cash was
 * already debited when the position opened, so excluding the position from account
 * value produces the SAME total as marking it zero — a phantom total loss on a
 * position that is merely unpriced.
 *
 * Holding it at the trader's weighted-average entry price is the honest state: the
 * account value does not move, unrealized P&L is exactly zero, and the UI says the
 * market has not priced it yet. `atCostLegs` is a disclosure, never an exclusion.
 *
 * Cost basis is per-LEG, which is why this fallback lives here rather than in
 * lib/marks.ts — that layer is keyed by ticker and cannot know whose position it
 * is valuing.
 */
export function valuateTrade(
  trade: TradeLike,
  marks: Map<string, Mark>,
  opts?: { collateralPerUnitOpen?: D }
): TradeValuation {
  const legs: LegValuation[] = trade.legs.map((leg) => {
    const state = reduceLegFills(leg);
    const m = marks.get(leg.marketTicker);
    const marketMark = m?.mark ?? null;
    const isOpen = state.openQty > 0;

    // Fall back to the leg's own average entry price.
    const fellBackToCost = isOpen && marketMark === null && state.wavgEntry !== null;
    const effectiveMark = marketMark ?? (fellBackToCost ? state.wavgEntry : null);
    const priced = effectiveMark !== null && isOpen;

    return {
      state,
      ticker: leg.marketTicker,
      mark: effectiveMark,
      markSource: fellBackToCost ? "COST" : (m?.source ?? "NONE"),
      markAsOf: fellBackToCost ? null : (m?.asOf ?? null),
      markFlags: fellBackToCost ? ["AT_COST"] : (m?.flags ?? []),
      markValue: priced ? legMarkValue(state, effectiveMark!) : ZERO,
      // Zero by construction when held at cost: mark equals entry.
      unrealized: priced ? legUnrealized(state, effectiveMark!) : ZERO,
      atCost: fellBackToCost,
    };
  });

  const realizedPnl = sum(legs.map((l) => l.state.realizedPnl)).minus(
    sum(legs.map((l) => l.state.commissions))
  );
  const unrealizedPnl = sum(legs.map((l) => l.unrealized));
  const markValue = sum(legs.map((l) => l.markValue));
  const totalPnl = realizedPnl.plus(unrealizedPnl);

  const openTimestamps = legs
    .filter((l) => l.state.openQty > 0 && l.markAsOf)
    .map((l) => l.markAsOf!.getTime());

  const degraded = legs.some(
    (l) =>
      l.state.openQty > 0 &&
      (l.atCost || l.markSource === "CARRIED" || l.markSource === "TRADER")
  );

  return {
    tradeId: trade.id,
    legs,
    markValue,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    capitalDenominator: trade.maxCapitalCommitted,
    returnPct: fraction(totalPnl, trade.maxCapitalCommitted),
    collateralHeld: opts?.collateralPerUnitOpen ?? ZERO,
    degraded,
    atCostLegs: legs.filter((l) => l.atCost).length,
    // The OLDEST timestamp, not the newest: a thinly traded option lags the
    // whole position, and showing the freshest stamp would overstate how
    // current the number is.
    asOf: openTimestamps.length ? new Date(Math.min(...openTimestamps)) : null,
    openQtyTotal: sum(legs.map((l) => dec(l.state.openQty))).toNumber(),
  };
}

/** Is every leg of this trade flat? */
export function isTradeFlat(trade: TradeLike): boolean {
  return trade.legs.every((leg) => reduceLegFills(leg).openQty === 0);
}

export { OPTION_MULTIPLIER };
