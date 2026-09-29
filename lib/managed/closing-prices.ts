/**
 * Every published price is the PREVIOUS TRADING DAY'S CLOSE.
 *
 * Stephen, 2026-09-29: on 9/29 the embed should read the 9/28 close (4:00 PM
 * ET) — one consistent, official figure per holding — rather than a mix of
 * 15-minute-delayed prints and whatever a thin listing last traded at.
 *
 * Massive's grouped-daily endpoint returns the close of every US ticker for a
 * date in ONE call (~0.4s). The session is the most recent weekday before
 * today in New York that actually has closes: a weekend or market holiday
 * returns none, so the walk back simply skips it without a holiday calendar.
 */
import { dec, type D } from "../money";

const BASE = () =>
  (process.env.MASSIVE_BASE ?? "https://api.massive.com").replace(/\/+$/, "");

/** YYYY-MM-DD of a moment, in New York. */
export function nyDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 4:00 PM New York time on a date, as an instant (EDT or EST as it falls). */
export function closeInstant(ymd: string): Date {
  // New York's UTC offset on that date ("GMT-4" in summer, "GMT-5" in winter),
  // read directly — independent of the server's own time zone.
  const probe = new Date(`${ymd}T16:00:00Z`);
  const tz = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(tz);
  const offsetHours = m ? Number(m[1]) + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) / 60 : 0) : -5;
  // 16:00 local = 16:00 - offset in UTC (offset is negative for New York).
  return new Date(Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(5, 7)) - 1,
    Number(ymd.slice(8, 10)),
    16 - offsetHours,
  ));
}

async function groupedCloses(ymd: string): Promise<Map<string, D>> {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return new Map();
  try {
    const res = await fetch(
      `${BASE()}/v2/aggs/grouped/locale/us/market/stocks/${ymd}?adjusted=true&include_otc=true`,
      {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return new Map();
    const body = (await res.json()) as { results?: { T?: string; c?: number }[] };
    const out = new Map<string, D>();
    for (const r of body.results ?? []) {
      if (r.T && typeof r.c === "number" && r.c > 0) out.set(r.T.toUpperCase(), dec(r.c));
    }
    return out;
  } catch {
    return new Map();
  }
}

export interface ClosingSession {
  /** YYYY-MM-DD, New York. */
  date: string;
  /** 4:00 PM New York on that date — the stamp every close carries. */
  at: Date;
  closes: Map<string, D>;
}

/** The latest completed session before today (New York), with its closes. */
export async function previousSession(now: Date = new Date()): Promise<ClosingSession | null> {
  let day = addDays(nyDate(now), -1);
  for (let i = 0; i < 7; i += 1, day = addDays(day, -1)) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const closes = await groupedCloses(day);
    if (closes.size > 0) return { date: day, at: closeInstant(day), closes };
  }
  return null;
}
