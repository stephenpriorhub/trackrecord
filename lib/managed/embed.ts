/**
 * Reading portfolios for public display.
 *
 * Everything the embed renders is computed here so the page components stay
 * tables. Two rules the embeds depend on:
 *
 *   - A missing price is "—", never 0 and never a return of -100%. An illiquid
 *     option contract must not publish a total loss.
 *   - The "last updated" stamp is the OLDEST provider timestamp among the
 *     instruments actually used, so the line is a promise that everything on the
 *     page is at least that fresh.
 *
 * Two entry points, one body: `loadPortfolioEmbed` renders a single book and
 * `loadServiceEmbed` renders a whole publication. They differ only in which
 * portfolios they select — every row, total and freshness rule below is shared,
 * so a service embed can never disagree with the individual embeds it contains.
 */
import { prisma } from "../prisma";
import { dec, ZERO, type D } from "../money";

export type ShowMode = "open" | "closed" | "both";

export interface EmbedOptions {
  show: ShowMode;
  /** false hides every % figure, leaving prices only. */
  returns: boolean;
  comments: boolean;
  /**
   * Portfolio slugs to include in a service embed; null means every eligible
   * one. This is a DISPLAY filter layered on top of visibility, never a way
   * around it — a PRIVATE portfolio stays out whether or not it is named here.
   */
  only: string[] | null;
  /**
   * Whether rows carry the portfolio they came from. On by default for a
   * service embed, where a merged table is ambiguous without it, and never
   * shown on a single-portfolio embed.
   */
  portfolioColumn: boolean;
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
  const only = one(sp.only);
  return {
    show: show === "open" || show === "closed" ? show : "both",
    returns: !off(one(sp.returns)),
    comments: !off(one(sp.comments)),
    only: only
      ? only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    portfolioColumn: !off(one(sp.portfolio)),
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
  /** Which book this row came from. Rendered only on a service embed. */
  portfolioName: string;
}

export interface EmbedView {
  kind: "portfolio" | "service";
  /** Heading text: the portfolio name, or the publication name. */
  title: string;
  serviceName: string;
  benchmarkTicker: string;
  showBenchmark: boolean;
  /** The books this view is built from, in display order. */
  included: { id: string; name: string; slug: string; positions: number }[];
  /**
   * True when a PRIVATE or archived portfolio is on screen because an
   * authorised manager asked to preview it. The page renders a banner off this
   * so a preview can never be mistaken for the live embed.
   */
  preview: boolean;
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

/**
 * The one portfolio query both embeds use.
 *
 * Sharing it is what keeps a service embed consistent with the per-portfolio
 * embeds it aggregates: same positions, same ordering, same exit expansion.
 */
async function fetchPortfolios(where: Record<string, unknown>) {
  return prisma.managedPortfolio.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      service: { select: { name: true, slug: true } },
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
          // Each exit is reported on its own line (see below), so a position
          // scaled out in halves shows two results, not one blend.
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
}

type LoadedPortfolio = Awaited<ReturnType<typeof fetchPortfolios>>[number];

/**
 * A single portfolio's public embed.
 *
 * `allowPrivate` is granted by the PAGE, only after it has confirmed the caller
 * may manage this portfolio. It is not readable from the query string.
 */
export async function loadPortfolioEmbed(
  slug: string,
  options: EmbedOptions,
  allowPrivate = false,
): Promise<EmbedView | null> {
  const found = await fetchPortfolios({ slug });
  const portfolio = found[0];
  if (!portfolio) return null;

  const live = portfolio.visibility === "PUBLIC" && !portfolio.archivedAt;
  // A private or archived portfolio is indistinguishable from a wrong slug,
  // unless an authorised manager is previewing it.
  if (!live && !allowPrivate) return null;

  return buildView([portfolio], {
    kind: "portfolio",
    title: portfolio.name,
    serviceName: portfolio.service.name,
    benchmarkTicker: portfolio.benchmarkTicker,
    showBenchmark: portfolio.showBenchmark,
    // Never label rows on a single-portfolio embed: there is only one answer.
    options: { ...options, portfolioColumn: false },
    preview: !live,
  });
}

/**
 * A whole publication's embed: every eligible portfolio merged into one pair of
 * tables.
 *
 * Eligibility is visibility FIRST and selection second. `only` can narrow what a
 * page shows, but a PRIVATE book is never published by being named in a query
 * string — otherwise anyone could guess a slug and read an unpublished book out
 * of a service embed.
 */
export async function loadServiceEmbed(
  serviceSlug: string,
  options: EmbedOptions,
  allowPrivate = false,
): Promise<EmbedView | null> {
  const service = await prisma.service.findUnique({
    where: { slug: serviceSlug },
    select: { name: true },
  });
  if (!service) return null;

  const all = await fetchPortfolios({
    service: { slug: serviceSlug },
    ...(allowPrivate ? {} : { visibility: "PUBLIC", archivedAt: null }),
  });

  const eligible = options.only
    ? all.filter((p) => options.only!.includes(p.slug))
    : all;
  // An empty service embed is a wrong link, not a blank page: 404 rather than
  // publish a table with nothing in it.
  if (eligible.length === 0) return null;

  // The comparison index comes from the books themselves rather than a query
  // param, so the embed cannot be pointed at a flattering benchmark from the
  // outside. Most common wins; ties break on display order.
  const counts = new Map<string, number>();
  for (const p of eligible) {
    if (!p.showBenchmark) continue;
    counts.set(p.benchmarkTicker, (counts.get(p.benchmarkTicker) ?? 0) + 1);
  }
  const benchmarkTicker =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    eligible[0].benchmarkTicker;

  return buildView(eligible, {
    kind: "service",
    title: service.name,
    serviceName: service.name,
    benchmarkTicker,
    showBenchmark: counts.size > 0,
    options,
    preview: eligible.some(
      (p) => p.visibility !== "PUBLIC" || p.archivedAt !== null,
    ),
  });
}

/** Shared row-building, totals and freshness for both embed kinds. */
async function buildView(
  portfolios: LoadedPortfolio[],
  meta: {
    kind: "portfolio" | "service";
    title: string;
    serviceName: string;
    benchmarkTicker: string;
    showBenchmark: boolean;
    options: EmbedOptions;
    preview: boolean;
  },
): Promise<EmbedView> {
  const open: EmbedRow[] = [];
  const closed: EmbedRow[] = [];

  for (const portfolio of portfolios) {
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
        portfolioName: portfolio.name,
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
      // published — see the two DXYZ lines in the reference design. Blending
      // them into one average would hide both.
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
  }

  // Newest first in both tables. Across a merged service embed this interleaves
  // books by date, which is the point: it reads as one track record.
  open.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  closed.sort(
    (a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0),
  );

  // The headline compares like with like: whatever the reader can actually see.
  const shown =
    meta.options.show === "open"
      ? open
      : meta.options.show === "closed"
        ? closed
        : [...open, ...closed];

  const benchmark = await prisma.marketInstrument.findUnique({
    where: { ticker: meta.benchmarkTicker },
    select: { lastPrice: true, prevClose: true },
  });

  // Benchmark move on the same data the positions are priced from. Session
  // change only — a like-for-like since-inception benchmark needs a historical
  // bar the current Massive plan does not provide, and inventing one would be
  // worse than showing none.
  let benchmarkReturn: D | null = null;
  const bLast = d(benchmark?.lastPrice);
  const bPrev = d(benchmark?.prevClose);
  if (bLast && bPrev && !bPrev.isZero()) {
    benchmarkReturn = bLast.minus(bPrev).div(bPrev);
  }

  const allPositions = portfolios.flatMap((p) => p.positions);

  return {
    kind: meta.kind,
    title: meta.title,
    serviceName: meta.serviceName,
    benchmarkTicker: meta.benchmarkTicker,
    showBenchmark: meta.showBenchmark,
    included: portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      positions: p.positions.length,
    })),
    preview: meta.preview,
    open,
    closed,
    portfolioReturn: meanReturn(shown),
    benchmarkReturn,
    priceAsOf: oldestPriceAt(allPositions),
    priceSources: [
      ...new Set(
        allPositions
          .filter((p) => p.status === "OPEN")
          .flatMap((p) =>
            p.legs
              .filter((l) => l.openQty > 0 && l.instrument.lastPrice !== null)
              .map((l) => l.instrument.priceSource as string),
          ),
      ),
    ],
    options: meta.options,
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
