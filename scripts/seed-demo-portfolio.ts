/**
 * Seed the reference portfolio from the design, so the embed can be checked
 * against it side by side.
 *
 * Prices are set directly rather than fetched, because the point is to verify
 * the RENDERING against a known target; the live pricing path has its own check.
 *
 * Run: npm run seed:demo    (local throwaway Postgres only — it refuses a
 * Railway host, since this writes fixture data)
 */
import { PrismaClient } from "@prisma/client";
import { dec } from "../lib/money";
import { ensureService, createPortfolio } from "../lib/managed/portfolios";
import { createPosition, closePosition, recomputePosition } from "../lib/managed/positions";

const prisma = new PrismaClient();

const SLUG = "spacex-playbook-portfolio";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (/rlwy\.net|railway\.internal|railway\.app/.test(url)) {
    throw new Error("Refusing to seed fixture data into a Railway database.");
  }

  // Start clean so the script is re-runnable.
  const existing = await prisma.managedPortfolio.findUnique({ where: { slug: SLUG } });
  if (existing) {
    await prisma.managedPosition.deleteMany({ where: { portfolioId: existing.id } });
    await prisma.managedPortfolio.delete({ where: { id: existing.id } });
  }

  const service = await ensureService("XAI");
  const portfolio = await createPortfolio({
    serviceId: service.id,
    name: "SpaceX Playbook Portfolio",
    benchmarkTicker: "SPY",
  });
  await prisma.managedPortfolio.update({
    where: { id: portfolio.id },
    data: { slug: SLUG, visibility: "PUBLIC" },
  });

  const added = new Date("2026-03-11T00:00:00Z");

  const OPEN = [
    { t: "PRIVX", name: "Private Shares Fund", entry: "48.88", now: "52.13", up: "50.00", stop: "35.00" },
    { t: "ARKVX", name: "ARK Venture Fund", entry: "49.40", now: "57.89", up: "51.00", stop: "38.00" },
    { t: "RONB", name: "Baron First Principles ETF", entry: "23.95", now: "23.95", up: "25.00", stop: "19.00" },
  ];

  for (const o of OPEN) {
    await createPosition({
      portfolioId: portfolio.id,
      underlying: o.t,
      companyName: o.name,
      openedAt: added,
      legs: [{ kind: "STOCK", side: "BUY", price: dec(o.entry) }],
      buyUpToPrice: dec(o.up),
      stopLossPrice: dec(o.stop),
      actorEmail: "seed@oxfordhub.app",
    });
    await prisma.marketInstrument.update({
      where: { ticker: o.t },
      data: { lastPrice: o.now, lastPriceAt: new Date(), priceSource: "LAST_TRADE" },
    });
  }

  // DXYZ was entered once and scaled out in two halves on different dates. Two
  // decisions, two results — the design reports them as two lines, which is what
  // the per-exit row derivation in lib/managed/embed.ts produces.
  const dxyz = await createPosition({
    portfolioId: portfolio.id,
    underlying: "DXYZ",
    companyName: "Destiny Tech 100 - Half Position",
    openedAt: added,
    legs: [{ kind: "STOCK", side: "BUY", price: dec("26.40") }],
    units: 2,
    actorEmail: "seed@oxfordhub.app",
  });
  const dxyzLeg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: dxyz.id } });

  await closePosition({
    positionId: dxyz.id,
    executedAt: new Date("2026-05-11T00:00:00Z"),
    prices: { [dxyzLeg.id]: dec("69.11") },
    quantities: { [dxyzLeg.id]: 1 },
    actorEmail: "seed@oxfordhub.app",
  });
  await closePosition({
    positionId: dxyz.id,
    executedAt: new Date("2026-05-29T00:00:00Z"),
    prices: { [dxyzLeg.id]: dec("50.00") },
    quantities: { [dxyzLeg.id]: 1 },
    actorEmail: "seed@oxfordhub.app",
  });

  // A benchmark needs a previous close for the header comparison.
  await prisma.marketInstrument.upsert({
    where: { ticker: "SPY" },
    update: { lastPrice: "690.00", prevClose: "600.00", lastPriceAt: new Date() },
    create: {
      ticker: "SPY",
      kind: "STOCK",
      underlying: "SPY",
      lastPrice: "690.00",
      prevClose: "600.00",
      lastPriceAt: new Date(),
      priceSource: "LAST_TRADE",
    },
  });

  for (const p of await prisma.managedPosition.findMany({
    where: { portfolioId: portfolio.id },
    select: { id: true },
  })) {
    await recomputePosition(p.id);
  }

  console.log(`seeded /embed/p/${SLUG}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
