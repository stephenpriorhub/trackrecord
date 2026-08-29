import { notFound } from "next/navigation";
import { loadServiceEmbed, parseEmbedOptions } from "@/lib/managed/embed";
import EmbedBody from "../../EmbedBody";
import { mayPreviewService } from "../../preview-gate";

export const dynamic = "force-dynamic";

/**
 * The public embed for a WHOLE PUBLICATION — every public portfolio in the
 * service, merged into one open table and one closed table.
 *
 * `?only=` narrows that to named portfolios, which is how a service embed
 * leaves out a book that should not appear on a given page. It can only ever
 * subtract: visibility decides what is eligible in the first place, so naming a
 * private slug here publishes nothing.
 *
 * Query params:  ?show=open|closed|both  &returns=0  &comments=0
 *                &only=slug-a,slug-b  &portfolio=0  &preview=1
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
