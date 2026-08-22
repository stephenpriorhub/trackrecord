/**
 * Position structure economics: net cash, MAXIMUM LOSS, collateral, break-evens.
 *
 * This module is the load-bearing piece of the whole app. Everything downstream
 * depends on it:
 *   - sizing divides the trader's dollar allocation by max loss per unit
 *   - the contest's max-risk-per-trade % is checked against max loss
 *   - the "defined risk only" rule is enforced by max loss coming back null
 *
 * THE DESIGN DECISION THAT MATTERS: there is NO case table per structure. A
 * lookup table of "vertical => width - credit, condor => width - credit, ..." is
 * how these things get subtly wrong, because every new structure needs a new case
 * and the cases interact (a collar is a covered call plus a long put). Instead we
 * evaluate the expiry payoff numerically at every kink and pick the worst point.
 * That is correct for verticals, condors, butterflies, collars and arbitrary
 * 6-leg customs alike, and — crucially — it detects UNBOUNDED risk as a property
 * of the payoff curve rather than as a special case someone has to remember.
 *
 * Pure — no Prisma, no I/O, safe on the client.
 */
import { D, dec, ZERO, sum, minOf, OPTION_MULTIPLIER } from "./money";

export type StructureKind =
  | "LONG_STOCK"
  | "LONG_CALL"
  | "LONG_PUT"
  | "VERTICAL_DEBIT"
  | "VERTICAL_CREDIT"
  | "STRADDLE"
  | "STRANGLE"
  | "BUTTERFLY"
  | "IRON_CONDOR"
  | "IRON_BUTTERFLY"
  | "CUSTOM_DEFINED_RISK"
  | "UNDEFINED_RISK";

export interface LegSpec {
  kind: "STOCK" | "OPTION";
  /** Opening direction: BUY = long, SELL = short. */
  side: "BUY" | "SELL";
  /** Contracts (or 100-share blocks) per ONE spread unit. */
  ratio: number;
  /** 100 for options, 1 for stock. */
  multiplier: number;
  /** Per share / per contract, at entry. Always positive. */
  price: D;
  strike?: D;
  right?: "CALL" | "PUT";
  /** "YYYY-MM-DD" — options only. */
  expiry?: string;
}

export interface UnitEconomics {
  structure: StructureKind;
  /** Signed net cash for ONE spread unit. Negative = debit paid, positive = credit received. */
  netCashPerUnit: D;
  /** max(0, -netCashPerUnit) — the cash actually paid out to open one unit. */
  perUnitDebit: D;
  /**
   * Worst-case loss for ONE spread unit at expiry, as a POSITIVE number.
   * null = UNBOUNDED or UNDEFINED risk. The sizing layer rejects null.
   */
  maxLossPerUnit: D | null;
  /** Buying power held while the unit is open. */
  collateralPerUnit: D;
  definedRisk: boolean;
  /** Underlying prices where the expiry payoff crosses zero. */
  breakEvens: D[];
  distinctExpiries: string[];
  /** Present when definedRisk is false — why it was rejected. */
  undefinedReason?: "UNBOUNDED_UPSIDE" | "MULTI_EXPIRY" | "NO_LEGS";
}

const EPS = dec("0.000001");

function legSign(side: "BUY" | "SELL"): D {
  return side === "BUY" ? dec(-1) : dec(1);
}

/**
 * Signed net cash to open one spread unit.
 *   BUY  => cash out (negative)
 *   SELL => cash in  (positive)
 */
export function netCashPerUnit(legs: LegSpec[]): D {
  return sum(
    legs.map((l) => legSign(l.side).times(l.price).times(l.ratio).times(l.multiplier))
  );
}

/**
 * Value of the whole structure at expiry for a given underlying price S, per unit,
 * INCLUDING the entry cash. This is the P&L at expiry, not the terminal value.
 */
function payoffAt(legs: LegSpec[], entryCash: D, S: D): D {
  let v = entryCash;
  for (const l of legs) {
    // A long leg's terminal value accrues to us; a short leg's is owed.
    const sgn = l.side === "BUY" ? dec(1) : dec(-1);
    const qty = dec(l.ratio).times(l.multiplier);
    if (l.kind === "OPTION") {
      const k = l.strike ?? ZERO;
      const intrinsic =
        l.right === "CALL" ? maxZero(S.minus(k)) : maxZero(k.minus(S));
      v = v.plus(sgn.times(intrinsic).times(qty));
    } else {
      // Stock: the entry cash is already in entryCash, so add the terminal
      // share value.
      v = v.plus(sgn.times(S).times(qty));
    }
  }
  return v;
}

function maxZero(v: D): D {
  return v.isNegative() ? ZERO : v;
}

/** Underlying prices worth probing: every kink, every midpoint, 0, and far above. */
function probePrices(legs: LegSpec[]): { probes: D[]; hi: D } {
  const strikes = Array.from(
    new Set(
      legs
        .filter((l) => l.kind === "OPTION" && l.strike)
        .map((l) => l.strike!.toString())
    )
  )
    .map((s) => dec(s))
    .sort((a, b) => a.comparedTo(b));

  const stockPrices = legs.filter((l) => l.kind === "STOCK").map((l) => l.price);

  const anchor = strikes.length
    ? strikes[strikes.length - 1]
    : stockPrices.length
      ? maxOfOr(stockPrices, dec(100))
      : dec(100);

  const hi = anchor.times(2).plus(10);

  const probes: D[] = [ZERO];
  for (let i = 0; i < strikes.length; i++) {
    probes.push(strikes[i]);
    if (i + 1 < strikes.length) {
      probes.push(strikes[i].plus(strikes[i + 1]).div(2)); // midpoint between kinks
    }
  }
  for (const p of stockPrices) probes.push(p);
  probes.push(hi);
  return { probes, hi };
}

function maxOfOr(xs: D[], fallback: D): D {
  return xs.length ? xs.reduce((a, b) => (b.gt(a) ? b : a)) : fallback;
}

/**
 * Compute the economics of one spread unit.
 *
 * Returns maxLossPerUnit = null (definedRisk false) when:
 *   - the payoff is still falling above the highest strike  => unbounded upside
 *     risk (naked/ratio short call). Puts cannot be unbounded: their worst case
 *     is S = 0, which is always a probe.
 *   - the legs span more than one expiry => a calendar/diagonal has no
 *     single-expiry payoff, so "max loss" is not analytically defined. Treating
 *     it as the net debit would understate the risk of the short leg, so we
 *     decline to size it rather than guess.
 */
export function computeUnitEconomics(legs: LegSpec[]): UnitEconomics {
  if (legs.length === 0) {
    return {
      structure: "UNDEFINED_RISK",
      netCashPerUnit: ZERO,
      perUnitDebit: ZERO,
      maxLossPerUnit: null,
      collateralPerUnit: ZERO,
      definedRisk: false,
      breakEvens: [],
      distinctExpiries: [],
      undefinedReason: "NO_LEGS",
    };
  }

  const entryCash = netCashPerUnit(legs);
  const perUnitDebit = maxZero(entryCash.negated());

  const distinctExpiries = Array.from(
    new Set(legs.filter((l) => l.kind === "OPTION" && l.expiry).map((l) => l.expiry!))
  ).sort();

  const base = {
    netCashPerUnit: entryCash,
    perUnitDebit,
    breakEvens: [] as D[],
    distinctExpiries,
  };

  if (distinctExpiries.length > 1) {
    return {
      ...base,
      structure: "UNDEFINED_RISK",
      maxLossPerUnit: null,
      collateralPerUnit: ZERO,
      definedRisk: false,
      undefinedReason: "MULTI_EXPIRY",
    };
  }

  const { probes, hi } = probePrices(legs);

  // Unbounded check: if the payoff is still decreasing well past the last kink,
  // the loss has no floor. Compare two points far to the right — beyond every
  // strike the curve is linear, so a single decreasing step proves it.
  const atHi = payoffAt(legs, entryCash, hi);
  const atHi2 = payoffAt(legs, entryCash, hi.times(2));
  if (atHi2.lt(atHi.minus(EPS))) {
    return {
      ...base,
      structure: "UNDEFINED_RISK",
      maxLossPerUnit: null,
      collateralPerUnit: ZERO,
      definedRisk: false,
      undefinedReason: "UNBOUNDED_UPSIDE",
    };
  }

  const values = probes.map((S) => payoffAt(legs, entryCash, S));
  const worst = minOf(values);
  // A non-negative worst case means the structure cannot lose (an arbitrage, or
  // a locked-in profit). maxLoss 0 would make sizing divide by zero, so callers
  // must handle it — lib/sizing.ts returns NON_RISK_STRUCTURE.
  const maxLossPerUnit = worst.isNegative() ? worst.negated() : ZERO;

  const structure = classifyStructure(legs, entryCash, distinctExpiries);
  const collateralPerUnit = computeCollateral(entryCash, maxLossPerUnit);
  const breakEvens = findBreakEvens(legs, entryCash, probes, hi);

  return {
    ...base,
    structure,
    maxLossPerUnit,
    collateralPerUnit,
    definedRisk: true,
    breakEvens,
  };
}

/**
 * Buying power reserved while the unit is open.
 *
 * This is the mechanism that lets credit structures coexist with a hard-block
 * cash model. Cash and capacity are separated:
 *
 *     availableCash = cashBalance - reservedCollateral
 *
 * The reserve is chosen to make ONE invariant hold for every defined-risk
 * structure — the identity the whole sizing model rests on:
 *
 *     availableCash consumed  ==  maxLossPerUnit
 *
 * Since opening changes availableCash by (entryCash - collateral), that forces
 *
 *     collateral = entryCash + maxLoss
 *
 * and it lands exactly on real broker conventions, which is a good sign it is
 * the right definition rather than a convenient one:
 *
 *   long call, debit 2.00, maxLoss 200   -> collateral 0     (cash IS the reserve)
 *   long stock 100sh @ 48                -> collateral 0
 *   covered call                         -> collateral 0     (shares are the cover)
 *   5-wide credit spread, 1.50 credit    -> collateral 500   (= the WIDTH)
 *   short 50 put, 2.00 credit            -> collateral 5000  (= strike x 100,
 *                                                            i.e. cash-secured)
 *
 * Clamped at zero defensively: for a defined-risk structure the debit can never
 * exceed the max loss, so a negative result would mean the lattice is wrong.
 */
function computeCollateral(entryCash: D, maxLoss: D): D {
  return maxZero(entryCash.plus(maxLoss));
}

/** Underlying prices where the expiry payoff crosses zero (linear interpolation). */
function findBreakEvens(legs: LegSpec[], entryCash: D, probes: D[], hi: D): D[] {
  const xs = Array.from(new Set([...probes, hi].map((p) => p.toString())))
    .map((s) => dec(s))
    .sort((a, b) => a.comparedTo(b));

  const out: D[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const y0 = payoffAt(legs, entryCash, x0);
    const y1 = payoffAt(legs, entryCash, x1);
    if (y0.isZero()) {
      out.push(x0);
      continue;
    }
    if (y0.isNegative() !== y1.isNegative() && !y1.isZero()) {
      // The payoff is piecewise linear between adjacent kinks, so this is exact.
      const t = y0.negated().div(y1.minus(y0));
      out.push(x0.plus(x1.minus(x0).times(t)));
    }
  }
  return out;
}

/**
 * Name the structure. DISPLAY AND POLICY ONLY — max loss is always the numeric
 * result of the lattice above, never derived from this label. If this classifier
 * says "CUSTOM_DEFINED_RISK" for something exotic, nothing breaks.
 */
export function classifyStructure(
  legs: LegSpec[],
  entryCash: D,
  distinctExpiries: string[]
): StructureKind {
  if (distinctExpiries.length > 1) return "UNDEFINED_RISK";

  const stock = legs.filter((l) => l.kind === "STOCK");
  const opts = legs.filter((l) => l.kind === "OPTION");

  if (opts.length === 0) {
    if (stock.length === 1 && stock[0].side === "BUY") return "LONG_STOCK";
    return "UNDEFINED_RISK"; // short stock — not permitted in this contest
  }

  const calls = opts.filter((l) => l.right === "CALL");
  const puts = opts.filter((l) => l.right === "PUT");
  const longs = opts.filter((l) => l.side === "BUY");
  const shorts = opts.filter((l) => l.side === "SELL");
  const isCredit = entryCash.isPositive() && !entryCash.isZero();

  if (opts.length === 1 && stock.length === 0 && shorts.length === 0) {
    return calls.length === 1 ? "LONG_CALL" : "LONG_PUT";
  }

  if (opts.length === 2 && stock.length === 0) {
    const sameRight = calls.length === 2 || puts.length === 2;
    if (sameRight && longs.length === 1 && shorts.length === 1) {
      return isCredit ? "VERTICAL_CREDIT" : "VERTICAL_DEBIT";
    }
    if (calls.length === 1 && puts.length === 1 && shorts.length === 0) {
      const sameStrike =
        calls[0].strike && puts[0].strike && calls[0].strike.eq(puts[0].strike);
      return sameStrike ? "STRADDLE" : "STRANGLE";
    }
  }

  if (opts.length === 3 && stock.length === 0 && shorts.length === 1) {
    const sameRight = calls.length === 3 || puts.length === 3;
    if (sameRight) return "BUTTERFLY";
  }

  if (opts.length === 4 && stock.length === 0 && calls.length === 2 && puts.length === 2) {
    const shortStrikes = shorts
      .map((l) => l.strike?.toString())
      .filter(Boolean);
    const uniqueShort = new Set(shortStrikes).size;
    if (shorts.length === 2 && longs.length === 2) {
      return uniqueShort === 1 ? "IRON_BUTTERFLY" : "IRON_CONDOR";
    }
  }

  return "CUSTOM_DEFINED_RISK";
}

// ------------------------------------------------------------ contest policy

export type PolicyViolation =
  | "SHORT_STOCK"
  | "UNCOVERED_SHORT_OPTION"
  | "STOCK_MIXED_WITH_OPTIONS";

/**
 * The contest's allowed-position rule: LONG STOCK, LONG OPTIONS, and
 * DEFINED-RISK SPREADS only.
 *
 * This is narrower than "definedRisk === true" from the lattice, and deliberately
 * so. A cash-secured put and a covered call both have a computable maximum loss,
 * but they were excluded from this contest: a CSP risks the whole strike to
 * collect a small credit, which distorts a small-account challenge, and a covered
 * call needs share-lot bookkeeping the sizing model does not do.
 *
 * The rule that captures it: every SHORT option leg must be covered by a LONG
 * option leg of the SAME RIGHT — i.e. shorts only ever exist inside a spread.
 * Stock may only be held on its own.
 *
 *   long call / put / straddle / strangle -> no shorts at all           OK
 *   vertical / condor / butterfly          -> longs cover shorts per right OK
 *   cash-secured put                       -> short put, no long put    REJECTED
 *   covered call / collar                  -> stock mixed with options  REJECTED
 *   short stock                            -> caught by the lattice too REJECTED
 *
 * Returns null when the structure is permitted.
 */
export function checkDefinedRiskPolicy(legs: LegSpec[]): PolicyViolation | null {
  const stock = legs.filter((l) => l.kind === "STOCK");
  const opts = legs.filter((l) => l.kind === "OPTION");

  if (stock.some((l) => l.side === "SELL")) return "SHORT_STOCK";
  if (stock.length > 0 && opts.length > 0) return "STOCK_MIXED_WITH_OPTIONS";

  for (const right of ["CALL", "PUT"] as const) {
    const ofRight = opts.filter((l) => l.right === right);
    const longQty = ofRight
      .filter((l) => l.side === "BUY")
      .reduce((n, l) => n + l.ratio, 0);
    const shortQty = ofRight
      .filter((l) => l.side === "SELL")
      .reduce((n, l) => n + l.ratio, 0);
    if (shortQty > longQty) return "UNCOVERED_SHORT_OPTION";
  }

  return null;
}

export function describePolicyViolation(v: PolicyViolation): string {
  switch (v) {
    case "SHORT_STOCK":
      return "Short stock is not allowed in this challenge — losses are unlimited.";
    case "UNCOVERED_SHORT_OPTION":
      return "A short option must be covered by a long option of the same type. Naked and cash-secured short options are not allowed in this challenge.";
    case "STOCK_MIXED_WITH_OPTIONS":
      return "Combine stock and options in separate positions. Covered calls and collars are not supported in this challenge.";
  }
}

/** Human label for a whole position, used for the feed, podium and stats. */
export function describeStructure(kind: StructureKind): string {
  const map: Record<StructureKind, string> = {
    LONG_STOCK: "Stock",
    LONG_CALL: "Long Call",
    LONG_PUT: "Long Put",
    VERTICAL_DEBIT: "Debit Spread",
    VERTICAL_CREDIT: "Credit Spread",
    STRADDLE: "Straddle",
    STRANGLE: "Strangle",
    BUTTERFLY: "Butterfly",
    IRON_CONDOR: "Iron Condor",
    IRON_BUTTERFLY: "Iron Butterfly",
    CUSTOM_DEFINED_RISK: "Multi-Leg",
    UNDEFINED_RISK: "Undefined Risk",
  };
  return map[kind];
}

export { OPTION_MULTIPLIER };
