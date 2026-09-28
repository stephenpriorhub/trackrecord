import { notFound } from "next/navigation";
import { loadServiceEmbed, parseEmbedOptions } from "@/lib/managed/embed";
import EmbedBody from "../../EmbedBody";
import { mayPreviewService } from "../../preview-gate";

export const dynamic = "force-dynamic";

/**
 * The public embed for a WHOLE PUBLICATION — every public portfolio in the
 * service, either grouped into one section per sub-portfolio (each with its own
 * total return vs its benchmark) or merged into one open and one closed table.
 *
 * Visibility decides what is eligible; nothing in the query string can publish
 * a private book. To embed a single sub-portfolio, use /embed/p/<slug>.
 *
 * Query params:  ?layout=grouped|merged  &tabs=1 &all=0  &show=open|closed|both
 *                &summary=benchmark|portfolio|none  &returns=0  &comments=0
 *                &portfolio=0  &limit=N  &only=slug-a,slug-b
 *                &total=0  &exclude=slug (shown, but not in the total)
 *                &hidecols=added,closed,entry,company,current,buyupto,stop,held  &hide=slug-a,slug-b (legacy)
 *                look: &theme=dark &bg=none|<hex> &cards=0 &accent=<hex>
 *                      &font=serif &density=compact &corners=square &title=0
 *                &preview=1 (signed-in managers only)
 */
export default async function ServiceEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const options = parseEmbedOptions(sp);
  const view = await loadServiceEmbed(
    slug,
    options,
    await mayPreviewService(slug, sp),
  );
  if (!view) notFound();
  return <EmbedBody view={view} />;
}
