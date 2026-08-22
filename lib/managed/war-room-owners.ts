/**
 * Who owns a War Room position: Bryan or Karim, never both.
 *
 * SHARED ON PURPOSE. Both the Airtable sync (app/api/sync/route.ts) and the
 * Portfolio Manager import (lib/managed/import.ts) resolve ownership through
 * this one module. Two copies of this logic would drift, and a drifting
 * attribution rule is precisely the bug class this app keeps having to fix.
 */
import warRoomOwners from "@/data/warRoomOwners.json";

// Verified War Room owner map, generated from the manually-maintained track-record
// workbook (every sheet's B/K column) by scripts/build-war-room-owners.py. All 8,846
// harvested rows carry exactly one owner and none of the 21 overlapping sheet cuts
// contradicts another — Bryan and Karim never co-own a War Room pick, which makes this
// workbook the authority on who made each one.
//   occ    — exact option contract: "TICKER|YYMMDD|C/P|STRIKE"   (2,366 keys, no conflicts)
//   dated  — underlying ticker + open date: "TICKER@YYYY-MM-DD"  (3,235 keys, no conflicts)
//   ticker — bare ticker, last owner to trade it                  (436 keys, ambiguous)
// Covers 96% of War Room positions (3,193 of 3,313); the rest are trades opened since the
// last export, which is why Airtable's Trade Guru stays in the chain below it.
const WAR_ROOM_OWNERS = warRoomOwners as {
  occ: Record<string, string>;
  dated: Record<string, string>;
  ticker: Record<string, string>;
};

// Normalize an Airtable SYMBOL to the key format used in warRoomOwners.json:
// options -> "TICKER|YYMMDD|C/P|STRIKE" (strike as integer), otherwise the bare ticker.
export function ownerKeyFromSymbol(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return null;
  const m = s.match(/^([A-Z]+)(\d{6})([CP])(\d{6,8})/);
  if (m) return `${m[1]}|${m[2]}|${m[3]}|${parseInt(m[4], 10)}`;
  return s;
}

// Look a War Room position up in the verified workbook.
//
// `exact` matches an option contract or an underlying+open-date pair — both unambiguous,
// so they outrank Airtable. `loose` matches the bare ticker, which only records the LAST
// owner to trade that ticker; on multi-year LEAPS rolls it can name the wrong editor, so
// it sits BELOW Airtable's per-trade Trade Guru and is a last resort before the default.
export function warRoomOwnerFor(
  symbols: string[],
  openDate: unknown,
  tier: "exact" | "loose",
): string | null {
  const keys = symbols.map(ownerKeyFromSymbol).filter((k): k is string => !!k);

  if (tier === "loose") {
    for (const k of keys) {
      if (!k.includes("|") && WAR_ROOM_OWNERS.ticker[k])
        return WAR_ROOM_OWNERS.ticker[k];
    }
    return null;
  }

  for (const k of keys) {
    if (k.includes("|") && WAR_ROOM_OWNERS.occ[k])
      return WAR_ROOM_OWNERS.occ[k];
  }
  const day =
    openDate instanceof Date && !isNaN(openDate.getTime())
      ? openDate.toISOString().slice(0, 10)
      : null;
  if (day) {
    for (const k of keys) {
      // `dated` is keyed by the underlying ticker, so an option key matches on its root.
      const owner = WAR_ROOM_OWNERS.dated[`${k.split("|")[0]}@${day}`];
      if (owner) return owner;
    }
  }
  return null;
}

/**
 * The full resolution ladder for a War Room position, in authority order:
 *
 *   1. `airtableOwners` — Airtable's per-trade PERSON (the Trade Guru link,
 *      rolled up per position). This is the base's own record of who placed the
 *      trade and it ranks FIRST. Measured against the workbook across the 491
 *      War Room positions where both have an opinion, they agree on 489; the two
 *      exceptions are multi-year LEAPS rolls (DOW, TLRY) where the workbook only
 *      knows the last owner to touch the ticker.
 *   2. an UNAMBIGUOUS workbook match — exact option contract, or underlying plus
 *      open date. This is what fills Airtable's 2,882 blanks, which is most of
 *      the history.
 *   3. a bare-ticker workbook match, unreliable for the reason above.
 *   4. Bryan, the primary editor.
 *
 * Returns exactly one slug. A Bryan+Karim pair is not representable.
 *
 * WHY AIRTABLE MOVED AHEAD OF THE WORKBOOK: the workbook is titled "War Room
 * (Bryan and Karim Only)" and its B/K column can only ever say Bryan or Karim.
 * Letting it outrank Airtable meant a position placed by someone else was forced
 * to one of those two — which is exactly how third-party trades ended up looking
 * like Bryan's or Karim's.
 */
export function resolveWarRoomOwner(
  symbols: string[],
  openDate: unknown,
  airtableOwners: string[] = [],
): string {
  return (
    airtableOwners[0] ??
    warRoomOwnerFor(symbols, openDate, "exact") ??
    warRoomOwnerFor(symbols, openDate, "loose") ??
    "bryan"
  );
}
