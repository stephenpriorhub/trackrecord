/**
 * Track Record v2 — the services readers see, and where each one's trades live.
 *
 * The published Google Sheet is the record for every trading service. Stephen,
 * 2026-10-24: "the spreadsheet is the most accurate". The app reads it, stores
 * every trade, and computes all of its statistics from what it stored, so the
 * numbers on a page always come from the trades listed beneath them.
 *
 * Long-term (McCall) services have no sheet. Their holdings are the Portfolio
 * Manager books already in this app (Airtable-synced), keyed by pubCode.
 */

export type ServiceKind = "TRADING" | "INVESTING" | "HYBRID";

export interface SubPortfolioDef {
  key: string;
  label: string;
  /** Shown on the service page; false = kept out of the service's headline numbers. */
  inHeadline: boolean;
}

/**
 * A long-term service's separately tracked portfolio. Each book has its own
 * return and S&P comparison and is never totalled with the others.
 */
export interface BookDef {
  key: string;
  label: string;
  description?: string;
  /** Portfolio Manager portfolio slugs in this book. */
  slugs?: string[];
  /** Every portfolio not claimed by another book — new themes land here. */
  rest?: boolean;
  /** Whole Portfolio Manager services folded into this book (by pubCode). */
  pubCodes?: string[];
}

export interface ServiceDef {
  code: string;
  slug: string;
  name: string;
  kind: ServiceKind;
  gurus: string[];
  /** Google Sheet id. Absent for long-term services, which read Portfolio Manager. */
  sheetId?: string;
  /** Portfolio Manager pubCode for long-term services. */
  managedPubCode?: string;
  /** Long-term services: separately tracked books, in display order. */
  books?: BookDef[];
  /** Sub-portfolios in display order. A service with one book has none listed. */
  subPortfolios: SubPortfolioDef[];
  /**
   * Second way to split a service's trades, by who called them. The War Room
   * publishes Bryan and Karim separately (Summary Stats tab), never jointly.
   */
  byGuru?: boolean;
  /** WAR publishes a weighted average; the others a plain average. */
  weighted?: boolean;
  /**
   * Put sells are judged on premium captured (WAR's Karim block). Shown beside
   * the return for those trades, never instead of it.
   */
  premiumCapture?: boolean;
  sortOrder: number;
}

export const SERVICES: ServiceDef[] = [
  {
    code: "WAR",
    slug: "war-room",
    name: "The War Room",
    kind: "HYBRID",
    gurus: ["Bryan Bottarelli", "Karim Rahemtulla"],
    sheetId: "1-K08g5rgVniUqG_0-M_t5TZiAXwGq3bf37oYAERS62o",
    subPortfolios: [
      { key: "options", label: "Option Trades", inHeadline: true },
      { key: "strangles", label: "Strangles", inHeadline: true },
      { key: "put-sells", label: "Put Sells", inHeadline: true },
      { key: "stocks", label: "Stock Positions", inHeadline: true },
      { key: "insider", label: "Insider Plays", inHeadline: true },
      { key: "hedges", label: "Hedges", inHeadline: true },
    ],
    byGuru: true,
    weighted: true,
    premiumCapture: true,
    sortOrder: 1,
  },
  {
    code: "DPL",
    slug: "daily-profits-live",
    name: "Daily Profits Live",
    kind: "TRADING",
    gurus: ["Nate Bear"],
    sheetId: "1C7_QAbPU1QUKT_h4dm3XvAti9-sJi-CquoCFfCyaPEg",
    subPortfolios: [
      { key: "main", label: "Daily Profits Live", inHeadline: true },
      // Published separately since 1/16/26 and excluded from DPL's own stats
      // (the sheet's "Note 2").
      { key: "spx-lotto", label: "SPX/NDX Lotto", inHeadline: false },
    ],
    sortOrder: 2,
  },
  {
    code: "PSU",
    slug: "profit-surge-trader",
    name: "Profit Surge Trader",
    kind: "TRADING",
    gurus: ["Nate Bear"],
    sheetId: "1k9XZCI5MxkA5gswfo9eUipT6UBdQUDAYy7mo80kdSGM",
    subPortfolios: [],
    sortOrder: 3,
  },
  {
    code: "NBS",
    slug: "sector-strike",
    name: "Sector Strike",
    kind: "TRADING",
    gurus: ["Nate Bear"],
    sheetId: "1cbdDD508riq_TC9whm3G5csN4dZdblhfbbENHULSqwM",
    subPortfolios: [],
    sortOrder: 4,
  },
  {
    code: "PMK",
    slug: "post-market-profits",
    name: "Post-Market Profits",
    kind: "TRADING",
    gurus: ["Bryan Bottarelli"],
    sheetId: "1AZ3K9RrwB-nwcrrAIHKAoVpic02PvGAzZbgGzMAQ9II",
    // Stephen, 2026-10-24: the two trade types are simply these.
    subPortfolios: [
      { key: "dark-ticker", label: "Dark Ticker", inHeadline: true },
      { key: "stock-flips", label: "Stock Flips", inHeadline: true },
    ],
    sortOrder: 5,
  },
  {
    code: "XAI",
    slug: "mccall-innovation-report",
    name: "The McCall Innovation Report",
    kind: "INVESTING",
    gurus: ["Matt McCall"],
    managedPubCode: "XAI",
    subPortfolios: [],
    // Stephen, 2026-10-24: three portfolios, each tracked completely
    // separately. Pro (formerly its own service, XM2) lives here; the LEAP
    // options trade is part of Pro.
    books: [
      {
        key: "core",
        label: "Core Portfolio",
        description: "Matt's innovation themes, each tracked as its own group.",
        rest: true,
      },
      { key: "disruptor-25", label: "Disruptor 25", slugs: ["disruptor-25-portfolio"] },
      {
        key: "pro",
        label: "Pro Portfolio",
        description: "McCall Innovation Report Pro, including the long-term options (LEAP) plays.",
        slugs: ["bonus-leap-options-trade"],
        pubCodes: ["XM2"],
      },
    ],
    sortOrder: 6,
  },
  {
    code: "SAT",
    slug: "early-opportunities",
    name: "Early Opportunities",
    kind: "INVESTING",
    gurus: ["Matt McCall"],
    managedPubCode: "SAT",
    subPortfolios: [],
    sortOrder: 7,
  },
];

export const KIND_LABEL: Record<ServiceKind, string> = {
  TRADING: "Trading",
  INVESTING: "Long-Term Investing",
  HYBRID: "Hybrid",
};

export function serviceBySlug(slug: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.slug === slug);
}

export function serviceByCode(code: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.code === code.toUpperCase());
}

export const SHEET_SERVICES = SERVICES.filter((s) => s.sheetId);
