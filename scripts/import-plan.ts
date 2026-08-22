/**
 * Dry-run the Airtable import and print what WOULD happen. Writes nothing.
 * Usage: npm run import:plan -- XAI
 */
import { planImport } from "../lib/managed/import";

async function main() {
  const pub = process.argv[2];
  if (!pub) throw new Error("Pass a pub code, e.g. XAI");
  const plan = await planImport(pub);

  console.log(`\n${plan.serviceName} (${plan.pubCode})`);
  console.log(`Airtable portfolios: ${plan.airtablePortfolios.join(", ") || "none"}`);
  console.log(`\n${plan.portfolios.length} portfolios, ${plan.totalPositions} positions:\n`);
  for (const p of plan.portfolios) {
    const done = p.alreadyImported ? `  (${p.alreadyImported} already imported)` : "";
    const sort = p.sortOrder !== null ? ` [sort ${p.sortOrder}]` : "";
    console.log(`  ${String(p.positions).padStart(5)}  ${p.name}${sort}${done}`);
  }
  if (plan.skipped.length) {
    console.log("\nskipped:");
    for (const s of plan.skipped) console.log(`  ${s.count}  ${s.reason}`);
  }
  if (plan.warnings.length) {
    console.log("\nwarnings:");
    for (const w of plan.warnings) console.log(`  ! ${w}`);
  }
  console.log();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
