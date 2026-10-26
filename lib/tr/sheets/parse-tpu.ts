/**
 * Monument Trend Advisory — "closed since inception" tab, one row per closed
 * position. (Formerly Catalyst Cashouts Live; rebranded in early 2026.)
 *
 * Columns: 0 Ticker / contract ("BHP", "GNRC 15Jan27 C290", "NVO 2027 Call
 *          Spread")  1 Weight  2 Entry date  3 Entry price  4 Exit date
 *          5 Exit price  6 Gain % (=F/D-1 — what Stats counts)  7 weighted
 *          8 Days held  10 Open editor  12 Close editor
 *
 * The two brands are separate books. A trade OPENED on or after 2026-02-01 is
 * Trend Advisory; anything opened earlier is Catalyst Cashouts Live — the
 * sheet's own "Trend Advisory Y/N" column (YTD tab) follows exactly that date.
 *
 * A negative entry price is a credit (MARA -3.94): opened short.
 */
import type { Workbook } from "./workbook";
import { num, txt, ymd } from "./workbook";
import { type ParseResult, type Structure, describe, fmtStrike, parseSheetOcc } from "./types";

const TAB = "closed since inception";
export const TREND_ADVISORY_START = "2026-02-01";
const C = { name: 0, weight: 1, open: 2, entry: 3, close: 4, exit: 5, gain: 6, hold: 8, editor: 10 } as const;

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const EDITORS: Record<string, string> = {
  B: "Bryan Bottarelli", BRYAN: "Bryan Bottarelli",
  K: "Karim Rahemtulla", KARIM: "Karim Rahemtulla",
};

/**
 * "GNRC 15Jan27 C290", "XYZ 15Jan27 C290/C300", or an OCC symbol
 * ("NKE241220C00080000") -> contract parts.
 */
function parseContract(text: string) {
  const occ = parseSheetOcc(text.trim());
  if (occ) return { underlying: occ.underlying, expiry: occ.expiry, legs: [{ right: occ.right === "CALL" ? ("C" as const) : ("P" as const), strike: occ.strike }] };
  const m = /^([A-Z.]{1,6})\s+(\d{1,2})([A-Za-z]{3})(\d{2})\s+([CP]\d+(?:\.\d+)?(?:\s*\/\s*[CP]?\d+(?:\.\d+)?)*)/.exec(text.trim());
  if (!m) return null;
  const [, u, d, mon, yy, legText] = m;
  const mm = MONTHS[mon.toUpperCase()];
  if (!mm) return null;
  const legs = legText.split("/").map((l) => l.trim());
  const firstRight = legs[0][0] as "C" | "P";
  const parsed = legs.map((l) => ({
    right: (/^[CP]/.test(l) ? l[0] : firstRight) as "C" | "P",
    strike: Number(l.replace(/^[CP]/, "")),
  }));
  return { underlying: u.replace(".", ""), expiry: `20${yy}-${mm}-${d.padStart(2, "0")}`, legs: parsed };
}

export function parseTrendAdvisory(wb: Workbook): ParseResult {
  const out: ParseResult = { trades: [], skipped: [] };
  const rows = wb.rows(TAB);
  if (!rows) throw new Error(`Trend Advisory sheet has no "${TAB}" tab`);

  rows.forEach((r, i) => {
    const n = i + 1;
    if (n === 1) return;
    const gain = num(r[C.gain]);
    if (gain === null) return; // not counted by the sheet's Stats either
    const raw = txt(r[C.name]);
    const open = ymd(r[C.open]);
    if (!open) {
      out.skipped.push({ tab: TAB, row: n, symbol: raw, reason: "no entry date" });
      return;
    }
    const entry = num(r[C.entry]);
    const credit = entry !== null && entry < 0;
    const c = parseContract(raw);

    let base;
    let name: string;
    if (c) {
      const rights = new Set(c.legs.map((l) => l.right));
      const structure: Structure =
        c.legs.length === 1 ? (credit && c.legs[0].right === "P" ? "PUT_SELL" : "SINGLE")
        : rights.size > 1 ? "STRANGLE" : c.legs.length >= 3 ? "BUTTERFLY" : "SPREAD";
      base = {
        underlying: c.underlying,
        assetType: "OPTION" as const,
        structure,
        optionType: rights.size === 1 ? (c.legs[0].right === "C" ? ("CALL" as const) : ("PUT" as const)) : null,
        strike: c.legs.map((l) => fmtStrike(l.strike)).join(" / "),
        expiry: c.expiry,
      };
      name = describe(base);
    } else {
      // A ticker ("BHP"), a company ("EMX Royalty") or free text ("NVO 2027
      // Call Spread"). Shown as written; the sheet doesn't say more.
      const first = raw.split(/\s+/)[0] ?? raw;
      // Index ETFs never trade near a few dollars: a bare "SPY" at $3.69 is
      // an option whose contract the sheet didn't record.
      const etfOption = /^(SPY|QQQ|IWM|DIA)$/.test(raw.trim()) && entry !== null && Math.abs(entry) < 20;
      const isOption = etfOption || /\b(call|put|spread|strangle)\b/i.test(raw) || /\d+\s*\/\s*\d+/.test(raw);
      base = {
        underlying: /^[A-Z.]{1,6}$/.test(first) ? first.replace(".", "") : raw.toUpperCase(),
        assetType: isOption ? ("OPTION" as const) : ("STOCK" as const),
        structure: (isOption
          ? /strangle/i.test(raw) ? "STRANGLE" : /spread|\d+\s*\/\s*\d+/i.test(raw) ? "SPREAD" : "SINGLE"
          : "STOCK") as Structure,
        optionType: /\bcall\b/i.test(raw) ? ("CALL" as const) : /\bput\b/i.test(raw) ? ("PUT" as const) : null,
        strike: null,
        expiry: null,
      };
      name = raw;
    }

    out.trades.push({
      serviceCode: "TPU",
      tab: TAB,
      row: n,
      portfolio: open >= TREND_ADVISORY_START ? "trend-advisory" : "catalyst-cashouts",
      guru: EDITORS[txt(r[C.editor]).toUpperCase()] ?? null,
      name,
      symbol: raw,
      ...base,
      side: credit ? "SHORT" : "LONG",
      status: "CLOSED",
      openDate: open,
      closeDate: ymd(r[C.close]),
      closeAfterBell: false,
      entryPrice: entry,
      exitPrice: num(r[C.exit]),
      returnPct: gain,
      weight: num(r[C.weight]) ?? 1,
      premiumCapture: null,
      holdDays: num(r[C.hold]),
      notes: null,
    });
  });
  return out;
}
