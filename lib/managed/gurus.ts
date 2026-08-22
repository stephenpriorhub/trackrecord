/**
 * The canonical guru list, and the name normalisation that feeds it.
 *
 * ONE DEFINITION. The Airtable sync, the Portfolio Manager import and the owner
 * backfill all resolve people through here. Three copies of a name map is how a
 * guru ends up spelled two ways and fragments into two rows.
 *
 * Airtable's person fields are inconsistent across services — initials ("B",
 * "K"), first names, full names, stray casing and whitespace — so everything is
 * matched on a lowercased, trimmed form.
 *
 * "George" is deliberately ABSENT. He appears as a PERSON on some War Room trades
 * but is not a guru Stephen wants surfaced. Leaving him unmapped makes those
 * positions fall through to the verified workbook, which credits the Bryan or
 * Karim that the published Bryan-and-Karim-only record already shows.
 */
import { prisma } from "../prisma";

export const GURUS: Record<string, string> = {
  bryan: "Bryan Bottarelli",
  karim: "Karim Rahemtulla",
  nate: "Nate Bear",
  matt: "Matt McCall",
};

/** Every spelling seen in the base, mapped to a canonical slug. */
export const GURU_ALIASES: Record<string, string> = {
  b: "bryan",
  bryan: "bryan",
  "bryan bottarelli": "bryan",
  bottarelli: "bryan",
  k: "karim",
  karim: "karim",
  "karim rahemtulla": "karim",
  rahemtulla: "karim",
  n: "nate",
  nate: "nate",
  "nate bear": "nate",
  bear: "nate",
  m: "matt",
  matt: "matt",
  "matt mccall": "matt",
  mccall: "matt",
};

/** A canonical slug for anything Airtable might hand us, or null. */
export function guruSlug(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  // A linked record arrives as { id, name }; a rollup as a bare string.
  const text =
    typeof raw === "object" && raw !== null && "name" in raw
      ? String((raw as { name?: unknown }).name ?? "")
      : String(raw);
  return GURU_ALIASES[text.trim().toLowerCase()] ?? null;
}

/**
 * The distinct canonical slugs in a person field, which may be a single value, an
 * array, or a comma-joined string of linked record names.
 */
export function guruSlugs(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const out = new Set<string>();
  for (const item of items) {
    const text =
      typeof item === "object" && item !== null && "name" in item
        ? String((item as { name?: unknown }).name ?? "")
        : String(item ?? "");
    // "Bryan Bottarelli, Bryan Bottarelli" is one rollup value, not two people.
    for (const part of text.split(",")) {
      const slug = guruSlug(part);
      if (slug) out.add(slug);
    }
  }
  return [...out];
}

/**
 * Who edits each publication. Source: the brain vault publication descriptions.
 *
 * This is the service's masthead, NOT per-position attribution. Its one safe use
 * is as a fallback for a publication with exactly ONE editor: there, an empty
 * Person field is not ambiguous, because there is only one name it could be. For
 * a co-edited service like the War Room the same reasoning would produce
 * "Bryan, Karim" for anything unattributed — the false pairing this whole area
 * exists to prevent — so it is never applied there.
 */
export const PUB_EDITORS: Record<string, string[]> = {
  WAR: ["bryan", "karim"], // each pick owned by exactly one of them
  TPU: ["bryan", "karim"], // genuinely co-managed
  PMK: ["bryan"],
  XAI: ["matt"],
  NBS: ["nate"],
  PSU: ["nate"],
  DPL: ["nate"],
};

/** The sole editor of a publication, or null when it has more than one. */
export function soleEditor(pubCode: string): string | null {
  const editors = PUB_EDITORS[pubCode];
  return editors && editors.length === 1 ? editors[0] : null;
}


/**
 * slug -> Guru id, creating any that are missing.
 *
 * Creating rather than assuming matters: the Guru table used to be populated only
 * as a side effect of the Airtable sync, so the import and the backfill silently
 * resolved nothing on a database where the sync had not run yet.
 */
export async function ensureGurus(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [slug, name] of Object.entries(GURUS)) {
    const guru = await prisma.guru.upsert({
      where: { slug },
      update: { name },
      create: { slug, name },
    });
    map.set(slug, guru.id);
  }
  return map;
}
