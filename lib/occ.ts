/**
 * OCC option symbol builder and parser.
 *
 * Format (Polygon/Massive convention):
 *   O: + underlying + YYMMDD + C|P + strike*1000 zero-padded to 8
 *   O:NCLH221014C00005000  =  NCLH, 2022-10-14, call, $5.00
 *
 * This is the single most error-prone string in the app: a subtly wrong symbol
 * does not error, it just silently returns no quote — so a position stops marking
 * and the leaderboard is quietly wrong. There is exactly ONE implementation, it
 * is unit-tested with a round-trip property, and the SERVER ALWAYS REBUILDS the
 * symbol from the leg fields rather than trusting a client-supplied value.
 *
 * Pure — no Prisma, no I/O, safe on the client (the leg builder shows a preview).
 */
import { Decimal, dec } from "./money";

export type Right = "C" | "P";

export interface OccParts {
  underlying: string; // "NCLH"
  expiry: string; // "2022-10-14" — ET calendar date
  right: Right;
  strike: number;
}

const OCC_RE = /^O:([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function isOccTicker(t: string): boolean {
  return OCC_RE.test(t.trim().toUpperCase());
}

export function normalizeUnderlying(raw: string): string {
  // OCC roots are letters only. Strip the dots and dashes people type ("BRK.B").
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
}

export class OccError extends Error {}

export function buildOcc(p: OccParts): string {
  const u = normalizeUnderlying(p.underlying);
  if (u.length < 1 || u.length > 6) {
    throw new OccError(`Underlying "${p.underlying}" must be 1-6 letters.`);
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.expiry.trim());
  if (!m) throw new OccError(`Expiry "${p.expiry}" must be YYYY-MM-DD.`);
  const [, yyyy, mm, dd] = m;
  const year = Number(yyyy);
  if (year < 2000 || year > 2099) {
    // OCC symbology encodes only two year digits; there is no representation
    // outside this window, so fail loudly rather than emit an ambiguous symbol.
    throw new OccError(`Expiry year ${year} is outside the OCC 2000-2099 range.`);
  }
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) {
    throw new OccError(`Expiry "${p.expiry}" is not a real date.`);
  }

  if (p.right !== "C" && p.right !== "P") {
    throw new OccError(`Right must be "C" or "P".`);
  }

  // CRITICAL: strike*1000 through a float gives 4999.999999999999 for 5.0, which
  // truncates to a $4.999 strike and a symbol that matches nothing. Decimal only.
  const strike = dec(p.strike);
  if (!strike.isFinite() || strike.lte(0)) {
    throw new OccError(`Strike ${p.strike} must be a positive number.`);
  }
  const thousandths = strike
    .times(1000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0);
  if (thousandths.length > 8) {
    throw new OccError(`Strike ${p.strike} is too large for the OCC format.`);
  }

  return `O:${u}${yyyy.slice(2)}${mm}${dd}${p.right}${thousandths.padStart(8, "0")}`;
}

export function parseOcc(ticker: string): OccParts | null {
  const m = OCC_RE.exec(ticker.trim().toUpperCase());
  if (!m) return null;
  const [, u, yy, mm, dd, right, thousandths] = m;

  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject calendar-impossible dates (2026-02-30) that would otherwise roll over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  return {
    underlying: u,
    expiry: `${year}-${mm}-${dd}`,
    right: right as Right,
    strike: dec(thousandths).div(1000).toNumber(),
  };
}

/** Expiry as a UTC-midnight Date, matching a Prisma `@db.Date` column. */
export function occExpiryDate(ticker: string): Date | null {
  const p = parseOcc(ticker);
  if (!p) return null;
  const [y, m, d] = p.expiry.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Strike formatted the way traders write it: "5", "2.50", "782.50". */
export function formatStrike(strike: Decimal | number): string {
  const d = dec(strike);
  return d.eq(d.trunc()) ? d.toFixed(0) : d.toFixed(2).replace(/0$/, "");
}

/** "NCLH 10/14/22 $5 Call" — the human label for a single contract. */
export function describeOcc(ticker: string): string {
  const p = parseOcc(ticker);
  if (!p) return ticker;
  const [y, m, d] = p.expiry.split("-");
  return `${p.underlying} ${m}/${d}/${y.slice(2)} $${formatStrike(
    p.strike
  )} ${p.right === "C" ? "Call" : "Put"}`;
}

/** "10/14/22" — compact expiry for table cells. */
export function shortExpiry(expiry: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return expiry;
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}
