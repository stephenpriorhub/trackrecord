/**
 * Reading a portfolio for public display.
 *
 * Everything the embed renders is computed here so the page component stays a
 * table. Two rules the embed depends on:
 *
 *   - A missing price is "—", never 0 and never a return of -100%. An illiquid
 *     option contract must not publish a total loss.
 *   - The "last updated" stamp is the OLDEST provider timestamp among the
 *     instruments this portfolio actually uses, so the line is a promise that
 *     everything on the page is at least that fresh.
 */
import { prisma } from "../prisma";
import { dec, ZERO, type D } from "../money";

export type ShowMode = "open" | "closed" | "both";

export interface EmbedOptions {
  show: ShowMode;
  /** false hides every % figure, leaving prices only. */
  returns: boolean;
  comments: boolean;
}

/** Parse the embed's query string. Defaults show everything. */
export function parseEmbedOptions(
  sp: Record<string, string | string[] | undefined>,
): EmbedOptions {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const show = one(sp.show);
  const off = (v: string | undefined) =>
    v === "0" || v === "false" || v === "no";
  return {
    show: show === "open" || show === "closed" ? show : "both",
    returns: !off(one(sp.returns)),
    comments: !off(one(sp.comments)),
  };
}

export interface EmbedRow {
  id: string;
  label: string;
  ticker: string;
  companyName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  entryPrice: D | null;
  currentPrice: D | null;
  returnPct: D | null;
  buyUpTo: D | null;
  stopLoss: D | null;
  /** Whole days between open and close, for the Time Held column. */
  daysHeld: number | null;
  unpriced: boolean;
  comment: string | null;
}

export interface EmbedView {
  portfolio: {
    id: string;
    name: string;
    slug: string;
    benchmarkTicker: string;
  };
  serviceName: string;
  open: EmbedRow[];
  closed: EmbedRow[];
  /** Equal-weighted mean return across the rows shown. */
  portfolioReturn: D | null;
  benchmarkReturn: D | null;
  priceAsOf: Date | null;
  /**
   * Which kinds of price the shown positions actually lean on. The freshness
   * line is built from this, because "delayed 15 minutes" is true of an
   * exchange print and false of a once-a-day fund NAV, and saying it of both
   * would overstate one of them.
   */
  priceSources: string[];
  options: EmbedOptions;
}

function d(v: unknown): D | null {
  return v === null || v === undefined ? null : dec(v.toString());
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

/**
 * Equal-weighted mean of the returns present.
 *
 * Equal weighting is right for a model portfolio: each recommendation is one
 * idea, and there are no real position sizes to weight by. Rows without a return
 * (unpriced) are EXCLUDED rather than counted as zero, which would drag the
 * average toward nothing whenever a contract goes quiet.
 */
function meanReturn(rows: EmbedRow[]): D | null {
  const present = rows
    .map((r) => r.returnPct)
    .filter((v): v is D => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a.plus(b), ZERO).div(present.length);
}

export async function loadEmbedView(
  slug: string,
  options: EmbedOptions,
): Promise<EmbedView | null> {
  const portfolio = await prisma.managedPortfolio.findUnique({
    where: { slug },
    include: {
      service: { select: { name: true } },
      positions: {
        where: { deletedAt: null },
        orderBy: [{ status: "asc" }, { openedAt: "desc" }],
        include: {
          legs: {
            orderBy: { legIndex: "asc" },
            include: {
              instrument: {
                select: {
                  lastPrice: true,
                  lastPriceAt: true,
                  priceSource: true,
                },
              },
            },
          },
          comments: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          // Each exit is reported on its own line (see closedRowsFor), so a
          // position scaled out in halves shows two results, not one blend.
          executions: {
            where: { intent: "CLOSE", deletedAt: null },
            orderBy: { executedAt: "asc" },
            include: {
              fills: { where: { deletedAt: null }, include: { leg: true } },
              comments: {
                where: { deletedAt: null },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  // A private or archived portfolio is indistinguishable from a wrong slug.
  if (!portfolio || portfolio.visibility !== "PUBLIC" || portfolio.archivedAt)
    return null;

  const open: EmbedRow[] = [];
  const closed: EmbedRow[] = [];

  for (const p of portfolio.positions) {
    const single = p.legs.length === 1 ? p.legs[0] : null;
    const base = {
      // A single-leg position shows its plain ticker (matching the mockup's
      // "$PRIVX"); a spread shows its built label, since no one ticker
      // describes it.
      ticker: single ? p.underlying : p.label,
      label: p.label,
      companyName: p.companyName,
      openedAt: p.openedAt,
      entryPrice: d(p.cachedEntryPrice),
      buyUpTo: d(p.buyUpToPrice),
      stopLoss: d(p.stopLossPrice),
    };

    // Anything still open is one row, marked at the current price.
    const stillOpen = p.legs.some((l) => l.openQty > 0);
    if (stillOpen) {
      open.push({
        ...base,
        id: p.id,
        closedAt: null,
        currentPrice: d(p.cachedCurrentPrice),
        returnPct: d(p.cachedReturnPct),
        daysHeld: null,
        unpriced: p.cachedUnpriced,
        comment: p.comments[0]?.body ?? null,
      });
    }

    // EVERY exit gets its own row. A position scaled out in halves was two
    // decisions with two results, and that is how these portfolios are
    // published — see the two DXYZ lines in the reference design. Blending them
    // into one average would hide both.
    for (const exec of p.executions) {
      const exitPrice = netExitPrice(exec.fills);
      const entry = d(p.cachedEntryPrice);
      const returnPct =
        exitPrice && entry && !entry.isZero()
          ? exitPrice.minus(entry).div(entry.abs())
          : null;

      closed.push({
        ...base,
        id: exec.id,
        closedAt: exec.executedAt,
        currentPrice: exitPrice,
        returnPct,
        daysHeld: daysBetween(p.openedAt, exec.executedAt),
        unpriced: exitPrice === null,
        comment:
          exec.comments[0]?.body ?? exec.note ?? p.comments[0]?.body ?? null,
      });
    }
  }

  // Newest exits first, matching how the open table is ordered.
  closed.sort(
    (a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0),
  );

  // The headline compares like with like: whatever the reader can actually see.
  const shown =
    options.show === "open"
      ? open
      : options.show === "closed"
        ? closed
        : [...open, ...closed];

  const benchmark = await prisma.marketInstrument.findUnique({
    where: { ticker: portfolio.benchmarkTicker },
    select: { lastPrice: true, prevClose: true },
  });

  // Benchmark move on the same data the positions are priced from. Session change
  // only — a like-for-like since-inception benchmark needs a historical bar the
  // current Massive plan does not provide, and inventing one would be worse than
  // showing none.
  let benchmarkReturn: D | null = null;
  const bLast = d(benchmark?.lastPrice);
  const bPrev = d(benchmark?.prevClose);
  if (bLast && bPrev && !bPrev.isZero()) {
    benchmarkReturn = bLast.minus(bPrev).div(bPrev);
  }

  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      slug: portfolio.slug,
      benchmarkTicker: portfolio.benchmarkTicker,
    },
    serviceName: portfolio.service.name,
    open,
    closed,
    portfolioReturn: meanReturn(shown),
    benchmarkReturn,
    priceAsOf: oldestPriceAt(portfolio.positions),
    priceSources: [
      ...new Set(
        portfolio.positions
          .filter((p) => p.status === "OPEN")
          .flatMap((p) =>
            p.legs
              .filter((l) => l.openQty > 0 && l.instrument.lastPrice !== null)
              .map((l) => l.instrument.priceSource as string),
          ),
      ),
    ],
    options,
  };
}

/**
 * The net price this exit was done at, signed by each leg's OPENING direction so
 * it is comparable with the position's entry basis: closing a long is a credit
 * in, closing a short is a debit out, and a spread nets to one number.
 */
function netExitPrice(
  fills: {
    price: unknown;
    quantity: number;
    leg: { side: string; ratio: number };
  }[],
): D | null {
  if (fills.length === 0) return null;
  let total = ZERO;
  for (const f of fills) {
    const price = d(f.price);
    if (!price) return null;
    const sign = f.leg.side === "BUY" ? 1 : -1;
    // PER UNIT, not per contract: the entry basis is also per unit, so a partial
    // exit of 1 of 4 compares correctly instead of looking a quarter the size.
    const ratio = f.leg.ratio > 0 ? f.leg.ratio : 1;
    total = total.plus(price.times(sign).times(ratio));
  }
  return total;
}

/**
 * Oldest provider timestamp across the open legs actually shown. Oldest, not
 * newest: the stamp is a promise that everything on the page is at least that
 * fresh. Null when nothing carries a timestamp (an all-options portfolio).
 */
function oldestPriceAt(
  positions: {
    status: string;
    legs: { openQty: number; instrument: { lastPriceAt: Date | null } }[];
  }[],
): Date | null {
  let oldest: Date | null = null;
  for (const p of positions) {
    if (p.status !== "OPEN") continue;
    for (const leg of p.legs) {
      if (leg.openQty <= 0) continue;
      const at = leg.instrument.lastPriceAt;
      if (at && (!oldest || at < oldest)) oldest = at;
    }
  }
  return oldest;
}
