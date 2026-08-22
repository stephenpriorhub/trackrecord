/**
 * Position math, against a real database.
 *
 * These are the numbers that get published on a marketing page, so the cases
 * here are the ones that would be embarrassing to get wrong: a scale-in changing
 * the average entry, a partial exit leaving the rest open, a spread's return
 * measured on its net debit, and an unpriced leg refusing to report a return
 * rather than reporting a loss.
 *
 * Run: npm run test:positions   (uses .env — a LOCAL throwaway Postgres)
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { dec } from "../lib/money";
import { createPosition, closePosition, recomputePosition } from "../lib/managed/positions";

const prisma = new PrismaClient();
const TAG = `postest-${Date.now()}`;
let failures = 0;

function check(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failures += 1;
      console.error(`  ✗ ${name}\n    ${err.message}`);
    });
}

/** Round a stored decimal string for comparison without importing Decimal here. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(Number(v.toString()) * 1e8) / 1e8;
}

async function setPrice(ticker: string, price: number | null) {
  await prisma.marketInstrument.update({
    where: { ticker },
    data: {
      lastPrice: price === null ? null : price.toString(),
      lastPriceAt: price === null ? null : new Date(),
      priceSource: price === null ? "NONE" : "LAST_TRADE",
    },
  });
}

async function main() {
  const service = await prisma.service.create({
    data: { pubCode: `P-${TAG}`, name: `Pos ${TAG}`, slug: `pos-${TAG}` },
  });
  const portfolio = await prisma.managedPortfolio.create({
    data: { serviceId: service.id, name: `Book ${TAG}`, slug: `book-${TAG}` },
  });
  const P = portfolio.id;
  const created: string[] = [];

  console.log("\nstock positions");

  await check("a stock buy priced up shows the price return", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "aapl", // lower case on purpose — must normalize
      companyName: "Apple Inc.",
      openedAt: new Date("2026-01-05T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec("100") }],
      comment: "Opening note",
    });
    created.push(pos.id);
    assert.equal(pos.underlying, "AAPL");
    assert.equal(pos.instrument, "STOCK");
    assert.equal(pos.structure, "LONG_STOCK");
    assert.equal(pos.label, "AAPL");

    await setPrice("AAPL", 125);
    const after = await recomputePosition(pos.id);
    assert.equal(after!.status, "OPEN");
    assert.equal(num(after!.cachedReturnPct), 0.25, "125 from 100 is +25%");
    assert.equal(after!.cachedUnpriced, false);

    const comments = await prisma.managedComment.count({ where: { positionId: pos.id } });
    assert.equal(comments, 1, "the opening comment is stored");
  });

  await check("an unpriced leg reports no return, NOT a total loss", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "ILLIQ",
      openedAt: new Date("2026-01-05T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec("10") }],
    });
    created.push(pos.id);
    await setPrice("ILLIQ", null);
    const after = await recomputePosition(pos.id);
    assert.equal(after!.cachedUnpriced, true);
    assert.equal(after!.cachedReturnPct, null, "must be null, never -1 or 0");
  });

  await check("scaling in moves the average entry", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "SCALE",
      openedAt: new Date("2026-02-01T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec("100") }],
    });
    created.push(pos.id);
    const leg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: pos.id } });

    // A second entry at 200 on the same leg: one more unit at a different price.
    const exec = await prisma.managedExecution.create({
      data: { positionId: pos.id, intent: "OPEN", units: 1, executedAt: new Date("2026-02-10T00:00:00Z") },
    });
    await prisma.managedFill.create({
      data: {
        executionId: exec.id,
        legId: leg.id,
        positionId: pos.id,
        intent: "OPEN",
        side: "BUY",
        quantity: 1,
        price: "200",
        multiplier: 1,
        cashFlow: "-200",
        executedAt: new Date("2026-02-10T00:00:00Z"),
      },
    });

    await recomputePosition(pos.id);
    const reread = await prisma.managedLeg.findUniqueOrThrow({ where: { id: leg.id } });
    assert.equal(reread.openQty, 2, "both entries are open");
    assert.equal(num(reread.wavgEntry), 150, "average of 100 and 200");
  });

  await check("a partial exit closes part and leaves the rest open", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "PART",
      openedAt: new Date("2026-03-01T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec("50") }],
      units: 4,
    });
    created.push(pos.id);
    const leg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: pos.id } });

    await closePosition({
      positionId: pos.id,
      executedAt: new Date("2026-03-15T00:00:00Z"),
      prices: { [leg.id]: dec("75") },
      quantities: { [leg.id]: 1 },
      comment: "Took a quarter off",
    });

    const midLeg = await prisma.managedLeg.findUniqueOrThrow({ where: { id: leg.id } });
    assert.equal(midLeg.openQty, 3, "3 of 4 still open");
    assert.equal(midLeg.closedQty, 1);
    assert.equal(num(midLeg.realizedPnl), 25, "one unit from 50 to 75");

    const midPos = await prisma.managedPosition.findUniqueOrThrow({ where: { id: pos.id } });
    assert.equal(midPos.status, "OPEN", "a partial exit must not close the position");

    // Now close the remainder.
    await closePosition({
      positionId: pos.id,
      executedAt: new Date("2026-04-01T00:00:00Z"),
      prices: { [leg.id]: dec("100") },
    });
    const endLeg = await prisma.managedLeg.findUniqueOrThrow({ where: { id: leg.id } });
    const endPos = await prisma.managedPosition.findUniqueOrThrow({ where: { id: pos.id } });
    assert.equal(endLeg.openQty, 0);
    assert.equal(num(endLeg.realizedPnl), 25 + 150, "25 on one unit, 50 each on three");
    assert.equal(endPos.status, "CLOSED");
    assert.ok(endPos.closedAt, "a closed position records when");
  });

  await check("closing more than is open is refused", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "OVER",
      openedAt: new Date("2026-03-01T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec("10") }],
    });
    created.push(pos.id);
    const leg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: pos.id } });
    await assert.rejects(
      () =>
        closePosition({
          positionId: pos.id,
          executedAt: new Date(),
          prices: { [leg.id]: dec("12") },
          quantities: { [leg.id]: 5 },
        }),
      /only 1 is open/
    );
  });

  await check("re-closing an already closed leg is refused", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "TWICE",
      openedAt: new Date("2026-03-01T00:00:00Z"),
      legs: [{ kind: "STOCK", side: "BUY", price: dec("10") }],
    });
    created.push(pos.id);
    const leg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: pos.id } });
    await closePosition({
      positionId: pos.id,
      executedAt: new Date(),
      prices: { [leg.id]: dec("11") },
    });
    await assert.rejects(
      () =>
        closePosition({
          positionId: pos.id,
          executedAt: new Date(),
          prices: { [leg.id]: dec("12") },
        }),
      /already closed/
    );
  });

  console.log("\noption positions");

  await check("a single long call builds an OCC ticker and a readable label", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "NVDA",
      openedAt: new Date("2026-01-05T00:00:00Z"),
      legs: [
        {
          kind: "OPTION",
          side: "BUY",
          price: dec("12.50"),
          expiry: "2027-01-15",
          strike: dec("200"),
          right: "CALL",
        },
      ],
    });
    created.push(pos.id);
    assert.equal(pos.instrument, "OPTION");
    assert.equal(pos.structure, "LONG_CALL");

    const leg = await prisma.managedLeg.findFirstOrThrow({ where: { positionId: pos.id } });
    assert.equal(
      leg.marketTicker,
      "O:NVDA270115C00200000",
      "strike x1000, zero-padded to 8"
    );
    assert.equal(leg.multiplier, 100, "options carry a 100 multiplier");
    assert.ok(pos.label.includes("NVDA"), `label was "${pos.label}"`);

    await setPrice(leg.marketTicker, 25);
    const after = await recomputePosition(pos.id);
    assert.equal(num(after!.cachedReturnPct), 1, "12.50 to 25.00 is +100%");
  });

  await check("a call debit spread measures return on its net debit", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "SPY",
      openedAt: new Date("2026-01-05T00:00:00Z"),
      legs: [
        { kind: "OPTION", side: "BUY", price: dec("10"), expiry: "2026-06-18", strike: dec("550"), right: "CALL" },
        { kind: "OPTION", side: "SELL", price: dec("4"), expiry: "2026-06-18", strike: dec("560"), right: "CALL" },
      ],
    });
    created.push(pos.id);
    assert.equal(pos.structure, "VERTICAL_DEBIT", `got ${pos.structure}`);

    const legs = await prisma.managedLeg.findMany({
      where: { positionId: pos.id },
      orderBy: { legIndex: "asc" },
    });
    // Net debit = 10 paid - 4 received = 6.
    await setPrice(legs[0].marketTicker, 15);
    await setPrice(legs[1].marketTicker, 6);
    const after = await recomputePosition(pos.id);
    // Now worth 15 - 6 = 9, against a 6 basis => +50%.
    assert.equal(num(after!.cachedEntryPrice), 6, "basis is the net debit");
    assert.equal(num(after!.cachedReturnPct), 0.5);
  });

  await check("one leg of a spread can be closed on its own", async () => {
    const pos = await createPosition({
      portfolioId: P,
      underlying: "QQQ",
      openedAt: new Date("2026-01-05T00:00:00Z"),
      legs: [
        { kind: "OPTION", side: "BUY", price: dec("8"), expiry: "2026-06-18", strike: dec("500"), right: "CALL" },
        { kind: "OPTION", side: "SELL", price: dec("3"), expiry: "2026-06-18", strike: dec("510"), right: "CALL" },
      ],
    });
    created.push(pos.id);
    const legs = await prisma.managedLeg.findMany({
      where: { positionId: pos.id },
      orderBy: { legIndex: "asc" },
    });

    await closePosition({
      positionId: pos.id,
      executedAt: new Date("2026-02-01T00:00:00Z"),
      prices: { [legs[1].id]: dec("1") }, // buy back the short leg only
      comment: "Bought back the short side",
    });

    const shortLeg = await prisma.managedLeg.findUniqueOrThrow({ where: { id: legs[1].id } });
    const longLeg = await prisma.managedLeg.findUniqueOrThrow({ where: { id: legs[0].id } });
    const after = await prisma.managedPosition.findUniqueOrThrow({ where: { id: pos.id } });
    assert.equal(shortLeg.openQty, 0, "short leg is closed");
    assert.equal(longLeg.openQty, 1, "long leg keeps running");
    assert.equal(after.status, "OPEN", "the position is still open");
    assert.equal(num(shortLeg.realizedPnl), 200, "sold at 3, bought back at 1, x100");

    const exec = await prisma.managedExecution.findFirstOrThrow({
      where: { positionId: pos.id, intent: "CLOSE" },
    });
    assert.equal(exec.leggedOut, true, "flagged as a legged-out close");
  });

  await check("a rejected leg spec fails loudly, not silently", async () => {
    await assert.rejects(
      () =>
        createPosition({
          portfolioId: P,
          underlying: "BAD",
          openedAt: new Date(),
          legs: [{ kind: "OPTION", side: "BUY", price: dec("1"), strike: dec("100") }],
        }),
      /expiry/
    );
    await assert.rejects(
      () =>
        createPosition({
          portfolioId: P,
          underlying: "BAD",
          openedAt: new Date(),
          legs: [{ kind: "STOCK", side: "BUY", price: dec("0") }],
        }),
      /greater than zero/
    );
  });

  // ----------------------------------------------------------------- cleanup
  await prisma.managedPosition.deleteMany({ where: { portfolioId: P } });
  await prisma.managedPortfolio.delete({ where: { id: P } });
  await prisma.service.delete({ where: { id: service.id } });
  await prisma.marketInstrument.deleteMany({
    where: {
      underlying: {
        in: ["AAPL", "ILLIQ", "SCALE", "PART", "OVER", "TWICE", "NVDA", "SPY", "QQQ"],
      },
    },
  });

  console.log(failures === 0 ? "\nall position tests passed\n" : `\n${failures} FAILED\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
