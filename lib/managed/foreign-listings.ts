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
import { closeInstant } from "./closing-prices";

export const HOME_LISTINGS: Record<string, { market: "KRX"; code: string; currency: "KRW"; ratio: number }> = {
  // One SSNLF = one Samsung Electronics common share (KRX 005930).
  SSNLF: { market: "KRX", code: "005930", currency: "KRW", ratio: 1 },
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/**
 * The KRX close for the last Seoul session on or before `session` (a New York
 * date). Seoul is 13-14 hours ahead, so its session dated D closed before New
 * York's D close — the latest one "on or before D" is the one a reader of the
 * D close would have had.
 */
async function krxClose(code: string, session?: string): Promise<{ price: D; asOf: Date | null } | null> {
  try {
    if (session) {
      const res = await fetch(
        `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=15&page=1`,
        { headers: { "user-agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as { localTradedAt?: string; closePrice?: string }[];
      const pick = rows
        .filter((r) => r.localTradedAt && r.localTradedAt.slice(0, 10) <= session)
        .sort((x, y) => (x.localTradedAt! < y.localTradedAt! ? 1 : -1))[0];
      const n = Number(String(pick?.closePrice ?? "").replace(/,/g, ""));
      return n > 0 ? { price: dec(n), asOf: new Date(pick!.localTradedAt!) } : null;
    }
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

/** USD rate for a currency; for `session`, that day's reference rate (or the prior business day's). */
async function usdRate(currency: string, session?: string): Promise<D | null> {
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/${session ?? "latest"}?base=USD&symbols=${encodeURIComponent(currency)}`,
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
  session?: string,
): Promise<{ price: D; asOf: Date | null } | null> {
  const home = HOME_LISTINGS[ticker.toUpperCase()];
  if (!home) return null;
  const [close, rate] = await Promise.all([
    krxClose(home.code, session),
    usdRate(home.currency, session),
  ]);
  if (!close || !rate) return null;
  return {
    price: close.price.times(home.ratio).div(rate),
    // Stamped as the New York session it stands for, like every other close.
    asOf: session ? closeInstant(session) : close.asOf,
  };
}
