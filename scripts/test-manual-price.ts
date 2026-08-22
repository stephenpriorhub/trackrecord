/**
 * The manual-price eligibility rule: a hand-entered price is allowed ONLY where
 * no feed has data.
 *
 * The load-bearing case is the refusal. If a manual price could override a real
 * market quote, a stale number would silently be published as the current price
 * of a liquid security — so that assertion matters more than the happy path.
 *
 * Run: npm run test:manual
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { dec } from "../lib/money";
import { createPosition, recomputePosition } from "../lib/managed/positions";
import { navEligible } from "../lib/managed/nav";

const prisma = new PrismaClient();
const TAG = `mp-${Date.now()}`;
/**
 * Letters only. normalizeUnderlying() strips everything else, so a ticker with a
 * numeric suffix collapses to the same symbol on every run — which silently
 * shared instrument state (and a leftover manual price) between runs and made an
 * earlier version of this suite pass or fail depending on execution order.
 */
const SUFFIX = Array.from(String(Date.now()).slice(-5), (d) =>
  String.fromCharCode(65 + Number(d))
).join("");
let failures = 0;

function check(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => console.log(`  ✓ ${name}`))
    .catch((e) => { failures += 1; console.error(`  ✗ ${name}\n    ${e.message}`); });
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v.toString()));

async function main() {
  const service = await prisma.service.create({
    data: { pubCode: `M-${TAG}`, name: `Manual ${TAG}`, slug: `m-${TAG}` },
  });
  const pf = await prisma.managedPortfolio.create({
    data: { serviceId: service.id, name: `Book ${TAG}`, slug: `b-${TAG}` },
  });

  const tickers: string[] = [];

  /**
   * Create a position and put its instrument in a known state. Explicit rather
   * than assumed: these tests are about price precedence, so each one must start
   * from a defined baseline instead of whatever a previous run left behind.
   */
  const mk = async (stem: string, entry: string) => {
    const ticker = `${stem}${SUFFIX}`;
    const pos = await createPosition({
      portfolioId: pf.id,
      underlying: ticker,
      openedAt: new Date("2026-01-05T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec(entry) }],
    });
    const leg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: pos.id } });
    tickers.push(leg.marketTicker);
    await prisma.marketInstrument.update({
      where: { ticker: leg.marketTicker },
      data: {
        lastPrice: null,
        lastPriceAt: null,
        manualPrice: null,
        manualPriceAt: null,
        priceSource: "NONE",
        lastCheckedAt: null,
      },
    });
    return { pos, leg };
  };

  console.log("\nmark ladder");

  await check("a manual price is used when no feed has one", async () => {
    const { pos, leg } = await mk("UNCOV", "100");
    // A refresh looked and found nothing — which is what makes it eligible.
    await prisma.marketInstrument.update({
      where: { ticker: leg.marketTicker },
      data: { lastCheckedAt: new Date() },
    });
    let after = await recomputePosition(pos.id);
    assert.equal(after!.cachedUnpriced, true, "unpriced before any manual figure");
    assert.equal(after!.cachedReturnPct, null);

    await prisma.marketInstrument.update({
      where: { ticker: leg.marketTicker },
      data: { manualPrice: "125", manualPriceAt: new Date(), priceSource: "MANUAL" },
    });
    after = await recomputePosition(pos.id);
    assert.equal(after!.cachedUnpriced, false);
    assert.equal(after!.cachedManualPriced, true, "must be flagged as manually priced");
    assert.equal(num(after!.cachedReturnPct), 0.25);
  });

  // THE assertion that matters: a live quote must win, so a hand-typed number can
  // never be published as the price of a security the market is actually pricing.
  await check("a live price ALWAYS beats a manual one", async () => {
    const { pos, leg } = await mk("LIVE", "100");
    await prisma.marketInstrument.update({
      where: { ticker: leg.marketTicker },
      data: {
        lastPrice: "110",
        lastPriceAt: new Date(),
        priceSource: "LAST_TRADE",
        lastCheckedAt: new Date(),
        manualPrice: "500", // wildly wrong on purpose
        manualPriceAt: new Date(),
      },
    });
    const after = await recomputePosition(pos.id);
    assert.equal(num(after!.cachedCurrentPrice), 110, "the live price, not the manual 500");
    assert.equal(after!.cachedManualPriced, false);
    assert.equal(num(after!.cachedReturnPct), 0.1);
  });

  await check("clearing a manual price returns the position to unpriced", async () => {
    const { pos, leg } = await mk("CLR", "50");
    await prisma.marketInstrument.update({
      where: { ticker: leg.marketTicker },
      data: { lastCheckedAt: new Date(), manualPrice: "60", priceSource: "MANUAL" },
    });
    assert.equal((await recomputePosition(pos.id))!.cachedUnpriced, false);
    await prisma.marketInstrument.update({
      where: { ticker: leg.marketTicker },
      data: { manualPrice: null, priceSource: "NONE" },
    });
    const after = await recomputePosition(pos.id);
    assert.equal(after!.cachedUnpriced, true);
    assert.equal(after!.cachedReturnPct, null, "back to blank, not zero");
  });

  console.log("\nnav eligibility");

  await check("option contracts are never sent to the NAV lookup", async () => {
    assert.equal(navEligible("O:NVDA270115C00200000"), false, "an OCC symbol is not a fund");
    assert.equal(navEligible("PRIVX"), true);
    assert.equal(navEligible("ARKVX"), true);
    assert.equal(navEligible("BRK.B"), true);
  });

  await prisma.managedPosition.deleteMany({ where: { portfolioId: pf.id } });
  await prisma.managedPortfolio.delete({ where: { id: pf.id } });
  await prisma.service.delete({ where: { id: service.id } });
  // By the ACTUAL stored ticker, not a guessed pattern — normalization rewrites
  // what was passed in, so a pattern built from the input matched nothing and
  // left instruments behind for the next run to trip over.
  await prisma.marketInstrument.deleteMany({
    where: { ticker: { in: tickers }, legs: { none: {} } },
  });

  console.log(failures === 0 ? "\nall manual-price tests passed\n" : `\n${failures} FAILED\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
