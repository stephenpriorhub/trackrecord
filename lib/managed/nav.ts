/**
 * NAV fallback for instruments the market-data provider cannot price.
 *
 * WHY THIS EXISTS
 *   Massive is Polygon-compatible and covers exchange-traded securities. It has
 *   nothing for interval and private funds — PRIVX (The Private Shares Fund) and
 *   ARKVX (ARK Venture Fund) come back as a row with no type, no name and no
 *   price, forever. Those are real positions in a live MTA portfolio, so without
 *   a second source their rows would read "—" permanently.
 *
 *   Nasdaq's public quote endpoint does cover them, free and without a key.
 *
 * WHAT THIS IS NOT
 *   Not a general price source. It runs ONLY for tickers the primary provider
 *   left unpriced, so it costs a handful of requests, and it is not a substitute
 *   for a paid feed.
 *
 * WHAT A NAV IS
 *   A once-a-day net asset value with its own date, not a delayed intraday
 *   print. It is stored as priceSource NAV and dated to the day Nasdaq reports,
 *   so the embed can say "as of <date>" rather than implying a live quote.
 *
 * FRAGILITY
 *   This is an undocumented public endpoint. Every failure is swallowed and
 *   reported; a position simply stays unpriced, which is the same honest outcome
 *   as before this file existed. It must never throw into the price job.
 */
import { dec, type D } from "../money";

const BASE = "https://api.nasdaq.com/api/quote";

/**
 * Asset classes to try, most likely first. The endpoint requires the class up
 * front and rejects the wrong one, so the working value is cached per instrument
 * (MarketInstrument.navAssetClass) and only a first-time lookup probes.
 */
export const NAV_ASSET_CLASSES = ["mutualfunds", "etf", "stocks"] as const;
export type NavAssetClass = (typeof NAV_ASSET_CLASSES)[number];

export interface NavQuote {
  ticker: string;
  price: D;
  /** The date Nasdaq reports the figure for — usually the previous session. */
  asOf: Date | null;
  name: string | null;
  assetClass: NavAssetClass;
}

function headers() {
  return {
    // The endpoint returns 403 to an unbranded client.
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
  };
}

/** "$51.05" / "51.05" / "N/A" -> Decimal or null. */
function parsePrice(raw: unknown): D | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "");
  if (!cleaned || cleaned.toUpperCase() === "N/A") return null;
  try {
    const d = dec(cleaned);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

/**
 * "Aug 21, 2026" -> a Date at UTC midnight.
 *
 * Deliberately date-only: a NAV has no meaningful time of day, and inventing one
 * would make the freshness line claim precision the figure does not have.
 */
function parseAsOf(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mi = months.indexOf(m[1]);
  if (mi < 0) return null;
  return new Date(Date.UTC(Number(m[3]), mi, Number(m[2])));
}

async function tryClass(
  ticker: string,
  assetClass: NavAssetClass,
): Promise<NavQuote | null> {
  const url = `${BASE}/${encodeURIComponent(ticker)}/info?assetclass=${assetClass}`;
  const res = await fetch(url, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    data?: {
      companyName?: string;
      primaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string };
    } | null;
  };
  // A wrong asset class returns 200 with data: null, so absence of data is the
  // signal to try the next class rather than an error.
  const data = body.data;
  if (!data) return null;

  const price = parsePrice(data.primaryData?.lastSalePrice);
  if (!price) return null;

  return {
    ticker,
    price,
    asOf: parseAsOf(data.primaryData?.lastTradeTimestamp),
    name: data.companyName ?? null,
    assetClass,
  };
}

/**
 * Look up one ticker. `knownClass` skips the probe when a previous run already
 * learned which class works.
 */
export async function fetchNav(
  ticker: string,
  knownClass?: string | null,
): Promise<NavQuote | null> {
  const order: NavAssetClass[] = knownClass
    ? [
        knownClass as NavAssetClass,
        ...NAV_ASSET_CLASSES.filter((c) => c !== knownClass),
      ]
    : [...NAV_ASSET_CLASSES];

  for (const cls of order) {
    try {
      const hit = await tryClass(ticker, cls);
      if (hit) return hit;
    } catch {
      // Network error, timeout, or a shape change. Try the next class; if they
      // all fail the caller leaves the instrument unpriced, which is correct.
    }
  }
  return null;
}

/**
 * An OCC option symbol is never a fund. Skipping them keeps the fallback from
 * spending three requests per contract discovering that.
 */
export function navEligible(ticker: string): boolean {
  if (ticker.startsWith("O:")) return false;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker);
}
