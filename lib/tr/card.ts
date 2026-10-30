/**
 * What a service's summary card shows: one stats table per view (All, or the
 * War Room's Combined / Bryan / Karim, PMK's books, Trend Advisory's brands)
 * plus a note on any book kept out of the headline. Shared by the home page
 * and the wiki's summary API so the two can never publish different numbers.
 */
import { int, pct } from "./format";
import { summarise, type SummaryTrade } from "./queries";
import type { ServiceDef } from "./services";
import { statsByPeriod, todayNY, type PeriodKey, type PeriodStats } from "./stats";

export interface CardView {
  key: string;
  label: string;
  stats: Record<PeriodKey, PeriodStats>;
}

export function serviceCardData(def: ServiceDef, trades: SummaryTrade[], today = todayNY()): { views: CardView[]; note?: string } {
  const summary = summarise(def, trades, today);
  const views: CardView[] = [{ key: "all", label: def.byGuru ? "Combined" : "All", stats: summary.headline }];
  if (def.bookTables) {
    // One view per brand, each with its own figures (Trend Advisory first).
    views.splice(0, 1);
    for (const sp of def.subPortfolios) {
      const g = summary.groups.find((x) => x.kind === "portfolio" && x.key === sp.key);
      if (g) views.push({ key: sp.key, label: sp.years ? `${sp.label.replace(/^Monument /, "")} (${sp.years})` : sp.label, stats: g.stats });
    }
  }
  if (def.bookToggle) {
    for (const sp of def.subPortfolios) {
      const g = summary.groups.find((x) => x.kind === "portfolio" && x.key === sp.key);
      if (g) views.push({ key: sp.key, label: sp.label, stats: g.stats });
    }
  }
  if (def.byGuru) {
    for (const g of summary.groups.filter((x) => x.kind === "guru")) {
      views.push({ key: g.key, label: g.label.split(" ")[0], stats: g.stats });
    }
  }
  const excluded = def.bookTables ? [] : def.subPortfolios.filter((p) => !p.inHeadline);
  let note: string | undefined;
  if (excluded.length) {
    const ex = statsByPeriod(trades.filter((t) => excluded.some((p) => p.key === t.portfolio)), today).inception;
    note = `${excluded.map((p) => p.label).join(", ")} trades are tracked separately (${int(ex.closed)} trades, ${pct(ex.avgReturn)} avg.).`;
  }
  return { views, note };
}
