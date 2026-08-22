/**
 * Commit the Airtable import for one publication.
 * Usage: npm run import:commit -- XAI [limit]
 *
 * Run npm run import:plan first — this WRITES. Idempotent on the Airtable record
 * id, so a run capped by `limit` can simply be repeated to top up.
 */
import { commitImport } from "../lib/managed/import";

/**
 * Editorial merge decisions, recorded here rather than applied by hand so the
 * import stays reproducible.
 *
 * Some services accumulated several "main" trade groups in Airtable over the
 * years. They are one book in practice, and importing them as separate
 * portfolios would publish an arbitrary split. Confirmed with Stephen 2026-08-22.
 *
 * Post-Market Profits is deliberately absent: its IWM / QQQ / SPY / GLD groups
 * look like a deliberate split by underlying, not an accident.
 */
const MERGES: Record<string, Record<string, string>> = {
  TPU: {
    "Main Stock & Option Portfolio": "Main Portfolio",
    "Monument Trend Advisory Main Portfolio": "Main Portfolio",
  },
  WAR: {
    // A single stray position, orphaned from the main book.
    "Main Stock & Option Portfolio": "Main Portfolio",
  },
};

async function main() {
  const pub = process.argv[2];
  if (!pub) throw new Error("Pass a pub code, e.g. XAI");
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  const rename = MERGES[pub.toUpperCase()];

  if (rename) {
    console.log("merging:");
    for (const [from, to] of Object.entries(rename)) console.log(`  ${from} -> ${to}`);
  }

  const r = await commitImport(pub, { limit, rename, actorEmail: "import@oxfordhub.app" });
  console.log(`\n${r.pubCode}: ${r.positionsCreated} created, ${r.positionsSkipped} skipped`);
  console.log(`portfolios created: ${r.portfoliosCreated.join(", ") || "none"}`);
  if (r.errors.length) {
    console.log(`\n${r.errors.length} errors:`);
    for (const e of r.errors.slice(0, 20)) console.log(`  ${e.position}: ${e.message}`);
  }
  console.log();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
