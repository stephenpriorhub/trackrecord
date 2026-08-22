/** Refresh prices from Massive. Usage: npm run prices */
import { refreshPrices } from "../lib/managed/pricing";

async function main() {
  const r = await refreshPrices();
  console.log(`\nrequested ${r.requested}, priced ${r.priced} (${r.pricedByNav} via NAV), unpriced ${r.unpriced.length}`);
  console.log(`positions recomputed: ${r.positionsRecomputed}`);
  console.log(`oldest price timestamp: ${r.oldestPriceAt?.toISOString() ?? "none"}`);
  if (r.unpriced.length) console.log(`unpriced: ${r.unpriced.slice(0, 25).join(", ")}`);
  if (r.errors.length) { console.log("errors:"); r.errors.forEach((e) => console.log("  " + e)); }
  console.log();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
