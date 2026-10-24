/**
 * Fetch a published track-record sheet and read its raw cell values.
 *
 * Always as .xlsx, never CSV: Google's CSV/gviz export returns FORMATTED text
 * ("100%" for a 1.0102 return, "$11.00 " for 11) and gviz has dropped data
 * rows. The xlsx export carries the underlying numbers and real dates.
 *
 * Two ways in, tried in order:
 *   1. The OxfordHub service account (GOOGLE_SERVICE_ACCOUNT_JSON) through the
 *      Drive export endpoint — works for sheets shared with that account,
 *      whatever their link setting.
 *   2. The public export URL — works while a sheet is "anyone with the link".
 */
import * as XLSX from "xlsx";
import { googleAccessToken } from "../google";

export type Cell = string | number | Date | boolean | null;
export type Row = Cell[];

export interface Workbook {
  tabs: string[];
  rows(tab: string): Row[] | null;
}

export async function fetchSheetXlsx(sheetId: string): Promise<Buffer> {
  const token = await googleAccessToken().catch(() => null);
  if (token) {
    const url =
      `https://www.googleapis.com/drive/v3/files/${sheetId}/export` +
      `?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    // Not shared with the service account (404/403): fall through to the
    // public link rather than failing the whole sync.
  }
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
    {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    },
  );
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error(
      `Sheet ${sheetId} is not readable (HTTP ${res.status}). Share it with the ` +
        `OxfordHub service account, or set link sharing to "anyone with the link".`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Raw cell values per tab. Formulas give their cached result. Dates and times
 * arrive as Excel serial numbers — the parsers know which columns hold them
 * and read them with ymd()/hourOf().
 *
 * SheetJS, not exceljs: exceljs silently drops a shared formula's cached
 * result when it is 0, which turned every zero-day hold into a blank.
 */
export async function readWorkbook(buf: Buffer, onlyTabs?: string[]): Promise<Workbook> {
  const wb = XLSX.read(buf, { type: "buffer", sheets: onlyTabs, cellFormula: false, cellHTML: false, cellText: false });
  const cache = new Map<string, Row[]>();
  return {
    tabs: wb.SheetNames,
    rows(tab) {
      if (cache.has(tab)) return cache.get(tab)!;
      const ws = wb.Sheets[tab];
      if (!ws) return null;
      const out = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true });
      cache.set(tab, out);
      return out;
    },
  };
}

// ---- cell readers -----------------------------------------------------------

export function num(v: Cell | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // WAR writes credits as text: "-$0.31".
    const s = v.replace(/[$,\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

export function txt(v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A date cell as YYYY-MM-DD. Accepts an Excel serial (what readWorkbook gives)
 * or a Date. Serials below 1990 are not dates in these sheets — a bare time of
 * day is a fraction, and a stray small number is a typo.
 */
export function ymd(v: Cell | undefined): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 32874 /* 1990-01-01 */ && v < 80000) {
    return new Date(EXCEL_EPOCH + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime()) && v.getUTCFullYear() >= 1990) {
    return v.toISOString().slice(0, 10);
  }
  return null;
}

/** Hour (0-23) of a time cell (a day fraction, or a serial carrying one), or null. */
export function hourOf(v: Cell | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    // Round to the second first: 0.6666666 is 16:00:00, not 15:59:59.
    const secs = Math.round((v - Math.floor(v)) * 86_400);
    return Math.floor(secs / 3600) % 24;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getUTCHours();
  return null;
}

export function isRowEmpty(r: Row): boolean {
  return !r.some((c) => c !== null && c !== "");
}
