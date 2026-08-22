/**
 * Repoint stock legs that were imported with punctuation stripped from their
 * ticker.
 *
 * createPosition used to build a stock leg's market ticker with the OCC
 * normaliser, which is letters-only. That is right for an option root — "BRKB"
 * — and wrong for the symbol that prices, which is "BRK.B". Affected legs were
 * fetched forever and never priced, so the position showed no return.
 *
 * Only touches STOCK legs whose instrument has been CHECKED and still has no
 * price, and only when the punctuated form actually prices. Anything already
 * working is left alone, and a ticker no feed covers stays as it is rather than
 * being rewritten on a guess.
 *
 * Usage: npm run repair:tickers [-- --apply]     (dry run without --apply)
 */
import { PrismaClient } from "@prisma/client";
import { fetchSnapshots } from "../lib/massive";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** "BRKB" -> candidate punctuated forms, longest suffix first. */
function candidates(ticker: string): string[] {
  if (ticker.includes(".") || ticker.length < 4) return [];
  const out: string[] = [];
  // A class suffix is the last 1-2 characters: BRKB -> BRK.B, WFCPZ -> WFC.PZ.
  for (const n of [1, 2]) {
    if (ticker.length - n >= 2) {
      out.push(`${ticker.slice(0, ticker.length - n)}.${ticker.slice(ticker.length - n)}`);
    }
  }
  return out;
}

async function main() {
  const broken = await prisma.marketInstrument.findMany({
    where: { kind: "STOCK", lastPrice: null, lastCheckedAt: { not: null }, active: true },
    select: { ticker: true },
  });
  if (broken.length === 0) {
    console.log("no unpriced stock instruments — nothing to repair");
    await prisma.$disconnect();
    return;
  }
  console.log(`${broken.length} unpriced stock instruments`);

  const probes = new Map<string, string>(); // candidate -> original
  for (const { ticker } of broken) {
    for (const c of candidates(ticker)) probes.set(c, ticker);
  }
  if (probes.size === 0) {
    console.log("none look like a stripped class suffix");
    await prisma.$disconnect();
    return;
  }

  const snap = await fetchSnapshots([...probes.keys()]);
  const fixes: { from: string; to: string; price: string }[] = [];
  for (const [candidate, original] of probes) {
    const row = snap.rows.get(candidate);
    if (row?.last) fixes.push({ from: original, to: candidate, price: row.last.toString() });
  }

  if (fixes.length === 0) {
    console.log("no punctuated form priced — leaving everything alone");
    await prisma.$disconnect();
    return;
  }

  for (const f of fixes) console.log(`  ${f.from} -> ${f.to}  (${f.price})`);
  if (!APPLY) {
    console.log("\ndry run — re-run with --apply to make these changes");
    await prisma.$disconnect();
    return;
  }

  for (const f of fixes) {
    // The correct instrument may already exist from a later, fixed import.
    await prisma.marketInstrument.upsert({
      where: { ticker: f.to },
      update: { active: true },
      create: { ticker: f.to, kind: "STOCK", underlying: f.to },
    });
    const moved = await prisma.managedLeg.updateMany({
      where: { marketTicker: f.from, kind: "STOCK" },
      data: { marketTicker: f.to },
    });
    // Keep the position's displayed underlying in step with the leg.
    await prisma.managedPosition.updateMany({
      where: { underlying: f.from },
      data: { underlying: f.to },
    });
    // Retire the stripped instrument rather than deleting it: closed history may
    // still reference it, and ManagedLeg.instrument is onDelete: Restrict.
    await prisma.marketInstrument.updateMany({
      where: { ticker: f.from },
      data: { active: false },
    });
    console.log(`  moved ${moved.count} legs ${f.from} -> ${f.to}`);
  }

  console.log("\nrun the price refresh next so the repointed legs pick up a price");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
