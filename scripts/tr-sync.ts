/**
 * Run the sheet sync from the command line.
 *   node --import tsx --env-file=.env scripts/tr-sync.ts [WAR DPL …]
 */
import { syncSheets } from "../lib/tr/sync";

syncSheets(process.argv.slice(2)).then((r) => {
  console.table(r);
  process.exit(r.every((x) => x.ok) ? 0 : 1);
});
