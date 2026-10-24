/**
 * A service's logo and description, from the publication catalog the MTA Wiki
 * is built on (MTARIX public publications API — the wiki's system of record).
 * Cached for an hour; on any failure the page simply renders without it.
 */
import { serviceByCode } from "./services";

const CATALOG_URL = "https://mtarix.oxfordhub.app/api/public/publications";

export interface PublicationInfo {
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  body: string[];
  wikiUrl: string | null;
}

interface CatalogEntry {
  code?: string;
  name?: string;
  logoUrl?: string;
  tagline?: string;
  usp?: string;
  body?: string[];
  wikiSlug?: string;
}


/**
 * Logos served from this app, used ahead of the catalog's. The catalog's McCall
 * Innovation Report logo sits behind the wiki's sign-in (401 for readers).
 */
const LOCAL_LOGOS: Record<string, string> = { XAI: "/logos/xai.svg" };

let cache: { at: number; entries: CatalogEntry[] } | null = null;
const logoOk = new Map<string, { at: number; ok: boolean }>();

/**
 * Only hand out a logo a reader can actually load. Some catalog logos live
 * behind the wiki's sign-in (401 for everyone else) and would render broken.
 */
async function reachable(url: string): Promise<boolean> {
  const hit = logoOk.get(url);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.ok;
  let ok = false;
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(5_000) });
    ok = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
    await res.body?.cancel();
  } catch {
    ok = false;
  }
  logoOk.set(url, { at: Date.now(), ok });
  return ok;
}

async function catalog(): Promise<CatalogEntry[]> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.entries;
  try {
    const res = await fetch(CATALOG_URL, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { publications?: CatalogEntry[] };
    cache = { at: Date.now(), entries: body.publications ?? [] };
  } catch {
    if (!cache) return [];
  }
  return cache.entries;
}

export async function publicationInfo(code: string): Promise<PublicationInfo> {
  const def = serviceByCode(code);
  const entries = await catalog();
  const find = (c: string) => entries.find((e) => e.code?.toUpperCase() === c);
  const e = find(code);
  const logo = LOCAL_LOGOS[code] ?? (e?.logoUrl && (await reachable(e.logoUrl)) ? e.logoUrl : null);
  return {
    name: def?.name ?? e?.name ?? code,
    logoUrl: logo,
    tagline: e?.tagline || e?.usp || null,
    body: Array.isArray(e?.body) ? e!.body!.filter(Boolean) : [],
    wikiUrl: e?.wikiSlug ? `https://mta-wiki.oxfordhub.app/publications/${e.wikiSlug}` : null,
  };
}

export async function allPublicationInfo(codes: string[]): Promise<Record<string, PublicationInfo>> {
  const out: Record<string, PublicationInfo> = {};
  await Promise.all(codes.map(async (c) => (out[c] = await publicationInfo(c))));
  return out;
}
