/**
 * One trade as read from a sheet, before it is stored. Every parser produces
 * exactly this, so sync, stats and the UI never learn a sheet's layout.
 */
export type AssetType = "OPTION" | "STOCK";
export type Structure =
  | "SINGLE" // one option contract
  | "SPREAD" // vertical/calendar/diagonal
  | "BUTTERFLY"
  | "STRANGLE"
  | "PUT_SELL"
  | "STOCK";

export interface ParsedTrade {
  serviceCode: string;
  tab: string;
  row: number;
  portfolio: string; // sub-portfolio key from ServiceDef.subPortfolios, or "main"
  guru: string | null; // "Bryan Bottarelli" etc.
  name: string; // what a reader sees: "AAPL $347.50 Call · exp 10/23/26"
  symbol: string; // as written: OCC, comma-joined OCCs, or a stock ticker
  underlying: string;
  assetType: AssetType;
  structure: Structure;
  optionType: "CALL" | "PUT" | null;
  strike: string | null; // "347.50" or "205 / 220"
  expiry: string | null; // YYYY-MM-DD
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  openDate: string; // YYYY-MM-DD
  closeDate: string | null;
  /** Closed after the 4pm bell (option expirations are stamped in the evening). */
  closeAfterBell: boolean;
  entryPrice: number | null;
  exitPrice: number | null;
  /** Fraction (0.25 = +25%), exactly as the sheet published it. */
  returnPct: number | null;
  weight: number;
  premiumCapture: number | null;
  holdDays: number | null;
  notes: string | null;
}

export interface ParseResult {
  trades: ParsedTrade[];
  skipped: { tab: string; row: number; symbol: string; reason: string }[];
}

const OCC_RE = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d+)$/;

export interface Occ {
  underlying: string;
  expiry: string;
  right: "CALL" | "PUT";
  strike: number;
}

/** Sheet OCC symbol (no "O:" prefix; strike zero-padded or not) -> contract. */
export function parseSheetOcc(sym: string): Occ | null {
  const m = OCC_RE.exec(sym.trim().toUpperCase().replace(/^O:/, ""));
  if (!m) return null;
  const [, u, yy, mm, dd, r, k] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    underlying: u,
    expiry: `20${yy}-${mm}-${dd}`,
    right: r === "C" ? "CALL" : "PUT",
    strike: Number(k) / 1000,
  };
}

export function fmtStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

const STRUCTURE_WORD: Partial<Record<Structure, string>> = {
  SPREAD: "Spread",
  BUTTERFLY: "Butterfly",
  STRANGLE: "Strangle",
};

/** "AAPL $347.50 Call · exp 10/23/26", "TSLA $205 / $220 Call Spread", "CLF $7 Put (sold)". */
export function describe(t: {
  underlying: string;
  assetType: AssetType;
  structure: Structure;
  optionType: "CALL" | "PUT" | null;
  strike: string | null;
  expiry: string | null;
}): string {
  if (t.assetType === "STOCK") return `${t.underlying} shares`;
  const parts = [t.underlying];
  if (t.strike) parts.push(t.strike.split(" / ").map((s) => `$${s}`).join(" / "));
  if (t.structure === "STRANGLE") parts.push("Strangle");
  else {
    if (t.optionType) parts.push(t.optionType === "CALL" ? "Call" : "Put");
    else parts.push("Option");
    const w = STRUCTURE_WORD[t.structure];
    if (w) parts.push(w);
  }
  if (t.structure === "PUT_SELL") parts.push("(sold)");
  let s = parts.join(" ");
  if (t.expiry) s += ` · exp ${shortDate(t.expiry)}`;
  return s;
}

/** Calendar days between two YYYY-MM-DD dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
