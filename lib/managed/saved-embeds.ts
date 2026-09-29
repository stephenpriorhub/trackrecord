/**
 * Saved embeds: a named configuration behind a permanent /embed/e/<code> link.
 *
 * The iframe on a page carries only the code; the options live in the row, so
 * editing a saved embed changes every page that uses it. See the SavedEmbed
 * model for why `target` and `query` mirror the plain embed routes.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";

/** No 0/O/1/l/I, so a code read aloud or retyped from a screenshot survives. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function newEmbedCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export type SavedTarget = { kind: "service" | "portfolio"; slug: string };

/** "s/<slug>" or "p/<slug>", or null for anything else. */
export function parseTarget(target: string): SavedTarget | null {
  const m = /^(s|p)\/([a-z0-9-]+)$/.exec(target);
  if (!m) return null;
  return { kind: m[1] === "s" ? "service" : "portfolio", slug: m[2] };
}

/**
 * Is `target` inside this publication? A saved embed is filed under one
 * service and must not point at another publication's books.
 */
export async function targetBelongsTo(
  target: SavedTarget,
  serviceId: string,
): Promise<boolean> {
  if (target.kind === "service") {
    const s = await prisma.service.findUnique({ where: { slug: target.slug }, select: { id: true } });
    return s?.id === serviceId;
  }
  const p = await prisma.managedPortfolio.findUnique({
    where: { slug: target.slug },
    select: { serviceId: true },
  });
  return p?.serviceId === serviceId;
}

/** A stored query string as the searchParams shape the embed parser takes. */
export function queryToParams(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) out[k] = v;
  return out;
}
