/**
 * Create the Service rows from what the Track Record already knows.
 *
 * The Airtable mirror already records which publications exist and which gurus
 * run them, so services are derived from it rather than typed in again. This is
 * a READ of the mirror — it never writes back to it, and it does not import any
 * positions (that is the separate, reviewable import).
 *
 * Idempotent: safe to call on every request to /manage, on deploy, or by hand.
 */
import { prisma } from "../prisma";
import { PUB_NAMES } from "../publications";
import { ensureService, linkServiceGuru, ensureMainPortfolio } from "./portfolios";

export interface SeedReport {
  servicesCreated: string[];
  gurusLinked: number;
  portfoliosCreated: string[];
}

export async function seedServicesFromTrackRecord(): Promise<SeedReport> {
  const report: SeedReport = { servicesCreated: [], gurusLinked: 0, portfoliosCreated: [] };

  // Only publications the app actually knows by name. A stray pub code appearing
  // in the mirror should not silently mint a service called "ABC".
  const pubCodes = Object.keys(PUB_NAMES);

  for (const pubCode of pubCodes) {
    const before = await prisma.service.findUnique({ where: { pubCode } });
    const service = await ensureService(pubCode);
    if (!before) report.servicesCreated.push(pubCode);

    // Gurus who run this publication, taken from the mirror's portfolio→guru links.
    const mirrored = await prisma.portfolio.findMany({
      where: { pubCode },
      select: { gurus: { select: { guruId: true } } },
    });
    const guruIds = [...new Set(mirrored.flatMap((p) => p.gurus.map((g) => g.guruId)))];
    for (const guruId of guruIds) {
      await linkServiceGuru(service.id, guruId);
      report.gurusLinked += 1;
    }

    // Every service needs somewhere to put a position before anyone has split it
    // into books, so it starts with one.
    const existingPortfolios = await prisma.managedPortfolio.count({
      where: { serviceId: service.id },
    });
    if (existingPortfolios === 0) {
      const p = await ensureMainPortfolio(service.id);
      report.portfoliosCreated.push(`${pubCode}/${p.name}`);
    }
  }

  return report;
}
