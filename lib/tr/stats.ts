/**
 * Track-record statistics, computed from stored trades only.
 *
 * Definitions match the publisher's Summary Stats tabs:
 *   - A period holds the trades CLOSED in it (US Eastern calendar).
 *   - Winner = return > 0. Win rate = winners / closed.
 *   - Average return = plain mean of each trade's return.
 *   - Weighted average (War Room) = Σ(return × weight) / Σ(weight).
 *   - Average days held = mean of the hold period.
 *   - Trades opened = positions OPENED in the period, still open or not. A
 *     position the sheet closes in parts (several rows) counts once.
 *   - "This Week" runs Monday to today ("Last Week" the full week before), and also takes trades closed after the
 *     bell on the previous Friday — expirations are stamped Friday evening and
 *     the sheets report them in the following week (DPL's "Note 1").
 *
 * Deliberately absent, by standing rule: number of losers and worst trade.
 */

export interface StatTrade {
  returnPct: number | null;
  weight: number;
  holdDays: number | null;
  openDate: string; // YYYY-MM-DD
  closeDate: string | null;
  closeAfterBell: boolean;
  status: string;
  name: string;
  symbol: string;
  premiumCapture?: number | null;
  airtableId?: string | null;
}

export type PeriodKey = "week" | "lastWeek" | "month" | "year" | "inception";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  week: "This Week",
  lastWeek: "Last Week",
  month: "Month to Date",
  year: "Year to Date",
  inception: "Since Inception",
};

export interface PeriodStats {
  /** Positions opened in the period, open or since closed (statsByPeriod only). */
  opened?: number;
  closed: number;
  winners: number;
  winRate: number | null;
  avgReturn: number | null;
  weightedAvgReturn: number | null;
  avgDaysHeld: number | null;
  best: { name: string; symbol: string; returnPct: number; days: number | null } | null;
}

/** Today's date in New York as YYYY-MM-DD. */
export function todayNY(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
}

export interface PeriodBounds {
  start: string;
  end: string;
  /** Week only: the prior Friday, whose after-bell closes count this week. */
  priorFriday?: string;
}

export function periodBounds(key: PeriodKey, today: string = todayNY()): PeriodBounds {
  switch (key) {
    case "week": {
      const wd = weekday(today);
      const monday = addDays(today, -((wd + 6) % 7));
      return { start: monday, end: today, priorFriday: addDays(monday, -3) };
    }
    case "lastWeek": {
      // The full Monday-Sunday week before this one, with the same rule for
      // the Friday after-bell closes that report in the following week.
      const thisMonday = periodBounds("week", today).start;
      const monday = addDays(thisMonday, -7);
      return { start: monday, end: addDays(thisMonday, -1), priorFriday: addDays(monday, -3) };
    }
    case "month":
      return { start: `${today.slice(0, 7)}-01`, end: today };
    case "year":
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case "inception":
      return { start: "1900-01-01", end: today };
  }
}

export function inPeriod(t: StatTrade, b: PeriodBounds): boolean {
  if (!t.closeDate) return false;
  if (b.priorFriday !== undefined && t.closeAfterBell && weekday(t.closeDate) === 5) {
    // Reported in the following week, and only there.
    return t.closeDate === b.priorFriday;
  }
  return t.closeDate >= b.start && t.closeDate <= b.end;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeStats(trades: StatTrade[]): PeriodStats {
  const closed = trades.filter((t) => t.status === "CLOSED" && t.returnPct !== null);
  const rets = closed.map((t) => t.returnPct!);
  const winners = rets.filter((r) => r > 0).length;
  const wSum = closed.reduce((a, t) => a + t.weight, 0);
  const holds = closed.map((t) => t.holdDays).filter((h): h is number => h !== null);
  let best: PeriodStats["best"] = null;
  for (const t of closed) {
    if (!best || t.returnPct! > best.returnPct) {
      best = { name: t.name, symbol: t.symbol, returnPct: t.returnPct!, days: t.holdDays };
    }
  }
  return {
    closed: closed.length,
    winners,
    winRate: closed.length ? winners / closed.length : null,
    avgReturn: mean(rets),
    weightedAvgReturn: wSum > 0 ? closed.reduce((a, t) => a + t.returnPct! * t.weight, 0) / wSum : null,
    avgDaysHeld: mean(holds),
    best,
  };
}

export function statsByPeriod(
  trades: StatTrade[],
  today: string = todayNY(),
  keys: PeriodKey[] = ["week", "lastWeek", "month", "year", "inception"],
): Record<PeriodKey, PeriodStats> {
  const out = {} as Record<PeriodKey, PeriodStats>;
  for (const k of keys) {
    const b = periodBounds(k, today);
    out[k] = computeStats(trades.filter((t) => inPeriod(t, b)));
    const opened = new Set<string>();
    for (const t of trades) {
      if (t.openDate >= b.start && t.openDate <= b.end) opened.add(t.airtableId ?? `${t.symbol}|${t.openDate}`);
    }
    out[k].opened = opened.size;
  }
  return out;
}
