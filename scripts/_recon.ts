import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";

async function main() {
  const trades = JSON.parse(readFileSync(process.argv[2], "utf8")) as any[];
  // Rebuild the same keys the importer assigns.
  const seen = new Map<string, number>();
  const expect = new Map<string, any>();
  for (const t of trades) {
    const base = ["sheet", t.pubCode, t.symbol, t.openedAt, t.closedAt,
                  t.entry.toFixed(6), t.exit.toFixed(6)].join(":");
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    expect.set(`${base}:${n}`, t);
  }

  const rows = await prisma.managedPosition.findMany({
    where: { source: "SHEET_IMPORT", status: "CLOSED" },
    select: { externalKey: true, cachedReturnPct: true, cachedEntryPrice: true, label: true },
  });

  let ok = 0; const bad: any[] = []; let negEntry = 0;
  for (const r of rows) {
    const t = expect.get(r.externalKey!);
    if (!t) continue;
    if (r.cachedEntryPrice !== null && Number(r.cachedEntryPrice.toString()) < 0) negEntry++;
    const got = r.cachedReturnPct === null ? null : Number(r.cachedReturnPct.toString());
    if (got !== null && Math.abs(got - t.sheetReturn) < 0.0005) ok++;
    else bad.push({ key: r.externalKey, label: r.label, got, want: t.sheetReturn, side: t.side, spread: t.spread, entry: r.cachedEntryPrice?.toString() });
  }
  console.log(`checked ${rows.length} closed imports`);
  console.log(`  return matches the sheet : ${ok}`);
  console.log(`  MISMATCH                 : ${bad.length}`);
  console.log(`  negative cached entry    : ${negEntry}`);
  const byShape = new Map<string, number>();
  for (const b of bad) byShape.set(`${b.side}/${b.spread}`, (byShape.get(`${b.side}/${b.spread}`) ?? 0) + 1);
  for (const [k, v] of [...byShape].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`     ${k.padEnd(20)} ${v}`);
  for (const b of bad.slice(0, 5)) console.log(`     ${b.label} got=${b.got} want=${b.want} entry=${b.entry} (${b.side}/${b.spread})`);
  await prisma.$disconnect();
}
main();
