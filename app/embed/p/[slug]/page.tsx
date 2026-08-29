import { notFound } from "next/navigation";
import { loadPortfolioEmbed, parseEmbedOptions } from "@/lib/managed/embed";
import EmbedBody from "../../EmbedBody";
import { mayPreviewPortfolio } from "../../preview-gate";

export const dynamic = "force-dynamic";

/**
 * The public embed for ONE portfolio.
 *
 * Query params:  ?show=open|closed|both  &returns=0  &comments=0  &preview=1
 */
export default async function PortfolioEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const options = parseEmbedOptions(sp);
  const view = await loadPortfolioEmbed(
    slug,
    options,
    await mayPreviewPortfolio(slug, sp),
  );
  if (!view) notFound();
  return <EmbedBody view={view} />;
}
