/**
 * Check every imported sheet trade against the row it came from.
 *
 * This is not ceremony. It is the check that caught the import storing short
 * trades with their return INVERTED — 81 positions reading +47.5% where the
 * published record said -47.5% — which nothing else would have surfaced,
 * because each individual position looked entirely plausible on its own.
 *
 * Run it after any import, and after changing anything in lib/managed/positions.ts:
 *
 *   npm run verify:sheets -- --file /tmp/trades.json
 *
 * Reports, per publication: how many stored returns reproduce the published
 * figure, which do not, and the averages both sides produce.
 */
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { PUB_NAMES } from "../lib/publications";

interface Row {
  pubCode: string | null;
  symbol: string;
  openedAt: string;
  closedAt: string;
  entry: number;
  exit: number;
  sheetReturn: number | null;
  side: string;
  spread: string;
}

/** Losses deeper than the capital committed are stored at the -100% floor. */
const FLOOR = -1;
function expected(t: Row): number {
  return Math.max(FLOOR, t.sheetReturn ?? 0);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const file = arg("file");
  if (!file) {
    console.error("Usage: npm run verify:sheets -- --file <trades.json>");
    process.exit(1);
  }
  const trades: Row[] = JSON.parse(readFileSync(file, "utf8"));

  // Rebuild the keys exactly as import-sheets.ts assigns them.
  const seen = new Map<string, number>();
  const expect = new Map<string, Row>();
  for (const t of trades) {
    const base = [
      "sheet", t.pubCode, t.symbol, t.openedAt, t.closedAt,
      t.entry.toFixed(6), t.exit.toFixed(6),
    ].join(":");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    expect.set(`${base}:${n}`, t);
  }

  const stored = await prisma.managedPosition.findMany({
    where: { source: "SHEET_IMPORT", deletedAt: null },
    select: {
      externalKey: true, label: true, status: true,
      cachedReturnPct: true, cachedEntryPrice: true,
      portfolio: { select: { service: { select: { pubCode: true } } } },
    },
  });

  const agg = new Map<string, { ok: number; bad: Row[]; got: number[]; want: number[]; neg: number; open: number }>();
  const badRows: { key: string; label: string; got: number | null; want: number; side: string; spread: string }[] = [];

  for (const p of stored) {
    const pub = p.portfolio.service.pubCode;
    const a = agg.get(pub) ?? { ok: 0, bad: [], got: [], want: [], neg: 0, open: 0 };
    agg.set(pub, a);

    if (p.status !== "CLOSED") a.open += 1;
    if (p.cachedEntryPrice !== null && Number(p.cachedEntryPrice.toString()) < 0) a.neg += 1;

    const t = p.externalKey ? expect.get(p.externalKey) : undefined;
    if (!t) continue;
    const want = expected(t);
    const got = p.cachedReturnPct === null ? null : Number(p.cachedReturnPct.toString());
    a.want.push(want);
    if (got !== null) a.got.push(got);
    if (got !== null && Math.abs(got - want) < 0.0005) a.ok += 1;
    else {
      a.bad.push(t);
      badRows.push({ key: p.externalKey!, label: p.label, got, want, side: t.side, spread: t.spread });
    }
  }

  // Set lookup, not a nested scan: 4,241 rows against 4,241 stored positions is
  // 18 million comparisons the slow way.
  const storedKeys = new Set(stored.map((p) => p.externalKey).filter(Boolean));
  const missing = [...expect].filter(
    ([key, t]) => t.pubCode && !storedKeys.has(key),
  ).length;

  console.log(`stored sheet positions: ${stored.length}   rows in file: ${trades.length}   not yet imported: ${missing}\n`);
  let anyBad = false;
  for (const [pub, a] of [...agg].sort()) {
    const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0);
    console.log(`${pub}  ${PUB_NAMES[pub] ?? pub}`);
    console.log(`   matches published return : ${a.ok}`);
    console.log(`   MISMATCH                 : ${a.bad.length}`);
    console.log(`   negative entry price     : ${a.neg}   still OPEN: ${a.open}`);
    console.log(`   avg return stored ${(mean(a.got) * 100).toFixed(4)}%  vs published ${(mean(a.want) * 100).toFixed(4)}%`);
    if (a.bad.length || a.neg || a.open) anyBad = true;
  }
  if (badRows.length) {
    console.log(`\nfirst mismatches:`);
    for (const b of badRows.slice(0, 10))
      console.log(`   ${b.label.padEnd(30)} got=${b.got} want=${b.want}  (${b.side}/${b.spread})`);
  }
  console.log(anyBad ? "\nFAIL — see above" : "\nOK — every stored return reproduces the published record");
  await prisma.$disconnect();
  process.exit(anyBad ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
