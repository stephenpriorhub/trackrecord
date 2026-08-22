/**
 * Services and portfolios — the two levels above a position.
 *
 *   Service   = a publication (WAR, PMK, TPU, XAI). Codes and names come from
 *               lib/publications.ts, so the manager and the Track Record can
 *               never disagree about what XAI is called.
 *   Portfolio = a book inside a service. Corresponds to what Airtable calls a
 *               "Trade Group"; a service that doesn't subdivide gets one
 *               portfolio named "Main Portfolio".
 */
import { prisma } from "../prisma";
import { PUB_NAMES, resolvePubCode } from "../publications";

export const MAIN_PORTFOLIO_NAME = "Main Portfolio";

/**
 * URL-safe slug. This is the PUBLIC EMBED KEY, so it is generated once at
 * creation and then left alone — renaming a portfolio must not break a live
 * iframe on a marketing page.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "portfolio";
}

/**
 * Claim a unique slug, appending -2, -3… on collision. Loops against the DB
 * rather than trusting a random suffix, because the slug is user-facing and a
 * readable one matters more than a fast insert.
 */
async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>
): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  while (await isTaken(candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

export async function uniquePortfolioSlug(base: string): Promise<string> {
  return uniqueSlug(base, async (slug) =>
    !!(await prisma.managedPortfolio.findUnique({ where: { slug }, select: { id: true } }))
  );
}

export async function uniqueServiceSlug(base: string): Promise<string> {
  return uniqueSlug(base, async (slug) =>
    !!(await prisma.service.findUnique({ where: { slug }, select: { id: true } }))
  );
}

/**
 * Get or create the Service for a pub code, naming it from lib/publications.ts.
 * Idempotent on pubCode, so it is safe to call from the import, a seed script or
 * a form handler.
 */
export async function ensureService(pubCodeInput: string, opts?: { name?: string }) {
  const pubCode = resolvePubCode(pubCodeInput);
  const existing = await prisma.service.findUnique({ where: { pubCode } });
  if (existing) return existing;

  const name = opts?.name ?? PUB_NAMES[pubCode] ?? pubCode;
  return prisma.service.create({
    data: { pubCode, name, slug: await uniqueServiceSlug(name) },
  });
}

/** Link a guru (from the existing Guru table) to a service. Idempotent. */
export async function linkServiceGuru(serviceId: string, guruId: string) {
  return prisma.serviceGuru.upsert({
    where: { serviceId_guruId: { serviceId, guruId } },
    update: {},
    create: { serviceId, guruId },
  });
}

export interface CreatePortfolioInput {
  serviceId: string;
  name: string;
  description?: string | null;
  benchmarkTicker?: string;
  /** Set only by the Airtable import, for idempotency. */
  airtableTradeGroupId?: string | null;
  createdByEmail?: string | null;
}

/**
 * Create a portfolio. `[serviceId, name]` is unique, so a repeat create returns
 * the existing row instead of erroring — the import re-runs and a guru
 * double-clicking "Add Portfolio" both end up with one portfolio, not a
 * duplicate or a stack trace.
 */
export async function createPortfolio(input: CreatePortfolioInput) {
  const name = input.name.trim() || MAIN_PORTFOLIO_NAME;

  const existing = await prisma.managedPortfolio.findUnique({
    where: { serviceId_name: { serviceId: input.serviceId, name } },
  });
  if (existing) return existing;

  const count = await prisma.managedPortfolio.count({
    where: { serviceId: input.serviceId },
  });

  return prisma.managedPortfolio.create({
    data: {
      serviceId: input.serviceId,
      name,
      slug: await uniquePortfolioSlug(name),
      description: input.description ?? null,
      benchmarkTicker: input.benchmarkTicker?.trim().toUpperCase() || "SPY",
      airtableTradeGroupId: input.airtableTradeGroupId ?? null,
      sortOrder: count,
      createdByEmail: input.createdByEmail ?? null,
    },
  });
}

/** The service's default book, created on demand. */
export async function ensureMainPortfolio(serviceId: string) {
  return createPortfolio({ serviceId, name: MAIN_PORTFOLIO_NAME });
}

/**
 * Every service with its portfolios and position counts, for the manage index.
 * `scopeFilter` comes from lib/authz.portfolioScopeFilter() — null means no
 * restriction (app-level), otherwise it narrows to the caller's portfolios.
 */
export async function listServicesWithPortfolios(
  scopeFilter: Record<string, unknown> | null
) {
  const services = await prisma.service.findMany({
    where: scopeFilter ? { portfolios: { some: scopeFilter } } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      gurus: { include: { guru: true } },
      portfolios: {
        where: { archivedAt: null, ...(scopeFilter ?? {}) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          _count: { select: { positions: { where: { deletedAt: null } } } },
        },
      },
    },
  });
  return services;
}

export async function getPortfolio(id: string) {
  return prisma.managedPortfolio.findUnique({
    where: { id },
    include: { service: { include: { gurus: { include: { guru: true } } } } },
  });
}

export async function getPortfolioBySlug(slug: string) {
  return prisma.managedPortfolio.findUnique({
    where: { slug },
    include: { service: true },
  });
}
