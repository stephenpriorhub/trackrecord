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
import { benchmarkSince, earliestStart } from "./benchmark";
import { totalReturn } from "./total-return";
import { benchmarkLabel } from "../publications";

export type ShowMode = "open" | "closed" | "both";

/**
 * What the header states above the tables.
 *
 *   benchmark — the portfolio's return next to the index's over the same window
 *   portfolio — the portfolio's return alone, with nothing to compare it to
 *   none      — no headline figure at all
 *
 * Separate from `returns`, which governs the per-row % column. A page can show
 * the headline and hide the column, or the reverse: they answer different
 * editorial questions.
 */
export type SummaryMode = "benchmark" | "portfolio" | "none";

/**
 * How a whole-publication embed arranges its portfolios.
 *
 *   merged  — one open table and one closed table, rows interleaved by date
 *   grouped — one block per sub-portfolio, each with its own total return and
 *             its own benchmark window, under the publication's overall figure
 *
 * `merged` stays the parser default so every iframe already live on a page keeps
 * rendering exactly what it did. The builder defaults new embeds to grouped.
 */
export type LayoutMode = "merged" | "grouped";

/**
 * Look and feel. Every value here reaches CSS, so each is either an enum or a
 * colour that has passed HEX — nothing from the query string is interpolated
 * into a stylesheet unchecked.
 */
export interface EmbedLook {
  theme: "light" | "dark";
  /** A #hex colour, "none" for transparent, or null for the theme's default. */
  background: string | null;
  /** false = flat: no white cards, no shadow — the tables sit on the page. */
  cards: boolean;
  /** #hex for headings and tickers, or null for the theme's default. */
  accent: string | null;
  font: "sans" | "serif";
  density: "comfortable" | "compact";
  corners: "rounded" | "square";
  /** false drops the big title — the host page usually has its own heading. */
  title: boolean;
}

export interface EmbedOptions {
  show: ShowMode;
  /** false hides the per-row % column, leaving prices only. */
  returns: boolean;
  /** What the header states — see SummaryMode. */
  summary: SummaryMode;
  comments: boolean;
  /**
   * LEGACY: portfolio slugs to leave out of a service embed. The builder no
   * longer writes it (it offers a single sub-portfolio instead), but iframes
   * already pasted into pages carry it, so it is still honoured.
   *
   * It can only ever subtract from what visibility already allows.
   */
  hide: string[];
  /**
   * Whether rows carry the portfolio they came from. Only meaningful on a
   * MERGED service embed; grouped blocks already say which book they are.
   */
  portfolioColumn: boolean;
  /**
   * How many CLOSED rows to render, newest first. 0 means all. Per block in a
   * grouped embed.
   *
   * There is a default because there has to be: Daily Profits Live has 3,659
   * closed trades, and an iframe that renders every one is megabytes of HTML
   * and tens of thousands of pixels tall. Open positions are never capped.
   *
   * Headline returns are ALWAYS computed over the whole record, not the
   * visible slice, so changing this cannot change the number a reader sees.
   */
  limit: number;
  layout: LayoutMode;
  /** Grouped only: tabs across the top that let the READER switch between books. */
  tabs: boolean;
  /**
   * Tabs only: whether the first tab is "All portfolios" (the publication
   * headline plus every book). Off, the tabs are the books alone and the first
   * one opens selected.
   */
  allTab: boolean;
  look: EmbedLook;
}

/** Closed rows rendered when the embed does not say otherwise. */
export const DEFAULT_CLOSED_LIMIT = 200;

/** 3, 4, 6 or 8 hex digits. The only shape a colour may take into CSS. */
const HEX = /^[0-9a-f]{3,8}$/i;

function colour(v: string | undefined): string | null {
  if (!v) return null;
  const bare = v.replace(/^#/, "");
  return HEX.test(bare) && [3, 4, 6, 8].includes(bare.length) ? `#${bare}` : null;
}

/** Parse the embed's query string. Defaults reproduce the original embed. */
export function parseEmbedOptions(
  sp: Record<string, string | string[] | undefined>,
): EmbedOptions {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const show = one(sp.show);
  const off = (v: string | undefined) =>
    v === "0" || v === "false" || v === "no";
  const on = (v: string | undefined) =>
    v === "1" || v === "true" || v === "yes";
  const hide = one(sp.hide);
  const bg = one(sp.bg);
  return {
    show: show === "open" || show === "closed" ? show : "both",
    returns: !off(one(sp.returns)),
    summary: (() => {
      const v = one(sp.summary);
      if (v === "portfolio" || v === "none") return v;
      // An explicit returns=0 with no summary given means the caller wanted the
      // percentages gone, so the headline goes too rather than surviving as the
      // one figure on the page they asked to strip.
      if (v === undefined && off(one(sp.returns))) return "none";
      return "benchmark";
    })(),
    comments: !off(one(sp.comments)),
    hide: hide
      ? hide
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    portfolioColumn: !off(one(sp.portfolio)),
    limit: (() => {
      const raw = one(sp.limit);
      if (raw === undefined) return DEFAULT_CLOSED_LIMIT;
      const n = Number.parseInt(raw, 10);
      // "all", a negative, or junk all mean "do not cap".
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
    layout: one(sp.layout) === "grouped" ? "grouped" : "merged",
    tabs: on(one(sp.tabs)),
    allTab: !off(one(sp.all)),
    look: {
      theme: one(sp.theme) === "dark" ? "dark" : "light",
      background:
        bg === "none" || bg === "transparent" ? "none" : colour(bg),
      cards: !off(one(sp.cards)),
      accent: colour(one(sp.accent)),
      font: one(sp.font) === "serif" ? "serif" : "sans",
      density: one(sp.density) === "compact" ? "compact" : "comfortable",
      corners: one(sp.corners) === "square" ? "square" : "rounded",
      title: !off(one(sp.title)),
    },
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

/**
 * One headline + one pair of tables: the whole view on a single-portfolio or
 * merged embed, or one sub-portfolio's section on a grouped embed.
 */
export interface EmbedBlock {
  /** The portfolio this block is; null for the whole-view block. */
  slug: string | null;
  title: string;
  description: string | null;
  benchmarkTicker: string;
  /** Friendly name — "S&P 500", not "SPY". */
  benchmarkName: string;
  showBenchmark: boolean;
  /**
   * The date the benchmark return is measured from — the portfolio's start date
   * if one is set, otherwise its earliest position open date. Rendered next to
   * the figure, because "+12%" means nothing without the window it covers.
   */
  benchmarkFrom: Date | null;
  benchmarkReturn: D | null;
  /**
   * Equal-weighted mean TOTAL return per position across the whole record in
   * scope — realized exits and the marked remainder blended by quantity (see
   * total-return.ts), one vote per position however many times it was scaled
   * out. Never just the rows that fit under the limit.
   */
  portfolioReturn: D | null;
  /** Positions that produced portfolioReturn. */
  measured: number;
  /** Of those, how many are partly sold and partly held. */
  partials: number;
  open: EmbedRow[];
  /** The visible closed rows — newest first, capped by options.limit. */
  closed: EmbedRow[];
  /** How many closed rows exist in total, whether or not they are rendered. */
  closedTotal: number;
}

export interface EmbedView extends EmbedBlock {
  kind: "portfolio" | "service";
  serviceName: string;
  /** The books this view is built from, in display order. */
  included: { id: string; name: string; slug: string; positions: number }[];
  /**
   * Grouped service embeds only: one block per sub-portfolio, in display order.
   * Empty otherwise. The view's own fields are then the publication overall.
   */
  groups: EmbedBlock[];
  /**
   * True when a PRIVATE or archived portfolio is on screen because an
   * authorised manager asked to preview it. The page renders a banner off this
   * so a preview can never be mistaken for the live embed.
   */
  preview: boolean;
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
 * Equal-weighted mean of the values present.
 *
 * Equal weighting is right for a model portfolio: each recommendation is one
 * idea, and there are no real position sizes to weight by. Positions without a
 * return (unpriced) are EXCLUDED rather than counted as zero, which would drag
 * the average toward nothing whenever a contract goes quiet.
 */
function meanOf(values: (D | null)[]): { mean: D | null; count: number } {
  const present = values.filter((v): v is D => v !== null);
  if (present.length === 0) return { mean: null, count: 0 };
  return {
    mean: present.reduce((a, b) => a.plus(b), ZERO).div(present.length),
    count: present.length,
  };
}

/** The embed's benchmark window — see startFor/earliestStart in benchmark.ts. */
function benchmarkStartFor(
  portfolios: { startDate: Date | null; positions: { openedAt: Date }[] }[],
): Date | null {
  return earliestStart(
    portfolios.map((p) => ({
      startDate: p.startDate,
      earliestOpen: earliestOpen(p.positions),
    })),
  );
}

function earliestOpen(positions: { openedAt: Date }[]): Date | null {
  return positions.reduce<Date | null>(
    (acc, p) => (acc === null || p.openedAt < acc ? p.openedAt : acc),
    null,
  );
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
                  manualPrice: true,
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
    description: portfolio.description,
    serviceName: portfolio.service.name,
    benchmarkTicker: portfolio.benchmarkTicker,
    showBenchmark: portfolio.showBenchmark,
    // Never label rows or group a single-portfolio embed: there is one answer.
    options: {
      ...options,
      portfolioColumn: false,
      layout: "merged",
      tabs: false,
    },
    preview: !live,
  });
}

/**
 * A whole publication's embed: every eligible portfolio merged into one pair of
 * tables.
 *
 * Eligibility is visibility FIRST and selection second. `hide` can narrow what a
 * page shows, but a PRIVATE book is never published by being left out of that
 * list — otherwise anyone could guess a slug and read an unpublished book out
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

  const eligible = options.hide.length
    ? all.filter((p) => !options.hide.includes(p.slug))
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

  const grouped = options.layout === "grouped";
  return buildView(eligible, {
    kind: "service",
    title: service.name,
    description: null,
    serviceName: service.name,
    benchmarkTicker,
    showBenchmark: counts.size > 0,
    options: {
      ...options,
      // Each grouped block already names its book; a column would repeat it.
      portfolioColumn: grouped ? false : options.portfolioColumn,
      tabs: grouped && options.tabs && eligible.length > 1,
    },
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
    description: string | null;
    serviceName: string;
    benchmarkTicker: string;
    showBenchmark: boolean;
    options: EmbedOptions;
    preview: boolean;
  },
): Promise<EmbedView> {
  const options = meta.options;
  const grouped = meta.kind === "service" && options.layout === "grouped";

  // The overall block and each group are built by the SAME function, so a
  // book's grouped section can never disagree with its own single embed.
  const [whole, groups] = await Promise.all([
    buildBlock(portfolios, {
      slug: null,
      title: meta.title,
      description: meta.description,
      benchmarkTicker: meta.benchmarkTicker,
      showBenchmark: meta.showBenchmark,
      options,
    }),
    grouped
      ? Promise.all(
          portfolios.map((p) =>
            buildBlock([p], {
              slug: p.slug,
              title: p.name,
              description: p.description,
              // Each sub-portfolio against ITS OWN index, from ITS OWN start.
              benchmarkTicker: p.benchmarkTicker,
              showBenchmark: p.showBenchmark,
              options,
            }),
          ),
        )
      : Promise.resolve([] as EmbedBlock[]),
  ]);

  const allPositions = portfolios.flatMap((p) => p.positions);

  return {
    ...whole,
    kind: meta.kind,
    serviceName: meta.serviceName,
    included: portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      positions: p.positions.length,
    })),
    groups,
    preview: meta.preview,
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
    options,
  };
}

/** Rows, headline and benchmark for one set of portfolios. */
async function buildBlock(
  portfolios: LoadedPortfolio[],
  meta: {
    slug: string | null;
    title: string;
    description: string | null;
    benchmarkTicker: string;
    showBenchmark: boolean;
    options: EmbedOptions;
  },
): Promise<EmbedBlock> {
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

      // Anything still open is one row, marked at the current price. Its
      // "% Change" is the REMAINDER's move from entry, which is what sits beside
      // a current price; the realized part shows on its own closed row(s).
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

  // The headline is per POSITION, not per row. Rows over-count anything scaled
  // out (one row per exit plus the open remainder), and an open row's figure
  // ignores what was already sold. totalReturn() blends both.
  //
  // It still follows whichever tables the reader can see: "open" means
  // positions with anything still held (their total includes realized exits),
  // "closed" means positions fully exited.
  const positions = portfolios.flatMap((p) => p.positions);
  const inScope = positions.filter((p) => {
    const held = p.legs.some((l) => l.openQty > 0);
    if (meta.options.show === "open") return held;
    if (meta.options.show === "closed") return !held;
    return true;
  });
  const totals = inScope.map((p) => ({
    r: totalReturn(p),
    partial:
      p.legs.some((l) => l.openQty > 0) && p.legs.some((l) => l.closedQty > 0),
  }));
  const { mean: portfolioReturn, count: measured } = meanOf(
    totals.map((t) => t.r),
  );

  const closedTotal = closed.length;
  const closedShown =
    meta.options.limit > 0 ? closed.slice(0, meta.options.limit) : closed;

  // The benchmark runs from the portfolio's start date to now — the same window
  // the positions cover. (It was once the index's SESSION change, which put one
  // day of SPY next to a multi-year return.)
  const benchmarkFrom = benchmarkStartFor(portfolios);
  const comparison = meta.showBenchmark
    ? await benchmarkSince(meta.benchmarkTicker, benchmarkFrom)
    : null;

  return {
    slug: meta.slug,
    title: meta.title,
    description: meta.description,
    benchmarkTicker: meta.benchmarkTicker,
    benchmarkName: benchmarkLabel(meta.benchmarkTicker),
    showBenchmark: meta.showBenchmark,
    benchmarkFrom,
    benchmarkReturn: comparison?.return ?? null,
    portfolioReturn,
    measured,
    partials: totals.filter((t) => t.partial && t.r !== null).length,
    open,
    closed: closedShown,
    closedTotal,
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
