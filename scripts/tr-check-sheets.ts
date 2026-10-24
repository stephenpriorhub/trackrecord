/**
 * Parse the five track-record sheets and print the app's statistics, for
 * comparison with each sheet's own Summary Stats tab. No database.
 *
 *   node --import tsx scripts/tr-check-sheets.ts [--dir <folder of WAR.xlsx…>] [--today YYYY-MM-DD]
 *
 * Without --dir the sheets are downloaded.
 */
import fs from "node:fs";
import path from "node:path";
import { SHEET_SERVICES } from "../lib/tr/services";
import { parseService } from "../lib/tr/sheets/parse";
import { fetchSheetXlsx, readWorkbook } from "../lib/tr/sheets/workbook";
import { PERIOD_LABEL, type PeriodKey, statsByPeriod, todayNY } from "../lib/tr/stats";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dir = arg("--dir");
const today = arg("--today") ?? todayNY();
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(2)}%`);

async function main() {
  for (const s of SHEET_SERVICES) {
    const buf = dir
      ? fs.readFileSync(path.join(dir, `${s.code}.xlsx`))
      : await fetchSheetXlsx(s.sheetId!);
    const wb = await readWorkbook(buf);
    const res = parseService(s.code, wb);
    console.log(`\n===== ${s.name}  (${res.trades.length} trades, ${res.skipped.length} skipped)`);
    for (const sk of res.skipped.slice(0, 5)) console.log("   skipped", sk);
    if (res.pending?.length) console.log("   not yet in Since Inception:", res.pending.map((p) => `${p.symbol}(${p.tab})`).join(", "));
    if (res.crossLabelled?.length) {
      console.log("   labelled as another service:", res.crossLabelled.map((c) => `${c.symbol}(${c.label})`).join(", "));
    }
    const groups: [string, typeof res.trades][] = [["ALL in headline", res.trades.filter((t) => s.subPortfolios.find((p) => p.key === t.portfolio)?.inHeadline ?? true)]];
    for (const p of s.subPortfolios) groups.push([p.label, res.trades.filter((t) => t.portfolio === p.key)]);
    if (s.byGuru) for (const g of s.gurus) groups.push([g, res.trades.filter((t) => t.guru === g)]);
    for (const [label, ts] of groups) {
      const st = statsByPeriod(ts, today);
      console.log(`  -- ${label}`);
      for (const k of Object.keys(st) as PeriodKey[]) {
        const x = st[k];
        console.log(
          `     ${PERIOD_LABEL[k].padEnd(16)} closed ${String(x.closed).padStart(5)}  wins ${String(x.winners).padStart(5)}  avg ${pct(x.avgReturn).padStart(8)}  wavg ${pct(x.weightedAvgReturn).padStart(8)}  days ${x.avgDaysHeld?.toFixed(1) ?? "—"}  win ${pct(x.winRate)}  best ${x.best ? `${x.best.symbol} ${pct(x.best.returnPct)}` : "—"}`,
        );
      }
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
