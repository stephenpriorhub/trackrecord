/**
 * Download of a service's trade list, exactly as filtered on the page.
 *
 * Excel: a "Trades" sheet (one row per trade) and a "Summary" sheet whose
 * figures are live formulas over it — edit or delete a trade row and the
 * summary recalculates, by the same definitions as the app (lib/tr/stats.ts):
 * closed trades only, winner = return > 0, plain and weighted means, and the
 * week rule for Friday after-the-bell closes (they count in the next week, so
 * the sheet carries a "Week counted" date for the week columns).
 *
 * Each formula cell also carries the app's own figure as its cached value, so
 * the file reads correctly even where nothing recalculates (previews, CSV).
 *
 * By standing rule there is no loser count and no worst trade.
 */
import * as XLSX from "xlsx";
import { tradeKind } from "./format";
import { airtableUrl, type exportTrades, type TradeFilters, TYPE_FILTERS } from "./queries";
import type { ServiceDef } from "./services";
import {
  computeStats,
  inPeriod,
  type PeriodKey,
  PERIOD_LABEL,
  periodBounds,
  type StatTrade,
  todayNY,
} from "./stats";

type Row = Awaited<ReturnType<typeof exportTrades>>[number];

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Excel's date serial for a YYYY-MM-DD. */
function serial(s: string): number {
  return (Date.parse(`${s}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
}

function addDays(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The date a close counts toward for the week periods (see header). */
function weekCounted(close: string | null, afterBell: boolean): string | null {
  if (!close) return null;
  return afterBell && new Date(`${close}T00:00:00Z`).getUTCDay() === 5 ? addDays(close, 3) : close;
}

/** Text that a spreadsheet would run as a formula is kept as text. */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

// Trades sheet columns. The summary's formulas refer to these letters.
const COLS = [
  { key: "name", label: "Trade", width: 34 },
  { key: "symbol", label: "Symbol", width: 26 },
  { key: "kind", label: "Type", width: 14 },
  { key: "portfolio", label: "Portfolio", width: 18 },
  { key: "guru", label: "Editor", width: 18 },
  { key: "status", label: "Status", width: 8 },
  { key: "opened", label: "Opened", width: 12 },
  { key: "closed", label: "Closed", width: 12 },
  { key: "week", label: "Week counted", width: 13 },
  { key: "days", label: "Days held", width: 9 },
  { key: "entry", label: "Entry", width: 10 },
  { key: "exit", label: "Exit (current if open)", width: 12 },
  { key: "ret", label: "Return", width: 10 },
  { key: "weight", label: "Weight", width: 8 },
  { key: "spx", label: "S&P same days", width: 12 },
  { key: "premium", label: "Premium kept", width: 11 },
  { key: "airtable", label: "Airtable", width: 40 },
  { key: "tab", label: "Sheet tab", width: 16 },
  { key: "row", label: "Sheet row", width: 9 },
] as const;
const L = Object.fromEntries(COLS.map((c, i) => [c.key, XLSX.utils.encode_col(i)])) as Record<
  (typeof COLS)[number]["key"],
  string
>;

const PCT = "0.00%";
const DATE = "yyyy-mm-dd";

type Cell = XLSX.CellObject;
const num = (v: number | null | undefined, z?: string): Cell | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : { t: "n", v, ...(z ? { z } : {}) };
const str = (v: string | null | undefined): Cell | null => (v ? { t: "s", v: safe(v) } : null);
const date = (v: string | null): Cell | null => (v ? { t: "n", v: serial(v), z: DATE } : null);

function tradesSheet(def: ServiceDef, rows: Row[]): XLSX.WorkSheet {
  const book = (k: string) => def.subPortfolios.find((p) => p.key === k)?.label ?? k;
  const data: (Cell | null)[][] = [COLS.map((c) => ({ t: "s", v: c.label }) as Cell)];
  for (const r of rows) {
    const close = ymd(r.closeDate);
    const v: Record<(typeof COLS)[number]["key"], Cell | null> = {
      name: str(r.name),
      symbol: str(r.symbol),
      kind: str(tradeKind(r)),
      portfolio: str(book(r.portfolio)),
      guru: str(r.guru),
      status: str(r.status === "OPEN" ? "Open" : "Closed"),
      opened: date(ymd(r.openDate)),
      closed: date(close),
      week: date(weekCounted(close, r.closeAfterBell)),
      days: num(r.holdDays),
      entry: num(r.entryPrice),
      exit: num(r.status === "OPEN" ? r.currentPrice : r.exitPrice),
      ret: num(r.returnPct, PCT),
      weight: num(r.weight),
      spx: num(r.spxReturnPct, PCT),
      premium: num(r.premiumCapture, PCT),
      airtable: r.airtableId ? { t: "s", v: airtableUrl(r.airtableId), l: { Target: airtableUrl(r.airtableId) } } : null,
      tab: str(r.sheetTab),
      row: r.sheetRow > 0 ? num(r.sheetRow) : null,
    };
    data.push(COLS.map((c) => v[c.key]));
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = COLS.map((c) => ({ wch: c.width }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, rows.length), c: COLS.length - 1 } }) };
  ws["!freeze"] = { xSplit: 1, ySplit: 1 };
  return ws;
}

/** A one-line description of the filters, for the summary's heading. */
export function describeFilters(def: ServiceDef, f: TradeFilters): string {
  const parts: string[] = [];
  if (f.q) parts.push(`ticker "${f.q}"`);
  if (f.status) parts.push(f.status === "OPEN" ? "open positions" : "closed trades");
  else if (!f.q) parts.push("closed trades");
  if (f.portfolio) parts.push(def.subPortfolios.find((p) => p.key === f.portfolio)?.label ?? f.portfolio);
  if (f.guru) parts.push(f.guru);
  if (f.type) parts.push(TYPE_FILTERS.find((t) => t.value === f.type)?.label ?? f.type);
  if (f.result) parts.push(f.result === "win" ? "winners" : "non-winners");
  if (f.minReturn !== undefined) parts.push(`return above ${f.minReturn}%`);
  if (f.big) parts.push("100%+ returns");
  if (f.openedFrom || f.openedTo) parts.push(`opened ${f.openedFrom ?? "…"} to ${f.openedTo ?? "…"}`);
  if (f.closedFrom || f.closedTo) parts.push(`closed ${f.closedFrom ?? "…"} to ${f.closedTo ?? "…"}`);
  if (f.airtable) parts.push(f.airtable === "missing" ? "no Airtable match" : "matched in Airtable");
  return parts.join(" · ");
}

function summarySheet(def: ServiceDef, rows: Row[], f: TradeFilters, today: string): XLSX.WorkSheet {
  const n = Math.max(2, rows.length + 1);
  const rng = (col: string) => `Trades!$${col}$2:$${col}$${n}`;
  const stat: StatTrade[] = rows.map((r) => ({
    returnPct: r.returnPct,
    weight: r.weight,
    holdDays: r.holdDays,
    openDate: ymd(r.openDate)!,
    closeDate: ymd(r.closeDate),
    closeAfterBell: r.closeAfterBell,
    status: r.status,
    name: r.name,
    symbol: r.symbol,
  }));

  const ws: XLSX.WorkSheet = {};
  let maxRow = 0;
  const put = (addr: string, c: Cell | null) => {
    if (!c) return;
    ws[addr] = c;
    maxRow = Math.max(maxRow, XLSX.utils.decode_cell(addr).r);
  };
  const text = (addr: string, v: string) => put(addr, { t: "s", v });
  // A formula with the app's figure cached in it.
  const fx = (addr: string, formula: string, v: number | string | null, z?: string) =>
    put(addr, v === null || v === "" ? { t: "s", v: "", f: formula } : typeof v === "number" ? { t: "n", v, f: formula, ...(z ? { z } : {}) } : { t: "s", v, f: formula });

  const closedN = stat.filter((t) => t.status === "CLOSED").length;
  text("A1", `${def.name} — Track Record export`);
  text("A2", `Filters: ${describeFilters(def, f) || "none"}`);
  text("A3", `Generated ${today} · ${rows.length} trades (${closedN} closed, ${rows.length - closedN} open)`);
  text(
    "A4",
    "Every figure below is a formula over the Trades sheet: closed trades only; a winner is a return above 0. " +
      "Week columns use “Week counted” (a Friday after-the-bell close counts in the following week).",
  );

  // ---- by period ---------------------------------------------------------
  const periods: { key: PeriodKey | "all"; label: string }[] = [
    { key: "week", label: PERIOD_LABEL.week },
    { key: "lastWeek", label: PERIOD_LABEL.lastWeek },
    { key: "month", label: PERIOD_LABEL.month },
    { key: "year", label: PERIOD_LABEL.year },
    { key: "all", label: "All results" },
  ];
  const metrics = [
    "Closed trades",
    "Winners",
    "Win rate",
    "Average return",
    ...(def.weighted ? ["Weighted average return"] : []),
    "Average days held",
    "Best return",
    "Best trade",
  ];
  const HEAD = 6; // header row (1-based)
  text(`A${HEAD}`, "By period");
  text(`A${HEAD + 1}`, "From");
  text(`A${HEAD + 2}`, "To");
  const first = HEAD + 3;
  metrics.forEach((m, i) => text(`A${first + i}`, m));
  const rowOf = (m: string) => first + metrics.indexOf(m);

  /**
   * The metric formulas for one set of trades: the closed trades matching
   * `crit` (extra COUNTIFS criteria) / `mask` (the same as a SUMPRODUCT factor).
   */
  const block = (at: (m: string) => string, crit: string, mask: string, s: ReturnType<typeof computeStats>) => {
    const base = `${rng(L.status)},"Closed",${rng(L.ret)},"<>"${crit}`;
    const c = at("Closed trades");
    fx(c, `COUNTIFS(${base})`, s.closed);
    fx(at("Winners"), `COUNTIFS(${base},${rng(L.ret)},">0")`, s.winners);
    fx(at("Win rate"), `IF(${c}=0,"",${at("Winners")}/${c})`, s.winRate, PCT);
    fx(at("Average return"), `IF(${c}=0,"",AVERAGEIFS(${rng(L.ret)},${base}))`, s.avgReturn, PCT);
    if (def.weighted) {
      const m = `(${rng(L.status)}="Closed")*ISNUMBER(${rng(L.ret)})${mask}`;
      fx(
        at("Weighted average return"),
        `IFERROR(SUMPRODUCT(${m}*${rng(L.ret)}*${rng(L.weight)})/SUMPRODUCT(${m}*${rng(L.weight)}),"")`,
        s.weightedAvgReturn,
        PCT,
      );
    }
    fx(at("Average days held"), `IFERROR(AVERAGEIFS(${rng(L.days)},${base}),"")`, s.avgDaysHeld, "0.0");
    // Post-2010 functions are stored with Excel's _xlfn. prefix, or Excel reads #NAME?.
    fx(at("Best return"), `IF(${c}=0,"",_xlfn.MAXIFS(${rng(L.ret)},${base}))`, s.best?.returnPct ?? null, PCT);
    fx(
      at("Best trade"),
      `IF(${c}=0,"",INDEX(${rng(L.name)},MATCH(1,INDEX((${rng(L.ret)}=${at("Best return")})*(${rng(L.status)}="Closed")${mask},0),0)))`,
      s.best?.name ?? null,
    );
  };

  periods.forEach((p, i) => {
    const col = XLSX.utils.encode_col(i + 1);
    text(`${col}${HEAD}`, p.label);
    if (p.key === "all") {
      block((m) => `${col}${rowOf(m)}`, "", "", computeStats(stat));
      return;
    }
    const b = periodBounds(p.key, today);
    put(`${col}${HEAD + 1}`, date(b.start));
    put(`${col}${HEAD + 2}`, date(b.end));
    const d = p.key === "week" || p.key === "lastWeek" ? L.week : L.closed;
    const from = `${col}$${HEAD + 1}`;
    const to = `${col}$${HEAD + 2}`;
    block(
      (m) => `${col}${rowOf(m)}`,
      `,${rng(d)},">="&${from},${rng(d)},"<="&${to}`,
      `*(${rng(d)}>=${from})*(${rng(d)}<=${to})`,
      computeStats(stat.filter((t) => inPeriod(t, b))),
    );
  });

  // ---- by portfolio / editor (all results) -------------------------------
  let r = first + metrics.length + 2;
  const groupTable = (title: string, col: string, values: { label: string; match: (t: Row) => boolean }[]) => {
    if (values.length < 2) return;
    // Same metrics, transposed: one row per group.
    text(`A${r}`, title);
    metrics.forEach((m, i) => text(`${XLSX.utils.encode_col(i + 1)}${r}`, m));
    r++;
    for (const v of values) {
      text(`A${r}`, v.label);
      const s = computeStats(stat.filter((_, i) => v.match(rows[i])));
      const row = r;
      const at = (m: string) => `${XLSX.utils.encode_col(metrics.indexOf(m) + 1)}${row}`;
      block(at, `,${rng(col)},$A${r}`, `*(${rng(col)}=$A${r})`, s);
      r++;
    }
    r++;
  };
  const book = (k: string) => def.subPortfolios.find((p) => p.key === k)?.label ?? k;
  const books = [...new Set(rows.map((x) => x.portfolio))];
  groupTable("By portfolio (all results)", L.portfolio, books.map((k) => ({ label: book(k), match: (t) => t.portfolio === k })));
  if (def.byGuru) {
    const gurus = [...new Set(rows.map((x) => x.guru).filter((g): g is string => !!g))];
    groupTable("By editor (all results)", L.guru, gurus.map((g) => ({ label: g, match: (t) => t.guru === g })));
  }

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxRow, r), c: metrics.length } });
  ws["!cols"] = [{ wch: 26 }, ...metrics.map(() => ({ wch: 16 }))];
  return ws;
}

export function buildExport(def: ServiceDef, rows: Row[], f: TradeFilters, format: "xlsx" | "csv", today = todayNY()) {
  const trades = tradesSheet(def, rows);
  if (format === "csv") {
    return { body: Buffer.from(`﻿${XLSX.utils.sheet_to_csv(trades)}`), type: "text/csv; charset=utf-8" };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet(def, rows, f, today), "Summary");
  XLSX.utils.book_append_sheet(wb, trades, "Trades");
  wb.Workbook = { ...(wb.Workbook ?? {}), CalcPr: { fullCalcOnLoad: true } } as XLSX.WBProps;
  const body = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { body, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
