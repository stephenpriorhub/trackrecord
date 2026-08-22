/**
 * Commit the Airtable import for one publication.
 * Usage: npm run import:commit -- XAI [limit]
 * Run npm run import:plan first — this WRITES.
 */
import { commitImport } from "../lib/managed/import";

async function main() {
  const pub = process.argv[2];
  if (!pub) throw new Error("Pass a pub code, e.g. XAI");
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;

  const r = await commitImport(pub, { limit, actorEmail: "import@oxfordhub.app" });
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
