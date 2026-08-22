/**
 * Massive market-data client (Polygon.io-compatible).
 *
 * THE ONE ENDPOINT THAT MATTERS:
 *   GET /v3/snapshot?ticker.any_of=<up to 250 tickers>
 * It prices STOCKS AND OPTIONS TOGETHER in a single call, so the entire contest
 * costs one request. Everything here is built around that.
 *
 * PLAN LIMITS, verified against the live key rather than assumed:
 *   - Options Developer tier => data is delayed at least 15 minutes.
 *   - There is NO bid/ask entitlement. `GET /v3/quotes/...` returns
 *     403 NOT_AUTHORIZED and no `last_quote` object appears anywhere in a
 *     snapshot response. So mid-price marking is impossible and every price here
 *     is last-trade based. See lib/marks.ts for the ladder.
 *
 * RESPONSE SHAPE QUIRK, also verified: stocks carry `session.price` (the current
 * delayed price) while OPTIONS DO NOT — an option's latest price lives in
 * `session.close`. Getting that backwards yields a stale or absent price with no
 * error, so normalizeRow() handles them differently on purpose.
 *
 * An illiquid contract can come back with `session` almost entirely empty. That
 * is a real "no price", never a zero.
 */
import { D, dec } from "./money";

const DEFAULT_BASE = "https://api.massive.com";
/** The documented ceiling for ticker.any_of. */
export const MAX_TICKERS_PER_CALL = 250;

function base(): string {
  return (process.env.MASSIVE_BASE ?? DEFAULT_BASE).replace(/\/+$/, "");
}
function apiKey(): string | undefined {
  return process.env.MASSIVE_API_KEY;
}
function timeoutMs(): number {
  return Number(process.env.MASSIVE_TIMEOUT_MS ?? 15000);
}

export function isMassiveConfigured(): boolean {
  return !!apiKey();
}

export function marketDataDelayMinutes(): number {
  return Number(process.env.NEXT_PUBLIC_MARKET_DATA_DELAY_MINUTES ?? 15);
}

export class RateLimitedError extends Error {
  readonly rateLimited = true;
  constructor(readonly retryAfterSeconds?: number) {
    super("Massive rate limit reached.");
    this.name = "RateLimitedError";
  }
}

// ------------------------------------------------------------ normalized row

export interface SnapshotRow {
  ticker: string;
  kind: "STOCK" | "OPTION" | "OTHER";
  name: string | null;
  /** Latest price available: session.price for stocks, session.close for options. */
  last: D | null;
  prevClose: D | null;
  open: D | null;
  high: D | null;
  low: D | null;
  volume: D | null;
  change: D | null;
  changePct: D | null;
  /** Options only. */
  impliedVol: D | null;
  delta: D | null;
  openInterest: number | null;
  breakEven: D | null;
  /** The option's underlying price, when the row is an option. */
  underlyingPrice: D | null;
  underlyingTicker: string | null;
  /** The provider's own timestamp — the true age of the data, not our fetch time. */
  providerAsOf: Date | null;
  /** True when the provider labels the print DELAYED. */
  delayed: boolean | null;
  marketStatus: string | null;
}

/** Massive timestamps are epoch NANOSECONDS. */
function nsToDate(ns: unknown): Date | null {
  const n = typeof ns === "number" ? ns : Number(ns);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n / 1e6);
}

function num(v: unknown): D | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return dec(n);
}

function positive(v: D | null): D | null {
  return v && v.gt(0) ? v : null;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});

export function normalizeRow(raw: Raw): SnapshotRow | null {
  const ticker = typeof raw.ticker === "string" ? raw.ticker.toUpperCase() : null;
  if (!ticker) return null;

  const type = typeof raw.type === "string" ? raw.type : "";
  const kind: SnapshotRow["kind"] =
    type === "options" ? "OPTION" : type === "stocks" ? "STOCK" : "OTHER";

  const session = obj(raw.session);
  const lastTrade = obj(raw.last_trade);
  const greeks = obj(raw.greeks);
  const underlying = obj(raw.underlying_asset);

  // The quirk this whole file exists to encapsulate.
  const last =
    kind === "OPTION"
      ? positive(num(session.close)) ?? positive(num(lastTrade.price))
      : positive(num(session.price)) ??
        positive(num(lastTrade.price)) ??
        positive(num(session.close));

  return {
    ticker,
    kind,
    name: typeof raw.name === "string" ? raw.name : null,
    last,
    prevClose: positive(num(session.previous_close)),
    open: positive(num(session.open)),
    high: positive(num(session.high)),
    low: positive(num(session.low)),
    volume: num(session.volume),
    change: num(session.change),
    // The provider reports percent; this app stores fractions everywhere.
    changePct: num(session.change_percent)?.div(100) ?? null,
    impliedVol: num(raw.implied_volatility),
    delta: num(greeks.delta),
    openInterest:
      raw.open_interest !== undefined && raw.open_interest !== null
        ? Number(raw.open_interest)
        : null,
    breakEven: num(raw.break_even_price),
    underlyingPrice: positive(num(underlying.price)),
    underlyingTicker: typeof underlying.ticker === "string" ? underlying.ticker : null,
    // THE HONEST DATA AGE, and the ordering here is load-bearing.
    //
    // `session.last_updated` is the moment the provider ASSEMBLED the snapshot —
    // effectively wall-clock now. `last_trade.last_updated` is when the trade
    // actually printed, and on this plan it is exactly 900 seconds earlier with
    // `timeframe: "DELAYED"`. Preferring session.last_updated would make every
    // "prices as of" on the public site claim the data was current when it is 15
    // minutes old. Verified against the live API, not assumed.
    providerAsOf:
      nsToDate(lastTrade.last_updated) ??
      nsToDate(underlying.last_updated) ??
      nsToDate(session.last_updated),
    /** True when the provider itself labels the print as delayed. */
    delayed:
      typeof lastTrade.timeframe === "string"
        ? lastTrade.timeframe.toUpperCase() === "DELAYED"
        : null,
    marketStatus: typeof raw.market_status === "string" ? raw.market_status : null,
  };
}

// ------------------------------------------------------------ fetching

export interface SnapshotResult {
  rows: Map<string, SnapshotRow>;
  /** Requested but absent from the response — NOT the same as priced at zero. */
  missing: string[];
  apiCalls: number;
  errors: { batch: string[]; message: string; rateLimited: boolean }[];
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(tickers: string[], attempt = 0): Promise<Raw[]> {
  const key = apiKey();
  if (!key) throw new Error("MASSIVE_API_KEY is not set.");

  const url =
    `${base()}/v3/snapshot` +
    `?ticker.any_of=${encodeURIComponent(tickers.join(","))}` +
    `&limit=${MAX_TICKERS_PER_CALL}` +
    `&apiKey=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    // The key is sent both ways, matching the convention already proven in
    // mtarix/lib/massive.ts.
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    if (attempt >= 2) throw new RateLimitedError(retryAfter);
    // Jittered backoff: 1s, 3s. Retry-After wins when the server sends one.
    const waitMs = retryAfter
      ? retryAfter * 1000
      : (attempt === 0 ? 1000 : 3000) + Math.floor(Math.random() * 400);
    await sleep(waitMs);
    return fetchBatch(tickers, attempt + 1);
  }

  if (res.status === 403) {
    throw new Error(
      "Massive returned 403 — the API key is not entitled to this data. Check the plan."
    );
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status >= 500 && attempt < 1) {
      await sleep(1200);
      return fetchBatch(tickers, attempt + 1);
    }
    throw new Error(`Massive ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { results?: unknown };
  return Array.isArray(data.results) ? (data.results as Raw[]) : [];
}

/**
 * Price any mix of stock and option tickers.
 *
 * Batches sequentially rather than in parallel: the whole contest is one or two
 * calls, so there is nothing to gain from concurrency and sequential is
 * rate-limit-safe. A failing batch degrades only its own tickers — it never
 * throws, so one bad batch cannot blank the entire leaderboard.
 */
export async function fetchSnapshots(tickers: string[]): Promise<SnapshotResult> {
  const wanted = Array.from(
    new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))
  );

  const result: SnapshotResult = {
    rows: new Map(),
    missing: [],
    apiCalls: 0,
    errors: [],
  };
  if (wanted.length === 0) return result;

  for (const batch of chunk(wanted, MAX_TICKERS_PER_CALL)) {
    try {
      const raws = await fetchBatch(batch);
      result.apiCalls++;
      for (const raw of raws) {
        const row = normalizeRow(raw);
        if (row) result.rows.set(row.ticker, row);
      }
    } catch (e) {
      const rateLimited = e instanceof RateLimitedError;
      result.errors.push({
        batch,
        message: (e as Error).message,
        rateLimited,
      });
      // Stop early on a rate limit and let the next run converge, rather than
      // hammering through the remaining batches.
      if (rateLimited) break;
    }
    await sleep(150);
  }

  for (const t of wanted) if (!result.rows.has(t)) result.missing.push(t);
  return result;
}

/** One contract, with greeks and open interest. Used by the entry-form lookup. */
export async function fetchOne(ticker: string): Promise<SnapshotRow | null> {
  const r = await fetchSnapshots([ticker]);
  return r.rows.get(ticker.trim().toUpperCase()) ?? null;
}
