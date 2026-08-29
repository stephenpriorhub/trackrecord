/**
 * Load the published track-record spreadsheets into Portfolio Manager.
 *
 * These sheets are the CLOSED history of Daily Profits Live, Profit Surge Trader
 * and Nate Bear's Sector Strike. Airtable holds only their open book — three
 * positions for Sector Strike against forty-one closed trades here — so without
 * this import those publications have almost no track record in the app.
 *
 * Reads the JSON that scripts/extract-sheet-trades.py produces; see that file
 * for why the sheets cannot be read as CSV and why Return % is taken verbatim.
 *
 *   python3 scripts/extract-sheet-trades.py --out /tmp/trades.json
 *   npm run import:sheets -- --file /tmp/trades.json            # plan
 *   npm run import:sheets -- --file /tmp/trades.json --apply    # commit
 *
 * Idempotent on ManagedPosition.externalKey: re-running adds only what is new,
 * so refreshing after the publisher updates a sheet is safe.
 */
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { dec } from "../lib/money";
import { createPosition, closePosition } from "../lib/managed/positions";
import { PUB_NAMES } from "../lib/publications";
import { soleEditor } from "../lib/managed/gurus";

interface SheetTrade {
  row: number;
  rowKind: "main" | "fill";
  status: string;
  portfolio: string;
  pubCode: string | null;
  symbol: string;
  openedAt: string;
  closedAt: string;
  entry: number;
  exit: number;
  units: number;
  kind: "STOCK" | "OPTION";
  right: "CALL" | "PUT" | null;
  strike: number | null;
  expiry: string | null;
  side: "BUY" | "SELL";
  spread: string;
  multiLeg: boolean;
  sheetReturn: number | null;
  occ: string | null;
  source: string;
}

/** Every closed sheet trade lands in the publication's main book. */
const PORTFOLIO_NAME = "Main Portfolio";
const CONCURRENCY = 20;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes("--apply");
const FILE = arg("file");
const ONLY_PUBS = arg("pub")?.split(",").map((s) => s.trim().toUpperCase());
const LIMIT = Number(arg("limit") ?? 0);

function slugify(s: string): string {
  return s
    .normalize("NFD")
    // Combining marks written as escapes: the literal characters do not survive
    // a shell heredoc, and a mangled class silently stops stripping accents.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A stable identity for a sheet row.
 *
 * Built from what the trade IS rather than where it sat, so inserting a row into
 * the sheet does not re-key everything below it. Genuinely identical trades —
 * same symbol, dates and prices — are disambiguated by an ordinal, because a
 * service really can open the same contract twice in a day.
 */
function externalKey(t: SheetTrade, ordinal: number): string {
  const money = (n: number) => n.toFixed(6);
  return [
    "sheet",
    t.pubCode,
    t.symbol,
    t.openedAt,
    t.closedAt,
    money(t.entry),
    money(t.exit),
    ordinal,
  ].join(":");
}

async function ensureService(pubCode: string) {
  const name = PUB_NAMES[pubCode] ?? pubCode;
  return prisma.service.upsert({
    where: { pubCode },
    update: {},
    create: { pubCode, name, slug: slugify(name) },
  });
}

async function ensurePortfolio(serviceId: string, pubCode: string) {
  const existing = await prisma.managedPortfolio.findFirst({
    where: { serviceId, name: PORTFOLIO_NAME },
  });
  if (existing) return existing;
  // Slug collides across services (every publication has a "Main Portfolio"),
  // so it is qualified by pub code rather than left to a bare slugify.
  return prisma.managedPortfolio.create({
    data: {
      serviceId,
      name: PORTFOLIO_NAME,
      slug: `${slugify(PUB_NAMES[pubCode] ?? pubCode)}-main`,
    },
  });
}

/**
 * What the source said about a trade that the position itself cannot express:
 * the spread it was, and the direction, since everything is stored on a cost
 * basis. Null when there is nothing extra to say.
 */
function describeSource(t: SheetTrade): string | null {
  const notes: string[] = [];
  if (t.multiLeg) {
    notes.push(
      `The published track record shows this as a ${t.spread.toLowerCase()} ` +
        `but does not break out its legs, so it is carried as a single ` +
        `position at the net.`,
    );
  }
  if (t.side === "SELL") {
    notes.push(
      `Recorded as a SHORT position. Entry and return are stated against ` +
        `capital at risk, which is the basis the published record uses.`,
    );
  }
  return notes.length ? notes.join(" ") : null;
}

/** Import one trade as an opened-then-closed position. */
async function importTrade(
  t: SheetTrade,
  portfolioId: string,
  key: string,
  guruSlug: string | null,
) {
  const position = await createPosition({
    portfolioId,
    underlying: t.symbol,
    openedAt: new Date(`${t.openedAt}T00:00:00Z`),
    units: t.units,
    source: "SHEET_IMPORT",
    externalKey: key,
    guruSlug,
    // Relaxes exactly one rule: an option leg may go without call/put, which is
    // how the sheets record most of their history. See CreatePositionInput.
    historical: true,
    legs: [
      {
        kind: t.kind,
        // ALWAYS BUY, even where the sheet says SHORT.
        //
        // The entry here is Cost / (units x multiplier) — capital at risk — and
        // the published Return % is P&L against that cost. Our engine reads a
        // SELL open as a credit and gives the position a NEGATIVE basis, which
        // measures the return against the credit received instead. Same trade,
        // different denominator, and the sign comes out inverted: an AMD credit
        // spread the record publishes at -47.5% was stored as +47.5%.
        //
        // A positive cost basis is what reproduces the published figure, so
        // that is what is stored. The direction the sheet stated is kept on the
        // position rather than thrown away — see thesis below.
        side: "BUY",
        price: dec(t.entry.toFixed(6)),
        ...(t.kind === "OPTION"
          ? {
              expiry: t.expiry ?? undefined,
              strike: t.strike !== null ? dec(t.strike.toFixed(6)) : undefined,
              right: t.right ?? undefined,
            }
          : {}),
      },
    ],
    // A spread is carried as one synthetic position priced at the net, because
    // a single sheet row does not name its legs. Saying so on the position is
    // the only honest way to publish it.
    thesis: describeSource(t),
  });

  const legs = await prisma.managedLeg.findMany({
    where: { positionId: position.id },
    select: { id: true },
  });
  await closePosition({
    positionId: position.id,
    executedAt: new Date(`${t.closedAt}T00:00:00Z`),
    prices: Object.fromEntries(
      legs.map((l) => [l.id, dec(Math.max(0, t.exit).toFixed(6))]),
    ),
  });
}

/** Run tasks with a bounded number in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    }),
  );
}

async function main() {
  if (!FILE) {
    console.error(
      "Usage: npm run import:sheets -- --file <trades.json> [--pub NBS] [--limit N] [--apply]",
    );
    process.exit(1);
  }
  const all: SheetTrade[] = JSON.parse(readFileSync(FILE, "utf8"));

  const unrouted = all.filter((t) => !t.pubCode);
  const trades = all.filter(
    (t) => t.pubCode && (!ONLY_PUBS || ONLY_PUBS.includes(t.pubCode)),
  );

  // Ordinals are assigned over the WHOLE file, before any filtering, so a
  // --pub or --limit run produces the same keys as a full one.
  const seen = new Map<string, number>();
  const keyed = all.map((t) => {
    const base = externalKey(t, 0).slice(0, -2);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { trade: t, key: externalKey(t, n) };
  });
  const keyOf = new Map(keyed.map((k) => [k.trade, k.key]));

  const existing = new Set(
    (
      await prisma.managedPosition.findMany({
        where: { externalKey: { not: null } },
        select: { externalKey: true },
      })
    ).map((p) => p.externalKey as string),
  );

  let todo = trades.filter((t) => !existing.has(keyOf.get(t)!));
  const already = trades.length - todo.length;
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  const byPub = new Map<string, SheetTrade[]>();
  for (const t of todo) {
    const list = byPub.get(t.pubCode!) ?? [];
    list.push(t);
    byPub.set(t.pubCode!, list);
  }

  console.log(`file            ${FILE}`);
  console.log(`trades in file  ${all.length}`);
  if (unrouted.length)
    console.log(`unrouted        ${unrouted.length}  (no portfolio match — skipped)`);
  console.log(`already imported ${already}`);
  console.log(`to import       ${todo.length}${LIMIT > 0 ? `  (--limit ${LIMIT})` : ""}`);
  console.log("");
  for (const [pub, list] of [...byPub].sort()) {
    const closedRet = list.reduce((a, t) => a + (t.sheetReturn ?? 0), 0);
    console.log(
      `  ${pub.padEnd(4)} ${PUB_NAMES[pub] ?? pub}`.padEnd(46) +
        `${String(list.length).padStart(5)} trades  ` +
        `avg ${((closedRet / list.length) * 100).toFixed(2)}%  ` +
        `owner: ${soleEditor(pub) ?? "unattributed"}`,
    );
  }

  if (!APPLY) {
    console.log("\ndry run — re-run with --apply to write these positions");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  const failures: { key: string; error: string }[] = [];
  for (const [pub, list] of [...byPub].sort()) {
    const service = await ensureService(pub);
    const portfolio = await ensurePortfolio(service.id, pub);
    // These three publications each have exactly one editor, so an empty
    // person field is not ambiguous — there is only one name it could be.
    const guruSlug = soleEditor(pub);
    console.log(`\n${pub} -> ${service.name} / ${portfolio.name}`);

    await pool(list, CONCURRENCY, async (t) => {
      const key = keyOf.get(t)!;
      try {
        await importTrade(t, portfolio.id, key, guruSlug);
      } catch (e) {
        failures.push({ key, error: e instanceof Error ? e.message : String(e) });
      }
      done += 1;
      if (done % 200 === 0) console.log(`  ${done}/${todo.length}`);
    });
  }

  console.log(`\nimported ${done - failures.length} of ${todo.length}`);
  if (failures.length) {
    const byError = new Map<string, number>();
    for (const f of failures)
      byError.set(f.error, (byError.get(f.error) ?? 0) + 1);
    console.log(`\n${failures.length} FAILED:`);
    for (const [err, n] of [...byError].sort((a, b) => b[1] - a[1]).slice(0, 10))
      console.log(`  ${String(n).padStart(5)}  ${err}`);
    console.log("  examples:");
    for (const f of failures.slice(0, 5)) console.log(`    ${f.key}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
