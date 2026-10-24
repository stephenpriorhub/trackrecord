/**
 * Long-term (McCall) services: no trade sheet, just model portfolios kept in
 * Portfolio Manager. Stephen, 2026-10-24: "they won't be trades. They are
 * long-term. Just need a summary of portfolio."
 *
 * A service is split into BOOKS (ServiceDef.books) that are tracked completely
 * separately — the McCall Innovation Report's Core, Disruptor 25 and Pro each
 * have their own return and S&P comparison and are never totalled together.
 *
 * Every figure comes from the same loader as the public widgets, so these
 * pages and every embed agree. The headline is the TOTAL return across the
 * book's whole record — closed positions at their exits, open ones marked to
 * market (lib/managed/total-return.ts) — as Stephen asked.
 */
import { prisma } from "../prisma";
import { loadServiceEmbed, parseEmbedOptions, type EmbedView } from "../managed/embed";
import { splitReturns } from "./longterm-math";
import type { BookDef, ServiceDef } from "./services";

export interface LongTermBook {
  key: string;
  label: string;
  description: string | null;
  /** One view per Portfolio Manager service feeding the book (usually one). */
  views: EmbedView[];
}

export interface BookSummary {
  key: string;
  label: string;
  open: number;
  closed: number;
  totalReturn: number | null;
  realized: number | null;
  unrealized: number | null;
  spx: number | null;
  since: Date | null;
}

async function serviceSlug(pubCode: string): Promise<string | null> {
  const s = await prisma.service.findUnique({ where: { pubCode }, select: { slug: true } });
  return s?.slug ?? null;
}

async function viewFor(slug: string, only: string[] | null, publicOnly: boolean): Promise<EmbedView | null> {
  const params: Record<string, string> = { layout: "grouped", show: "both", limit: "all" };
  if (only) {
    if (only.length === 0) return null;
    params.only = only.join(",");
  }
  const view = await loadServiceEmbed(slug, parseEmbedOptions(params), !publicOnly);
  if (!view) return null;
  const empty = view.open.length === 0 && view.closedTotal === 0 && view.groups.every((g) => g.open.length === 0 && g.closedTotal === 0);
  return empty ? null : view;
}

export async function longTermBooks(def: ServiceDef, publicOnly: boolean): Promise<LongTermBook[]> {
  const slug = def.managedPubCode ? await serviceSlug(def.managedPubCode) : null;
  const books: BookDef[] = def.books ?? [{ key: "main", label: def.name, rest: true }];

  let available: string[] = [];
  if (slug) {
    const rows = await prisma.managedPortfolio.findMany({
      where: { service: { slug }, archivedAt: null, ...(publicOnly ? { visibility: "PUBLIC" } : {}) },
      select: { slug: true },
    });
    available = rows.map((r) => r.slug);
  }
  const claimed = new Set(books.flatMap((b) => b.slugs ?? []));

  return Promise.all(
    books.map(async (b): Promise<LongTermBook> => {
      const views: EmbedView[] = [];
      if (slug) {
        const only = b.rest ? available.filter((s) => !claimed.has(s)) : (b.slugs ?? []).filter((s) => available.includes(s));
        const v = await viewFor(slug, def.books ? only : null, publicOnly);
        if (v) views.push(v);
      }
      for (const code of b.pubCodes ?? []) {
        const other = await serviceSlug(code);
        const v = other ? await viewFor(other, null, publicOnly) : null;
        if (v) views.push(v);
      }
      return { key: b.key, label: b.label, description: b.description ?? null, views };
    }),
  );
}

const num = (d: { toNumber(): number } | null | undefined) => (d ? d.toNumber() : null);

/** Headline figures per book, for the home page. */
export function summariseBooks(books: LongTermBook[]): BookSummary[] {
  return books.map((b) => {
    const v = b.views[0];
    const blocks = b.views.flatMap((x) => (x.groups.length ? x.groups : [x]));
    const split = splitReturns(blocks);
    return {
      key: b.key,
      label: b.label,
      open: blocks.reduce((a, g) => a + g.open.length, 0),
      closed: blocks.reduce((a, g) => a + g.closedTotal, 0),
      totalReturn: num(v?.portfolioReturn),
      realized: split.realized,
      unrealized: split.unrealized,
      spx: num(v?.benchmarkReturn),
      since: v?.benchmarkFrom ?? null,
    };
  });
}
