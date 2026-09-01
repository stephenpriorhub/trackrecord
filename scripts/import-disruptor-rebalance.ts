/**
 * The six names dropped from the Disruptor 25 at the 30 June 2026 rebalance.
 *
 * WHY THESE ARE HAND-ENTERED
 *   They exist in neither source the app can reach. The index page publishes
 *   only current constituents, and the Airtable base has no XAI record for
 *   IRTC, ARRY, NU or RCAT at all — searched across all 23,972 positions. The
 *   figures below are transcribed from the published Disruptor 25 closed-
 *   positions report.
 *
 *   The arithmetic is the safeguard. Every row carries the return the report
 *   states, and this refuses to import unless exit/entry reproduces it to
 *   within a basis point — a misread digit changes the quotient and stops the
 *   run, which a bare transcription would not.
 *
 *   That the set is exactly right is corroborated independently: the portfolio
 *   holds 19 positions opened 2026-01-01 and 6 opened at the rebalance, so 19
 *   held + these 6 dropped = the original 25.
 *
 *   npm run import:d25-rebalance             # dry run
 *   npm run import:d25-rebalance -- --apply
 */
import { prisma } from "./../lib/prisma";
import { dec } from "../lib/money";
import { createPosition, closePosition } from "../lib/managed/positions";

const PORTFOLIO_SLUG = "disruptor-25-portfolio";
const OPENED = "2026-01-01";
const CLOSED = "2026-06-30";
const APPLY = process.argv.includes("--apply");

interface Dropped {
  ticker: string;
  company: string;
  entry: number;
  exit: number;
  /** As published, for the arithmetic check below. */
  statedReturn: number;
}

const DROPPED: Dropped[] = [
  { ticker: "IRTC", company: "iRhythm Holdings", entry: 177.44, exit: 118.95, statedReturn: -0.3296 },
  { ticker: "ARRY", company: "Array Technologies", entry: 9.22, exit: 7.41, statedReturn: -0.1963 },
  { ticker: "NU", company: "NU Holdings", entry: 16.74, exit: 13.36, statedReturn: -0.2019 },
  { ticker: "APLD", company: "Applied Digital", entry: 24.52, exit: 37.3, statedReturn: 0.5212 },
  { ticker: "RCAT", company: "Red Cat Holdings", entry: 7.93, exit: 10.65, statedReturn: 0.343 },
  { ticker: "BE", company: "Bloom Energy", entry: 86.89, exit: 302.7, statedReturn: 2.4837 },
];

async function main() {
  const bad = DROPPED.filter(
    (d) => Math.abs(d.exit / d.entry - 1 - d.statedReturn) > 0.0001,
  );
  if (bad.length) {
    console.error("These rows do not reproduce their published return:");
    for (const d of bad)
      console.error(
        `  ${d.ticker}: ${d.entry} -> ${d.exit} gives ${((d.exit / d.entry - 1) * 100).toFixed(2)}%, report says ${(d.statedReturn * 100).toFixed(2)}%`,
      );
    process.exit(1);
  }
  console.log(`all ${DROPPED.length} rows reproduce their published return`);

  const portfolio = await prisma.managedPortfolio.findUnique({
    where: { slug: PORTFOLIO_SLUG },
    select: { id: true, name: true },
  });
  if (!portfolio) throw new Error(`no portfolio ${PORTFOLIO_SLUG}`);

  const todo: Dropped[] = [];
  for (const d of DROPPED) {
    const key = externalKey(d);
    const exists = await prisma.managedPosition.findUnique({
      where: { externalKey: key },
      select: { id: true },
    });
    if (exists) continue;
    todo.push(d);
  }

  console.log(`\n${portfolio.name}`);
  console.log(`  already present : ${DROPPED.length - todo.length}`);
  console.log(`  to add          : ${todo.length}`);
  for (const d of todo)
    console.log(
      `    ${d.ticker.padEnd(5)} ${d.company.padEnd(20)} ${d.entry} -> ${d.exit}  ${((d.exit / d.entry - 1) * 100).toFixed(2)}%`,
    );

  if (!APPLY) {
    console.log("\ndry run — re-run with --apply to write these");
    await prisma.$disconnect();
    return;
  }

  for (const d of todo) {
    const position = await createPosition({
      portfolioId: portfolio.id,
      underlying: d.ticker,
      companyName: d.company,
      openedAt: new Date(`${OPENED}T00:00:00Z`),
      units: 1,
      source: "MANUAL",
      externalKey: externalKey(d),
      guruSlug: "matt",
      legs: [{ kind: "STOCK", side: "BUY", price: dec(d.entry.toFixed(6)) }],
      thesis:
        `Removed from the Disruptor 25 at the ${CLOSED} quarterly rebalance. ` +
        `Entered from the published closed-positions report; the index page ` +
        `lists current constituents only.`,
    });
    const legs = await prisma.managedLeg.findMany({
      where: { positionId: position.id },
      select: { id: true },
    });
    await closePosition({
      positionId: position.id,
      executedAt: new Date(`${CLOSED}T00:00:00Z`),
      prices: Object.fromEntries(legs.map((l) => [l.id, dec(d.exit.toFixed(6))])),
      note: `Rebalanced out of the index on ${CLOSED}.`,
    });
    console.log(`  added ${d.ticker}`);
  }
  console.log(`\nadded ${todo.length} closed positions`);
  await prisma.$disconnect();
}

function externalKey(d: Dropped): string {
  return `d25-rebalance:${CLOSED}:${d.ticker}`;
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
