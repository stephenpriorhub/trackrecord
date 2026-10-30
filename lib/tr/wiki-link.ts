/**
 * Shared secret between Track Record and the MTA Wiki (mta-wiki.oxfordhub.app).
 * Each app calls the other server-to-server with no hub session attached, so
 * this key is the credential; the same value is set on both Railway services.
 */
import { timingSafeEqual } from "crypto";

export const WIKI_URL = process.env.WIKI_URL || "https://mta-wiki.oxfordhub.app";
export const TRACKRECORD_PUBLIC_URL = process.env.PUBLIC_BASE_URL || "https://trackrecord.oxfordhub.app";

export function integrationKey(): string | null {
  return process.env.TRACKRECORD_INTEGRATION_KEY || null;
}

export function verifyIntegrationKey(header: string | null): boolean {
  const key = integrationKey();
  if (!key || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
