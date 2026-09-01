/**
 * Pull Buy Up To prices for the Disruptor 25 Portfolio from the published index
 * page.
 *
 *   npm run sync:disruptor              # dry run
 *   npm run sync:disruptor -- --apply
 *
 * ONE WAY, and only one field. Buy Up To is written; Stop-Loss is never
 * touched. The page's stop-loss column was, at the time this was written,
 * a copy of the buy-up-to value on all 25 rows — a stop at or above the entry
 * price for 24 of them — so it is deliberately not read. If that column later
 * carries real levels, add it here explicitly rather than by widening the
 * parser.
 *
 * The index is rebalanced quarterly, so this is built to be re-run. It reports
 * what it would change and refuses to guess at a ticker it cannot match.
 */
import { prisma } from "../lib/prisma";

const URL_ = "https://reports.mccallinnovationreport.com/disruptor-25-index";
const PORTFOLIO_SLUG = "disruptor-25-portfolio";
const APPLY = process.argv.includes("--apply");

interface Row {
  ticker: string;
  company: string;
  buyUpTo: number;
}

const TICKER = /^[A-Z][A-Z0-9.\-]{0,6}$/;
const PRICE = /^\$?[\d,]+(?:\.\d+)?$/;

/**
 * Read the table out of the page.
 *
 * The page is a rich-text document whose content ships as ProseMirror JSON
 * inside the HTML; the visible <tr> elements only exist after React hydrates,
 * so there is nothing to scrape with a DOM parser and nothing behind it to call
 * — the single network request IS the page.
 *
 * Rather than trying to reconstruct the table's shape, this reads the ordered
 * stream of text nodes and cuts a row each time it sees ticker … price. That
 * survives a company name split across several nodes, which a fixed
 * three-cells-per-row chunking would not.
 */
export function parseRows(html: string): Row[] {
  const start = html.indexOf("Buy Up To Price");
  if (start < 0) throw new Error("no 'Buy Up To Price' header on the page");

  const texts: string[] = [];
  const re = /"text":"((?:[^"\\]|\\.)*)"/g;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    // JSON.parse handles the escapes (&, quotes, unicode) the page encodes.
    texts.push(JSON.parse(`"${m[1]}"`).trim());
  }

  const rows: Row[] = [];
  let ticker: string | null = null;
  let words: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    if (ticker === null) {
      if (TICKER.test(t)) ticker = t;
      continue;
    }
    if (PRICE.test(t)) {
      rows.push({
        ticker,
        company: words.join(" ").trim(),
        buyUpTo: Number(t.replace(/[$,]/g, "")),
      });
      ticker = null;
      words = [];
      continue;
    }
    // Everything between the ticker and the price is the company name —
    // including when it is itself ticker-shaped. GRAIL's row reads
    // "GRAL | GRAIL | 85.59", and treating that second all-caps token as a new
    // ticker dropped the real one and invented a position in "GRAIL".
    words.push(t);
  }
  return rows;
}

async function main() {
  const res = await fetch(URL_, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`page returned ${res.status}`);
  const rows = parseRows(await res.text());
  console.log(`parsed ${rows.length} rows from the index page`);
  if (rows.length === 0) throw new Error("parsed nothing — the page layout changed");

  const portfolio = await prisma.managedPortfolio.findUnique({
    where: { slug: PORTFOLIO_SLUG },
    include: {
      positions: {
        where: { deletedAt: null },
        select: { id: true, underlying: true, label: true, buyUpToPrice: true },
      },
    },
  });
  if (!portfolio) throw new Error(`no portfolio with slug ${PORTFOLIO_SLUG}`);

  const byTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r]));
  const changes: { id: string; label: string; from: string; to: number }[] = [];
  const unmatchedPositions: string[] = [];

  for (const p of portfolio.positions) {
    const row = byTicker.get(p.underlying.toUpperCase());
    if (!row) {
      unmatchedPositions.push(p.underlying);
      continue;
    }
    const current = p.buyUpToPrice === null ? null : Number(p.buyUpToPrice.toString());
    if (current !== null && Math.abs(current - row.buyUpTo) < 1e-6) continue;
    changes.push({
      id: p.id,
      label: p.label,
      from: current === null ? "—" : current.toString(),
      to: row.buyUpTo,
    });
  }

  const held = new Set(portfolio.positions.map((p) => p.underlying.toUpperCase()));
  const unmatchedRows = rows.filter((r) => !held.has(r.ticker.toUpperCase()));

  console.log(`\n${portfolio.name}: ${portfolio.positions.length} positions`);
  console.log(`  would set Buy Up To on ${changes.length}`);
  for (const c of changes) console.log(`    ${c.label.padEnd(10)} ${c.from} -> ${c.to}`);

  // Both directions reported: the index is rebalanced quarterly, so a name on
  // one side and not the other is the signal that a change needs making here.
  if (unmatchedPositions.length)
    console.log(`\n  held but NOT on the index page (left alone): ${unmatchedPositions.join(", ")}`);
  if (unmatchedRows.length)
    console.log(`  on the index page but NOT held: ${unmatchedRows.map((r) => r.ticker).join(", ")}`);

  if (!APPLY) {
    console.log("\ndry run — re-run with --apply to write these");
    await prisma.$disconnect();
    return;
  }

  for (const c of changes) {
    await prisma.managedPosition.update({
      where: { id: c.id },
      // Stop-loss deliberately absent — see the note at the top of this file.
      data: { buyUpToPrice: c.to.toString() },
    });
  }
  console.log(`\nupdated ${changes.length} positions`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
