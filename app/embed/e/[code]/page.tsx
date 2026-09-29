import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadPortfolioEmbed, loadServiceEmbed, parseEmbedOptions } from "@/lib/managed/embed";
import { parseTarget, queryToParams } from "@/lib/managed/saved-embeds";
import EmbedBody from "../../EmbedBody";
import { mayPreviewPortfolio, mayPreviewService } from "../../preview-gate";

export const dynamic = "force-dynamic";

/**
 * A SAVED embed: /embed/e/<code>.
 *
 * The options come from the saved row, not the URL, so the embed can be
 * adjusted in the hub without touching the pages it is pasted into. Only
 * `preview` is read from the request, and it is still gated on the caller's
 * hub rights exactly as on the plain routes. Everything else goes through the
 * same parser and loaders, so a saved embed can do nothing a plain one cannot.
 */
export default async function SavedEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const saved = await prisma.savedEmbed.findUnique({ where: { code } });
  if (!saved || saved.deletedAt) notFound();

  const target = parseTarget(saved.target);
  if (!target) notFound();
  const options = parseEmbedOptions(queryToParams(saved.query));
  const previewAsk = { preview: sp.preview };

  const view =
    target.kind === "service"
      ? await loadServiceEmbed(target.slug, options, await mayPreviewService(target.slug, previewAsk))
      : await loadPortfolioEmbed(target.slug, options, await mayPreviewPortfolio(target.slug, previewAsk));
  if (!view) notFound();
  return <EmbedBody view={view} />;
}
