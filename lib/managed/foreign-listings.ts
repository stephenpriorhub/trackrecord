/**
 * US over-the-counter lines priced from their HOME market.
 *
 * WHY
 *   An OTC "F"-share like Samsung's SSNLF can go months without a trade, so
 *   Massive's latest print for it was 2026-05-04 — and the embed published a
 *   return and a "last updated" date from May. The same share trades every
 *   day in Seoul. Its home close converted to dollars IS its current price.
 *
 *   Stephen, 2026-09-29: keep SSNLF, price it currently.
 *
 * SOURCES (both free, no key, verified 2026-09-29)
 *   - Naver Finance: m.stock.naver.com/api/stock/<code>/basic -> closePrice
 *     "275,000", localTradedAt (KST). Needs a browser User-Agent.
 *   - Frankfurter (ECB reference rates): api.frankfurter.dev/v1/latest
 *     ?base=USD&symbols=KRW -> 1357.93.
 *   Either failing means NO price this run (the previous one stays, and the
 *   stale rule in price-freshness.ts takes over if it ages) — never a guess.
 */
import { dec, type D } from "../money";

export const HOME_LISTINGS: Record<string, { market: "KRX"; code: string; currency: "KRW"; ratio: number }> = {
  // One SSNLF = one Samsung Electronics common share (KRX 005930).
  SSNLF: { market: "KRX", code: "005930", currency: "KRW", ratio: 1 },
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function krxClose(code: string): Promise<{ price: D; asOf: Date | null } | null> {
  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`, {
      headers: { "user-agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as { closePrice?: string; localTradedAt?: string };
    const n = Number(String(b.closePrice ?? "").replace(/,/g, ""));
    if (!(n > 0)) return null;
    const at = b.localTradedAt ? new Date(b.localTradedAt) : null;
    return { price: dec(n), asOf: at && !Number.isNaN(at.getTime()) ? at : null };
  } catch {
    return null;
  }
}

async function usdRate(currency: string): Promise<D | null> {
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${encodeURIComponent(currency)}`,
      { cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const b = (await res.json()) as { rates?: Record<string, number> };
    const r = b.rates?.[currency];
    return typeof r === "number" && r > 0 ? dec(r) : null;
  } catch {
    return null;
  }
}

/** The ticker's price in USD from its home market, or null. */
export async function fetchHomeListingPrice(
  ticker: string,
): Promise<{ price: D; asOf: Date | null } | null> {
  const home = HOME_LISTINGS[ticker.toUpperCase()];
  if (!home) return null;
  const [close, rate] = await Promise.all([krxClose(home.code), usdRate(home.currency)]);
  if (!close || !rate) return null;
  return { price: close.price.times(home.ratio).div(rate), asOf: close.asOf };
}
