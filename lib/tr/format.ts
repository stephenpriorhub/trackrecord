/** Display helpers shared by the track-record pages. Pure; safe on the client. */

export function pct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const s = (x * 100).toFixed(digits);
  return x > 0 ? `+${s}%` : `${s}%`;
}

/** Tailwind text colour for a return. Zero and unknown stay neutral. */
export function tone(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x) || Math.abs(x) < 1e-9) return "text-ink";
  return x > 0 ? "text-gain" : "text-loss";
}

export function chipTone(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x) || Math.abs(x) < 1e-9) return "bg-paper text-muted";
  return x > 0 ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss";
}

export function days(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(1);
}

/** "Oct 23, 2026" from a Date or YYYY-MM-DD. Dates are calendar dates (UTC midnight). */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function price(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const v = Math.abs(x);
  const s = `$${v.toFixed(v >= 1000 ? 0 : 2)}`;
  return x < 0 ? `${s} cr` : s;
}

export function int(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}
