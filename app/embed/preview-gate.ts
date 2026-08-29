/**
 * May this caller preview an unpublished portfolio?
 *
 * The embed routes are otherwise completely public, so this is the one place
 * where a signed-in identity changes what they render. Two rules keep that
 * narrow:
 *
 *   - Preview is opt-in per request (`?preview=1`). Nothing changes for a
 *     visitor who does not ask, so a live embed can never quietly start
 *     serving private rows to a logged-in admin browsing the marketing site.
 *   - Authorisation is resolved from the hub session server-side and checked
 *     against the specific portfolios in question. A query string cannot grant
 *     it.
 *
 * This exists because every portfolio starts PRIVATE, so the Preview link in
 * the embed builder pointed at a URL that correctly 404s — leaving no way to
 * see a book before publishing it.
 */
import { getManageContext } from "@/lib/manage-context";
import { canManagePortfolio, canManageService } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

function asked(sp: Record<string, string | string[] | undefined>): boolean {
  const v = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  return v === "1" || v === "true" || v === "yes";
}

/** True when `?preview=1` AND the caller may manage this portfolio. */
export async function mayPreviewPortfolio(
  slug: string,
  sp: Record<string, string | string[] | undefined>,
): Promise<boolean> {
  if (!asked(sp)) return false;
  const portfolio = await prisma.managedPortfolio.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!portfolio) return false;
  const { scope } = await getManageContext();
  return canManagePortfolio(scope, portfolio.id);
}

/** True when `?preview=1` AND the caller may manage this whole publication. */
export async function mayPreviewService(
  slug: string,
  sp: Record<string, string | string[] | undefined>,
): Promise<boolean> {
  if (!asked(sp)) return false;
  const service = await prisma.service.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!service) return false;
  const { scope } = await getManageContext();
  return canManageService(scope, service.id);
}
