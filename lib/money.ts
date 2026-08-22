/**
 * Money arithmetic. Pure — no Prisma, no I/O, safe on the client.
 *
 * WHY DECIMAL AND NOT FLOAT: the cash model is a hard block, so "cash can never
 * go negative" has to be a provable invariant rather than an approximation.
 * Under IEEE floats, a trade that consumes exactly the remaining cash can be
 * rejected on a +1e-13 residual, or can leave a -1e-13 balance that renders as
 * "-$0.00" on a public leaderboard. Neither is acceptable in a contest people
 * are watching. Decimal also makes strike*1000 exact for OCC symbols, where
 * `5.0 * 1000` gives 4999.999999999999 in float.
 *
 * TWO RULES, enforced by convention:
 *   1. NEVER round in intermediate math. Round only for display, only via
 *      money() / pctDisplay().
 *   2. A Decimal NEVER crosses the JSON boundary as an object. API routes
 *      serialize with toJson() (a string); the UI parses.
 */
import Decimal from "decimal.js";

// 40 significant digits is far more than any contest needs and leaves plenty of
// headroom for chained division. ROUND_HALF_EVEN (banker's rounding) avoids the
// upward bias that ROUND_HALF_UP introduces when averaging many rounded values.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
export type D = Decimal;

/** Construct a Decimal. Accepts string | number | Decimal. */
export const dec = (v: Decimal.Value): D => new Decimal(v);

export const ZERO: D = new Decimal(0);
export const ONE: D = new Decimal(1);
export const HUNDRED: D = new Decimal(100);

/** Option contract multiplier. Stock legs use 1. */
export const OPTION_MULTIPLIER = 100;

export function sum(xs: D[]): D {
  return xs.reduce<D>((a, b) => a.plus(b), ZERO);
}

export function minOf(xs: D[]): D {
  if (xs.length === 0) throw new Error("minOf: empty");
  return xs.reduce((a, b) => (b.lt(a) ? b : a));
}

export function maxOf(xs: D[]): D {
  if (xs.length === 0) throw new Error("maxOf: empty");
  return xs.reduce((a, b) => (b.gt(a) ? b : a));
}

export const isZero = (v: D): boolean => v.isZero();
export const isNeg = (v: D): boolean => v.isNegative() && !v.isZero();
export const isPos = (v: D): boolean => v.isPositive() && !v.isZero();

/**
 * Integer division, floored. THE derive-quantity primitive: flooring is what
 * guarantees the derived position can always be paid for in full, with the
 * remainder left as cash. Returns 0 when the divisor is zero or negative rather
 * than throwing — callers (lib/sizing.ts) reject those cases with a specific
 * error code, and a thrown exception there would be less informative.
 */
export function floorDiv(a: D, b: D): number {
  if (b.lte(0)) return 0;
  return a.div(b).floor().toNumber();
}

/** Round to cents. DISPLAY ONLY — never feed this back into further math. */
export function money(v: D): D {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/**
 * A fraction (part/whole), or null when the denominator is zero. Returning null
 * rather than NaN/Infinity forces every caller to decide what "no denominator"
 * means, instead of letting a NaN leak onto a public page as "NaN%".
 */
export function fraction(part: D, whole: D): D | null {
  if (whole.isZero()) return null;
  return part.div(whole);
}

/** Arithmetic mean, or null for an empty set. */
export function mean(xs: D[]): D | null {
  if (xs.length === 0) return null;
  return sum(xs).div(xs.length);
}

/**
 * Weighted mean of values by weights. Weights of zero fall back to equal
 * weighting for that item (mirroring trackrecord's buying-power-weighted
 * convention, where a missing buying-power figure weights as 1).
 */
export function weightedMean(
  pairs: { value: D; weight: D }[]
): D | null {
  if (pairs.length === 0) return null;
  let num = ZERO;
  let den = ZERO;
  for (const { value, weight } of pairs) {
    const w = weight.gt(0) ? weight : ONE;
    num = num.plus(value.times(w));
    den = den.plus(w);
  }
  if (den.isZero()) return null;
  return num.div(den);
}

// ---------------------------------------------------------------- boundaries

/** Decimal -> string, for JSON responses. Never send the object. */
export function toJson(v: D | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toString();
}

/** Parse a user-supplied money/price string. Returns null if not a finite number. */
export function parseDecimal(v: unknown): D | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Decimal) return v.isFinite() ? v : null;
  const s = typeof v === "string" ? v.replace(/[$,\s]/g, "") : v;
  try {
    const d = new Decimal(s as Decimal.Value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- formatting

/** "$1,234.56" / "-$1,234.56". */
export function formatMoney(v: D | null | undefined, opts?: { sign?: boolean }): string {
  if (v === null || v === undefined) return "—";
  const r = money(v);
  const neg = r.isNegative();
  const abs = r.abs().toFixed(2);
  const withCommas = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (neg) return `-$${withCommas}`;
  return opts?.sign ? `+$${withCommas}` : `$${withCommas}`;
}

/**
 * A stored FRACTION rendered as a percent: 0.1234 -> "+12.34%".
 * Percentages are stored as fractions everywhere in this app; converting at the
 * display boundary is the only place the x100 happens.
 */
export function formatPct(
  v: D | null | undefined,
  opts?: { sign?: boolean; dp?: number }
): string {
  if (v === null || v === undefined) return "—";
  const dp = opts?.dp ?? 2;
  const p = v.times(HUNDRED).toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN);
  const s = p.toFixed(dp);
  return opts?.sign && p.gte(0) ? `+${s}%` : `${s}%`;
}

/** CSS class for a signed figure. Brand green never renders a negative. */
export function signClass(v: D | null | undefined): "gain" | "loss" | "dim" {
  if (v === null || v === undefined || v.isZero()) return "dim";
  return v.isPositive() ? "gain" : "loss";
}
