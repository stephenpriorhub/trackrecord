/**
 * Toronto quotes from TMX Money — the exchange's own public quote service.
 *
 * Massive covers US exchanges only, so a TSX listing like Stella-Jones
 * (SJ.TO) never priced and its return read "—". TMX answers for any TSX /
 * TSX Venture symbol, free and without a key; verified 2026-09-29: SJ ->
 * { price: 69.73, exchangeCode: "TSX", datetime }. An unknown symbol returns
 * data: null with an error, which is treated as "no price", never zero.
 *
 * Prices are in the listing's currency (CAD). Entry prices for these holdings
 * are recorded in the same currency, so the return is like for like.
 */
import { dec, type D } from "../money";
import { closeInstant } from "./closing-prices";

const ENDPOINT = "https://app-money.tmx.com/graphql";
const QUERY =
  "query getQuoteBySymbol($symbol: String, $locale: String) { getQuoteBySymbol(symbol: $symbol, locale: $locale) { symbol price prevClose datetime exchangeCode } }";

/** Our tickers for Toronto listings: SJ.TO (TSX) and XYZ.V (TSX Venture). */
export function isTorontoTicker(ticker: string): boolean {
  return /\.(TO|V)$/i.test(ticker);
}

/**
 * The close for `session` (YYYY-MM-DD, New York). TSX closes at 4:00 PM ET
 * like the US markets: a quote stamped after that session is a later day, so
 * its prevClose is the session's close; one stamped on the session day is
 * that day's close itself.
 */
export async function fetchTmxQuote(
  ticker: string,
  session?: string,
): Promise<{ price: D; asOf: Date | null } | null> {
  const symbol = ticker.replace(/\.(TO|V)$/i, "");
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://money.tmx.com",
        // Like the Nasdaq NAV source, it refuses requests without a browser UA.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
      body: JSON.stringify({
        operationName: "getQuoteBySymbol",
        variables: { symbol, locale: "en" },
        query: QUERY,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        getQuoteBySymbol?: {
          price?: number | null;
          prevClose?: number | null;
          datetime?: string | null;
        } | null;
      };
    };
    const q = body.data?.getQuoteBySymbol;
    if (!q || typeof q.price !== "number" || !(q.price > 0)) return null;
    const asOf = q.datetime ? new Date(q.datetime) : null;
    const valid = asOf && !Number.isNaN(asOf.getTime()) ? asOf : null;
    if (session) {
      // TMX's datetime is the REQUEST time, not the trade time (verified
      // 2026-09-29: 07:02 pre-open and 12:41 intraday both stamped "now"). What
      // decides which field holds the session close is whether TSX has opened
      // today: before the 9:30 ET open (or on a weekend) `price` is still the
      // last close; once open, `price` is live and `prevClose` is the last close.
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const weekend = get("weekday") === "Sat" || get("weekday") === "Sun";
      const minutes = Number(get("hour")) * 60 + Number(get("minute"));
      const openedToday = !weekend && minutes >= 9 * 60 + 30;
      const value = openedToday ? q.prevClose : q.price;
      return typeof value === "number" && value > 0
        ? { price: dec(value), asOf: closeInstant(session) }
        : null;
    }
    return { price: dec(q.price), asOf: valid };
  } catch {
    return null;
  }
}
