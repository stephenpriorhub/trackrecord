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

const ENDPOINT = "https://app-money.tmx.com/graphql";
const QUERY =
  "query getQuoteBySymbol($symbol: String, $locale: String) { getQuoteBySymbol(symbol: $symbol, locale: $locale) { symbol price datetime exchangeCode } }";

/** Our tickers for Toronto listings: SJ.TO (TSX) and XYZ.V (TSX Venture). */
export function isTorontoTicker(ticker: string): boolean {
  return /\.(TO|V)$/i.test(ticker);
}

export async function fetchTmxQuote(
  ticker: string,
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
      data?: { getQuoteBySymbol?: { price?: number | null; datetime?: string | null } | null };
    };
    const q = body.data?.getQuoteBySymbol;
    if (!q || typeof q.price !== "number" || !(q.price > 0)) return null;
    const asOf = q.datetime ? new Date(q.datetime) : null;
    return { price: dec(q.price), asOf: asOf && !Number.isNaN(asOf.getTime()) ? asOf : null };
  } catch {
    return null;
  }
}
