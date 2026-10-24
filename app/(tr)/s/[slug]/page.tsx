import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LongTermRecord } from "@/components/tr/LongTermRecord";
import { ServiceHeader } from "@/components/tr/ServiceHeader";
import { ServiceRecord } from "@/components/tr/ServiceRecord";
import { SharePanel } from "@/components/tr/SharePanel";
import { breakdownPeriod, flatParams, loadServicePage, type SearchParams } from "@/lib/tr/page-data";
import { KIND_LABEL, serviceBySlug } from "@/lib/tr/services";
import { requireViewer } from "@/lib/tr/viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const def = serviceBySlug((await params).slug);
  return { title: def ? `${def.name} · Track Record` : "Track Record" };
}

export default async function ServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireViewer();
  const def = serviceBySlug((await params).slug);
  if (!def) notFound();
  const sp = await searchParams;
  const data = await loadServicePage(def, sp, false);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const share = viewer.canAdmin ? (
    <SharePanel
      code={def.code}
      origin={origin}
      token={data.settings?.publicToken ?? null}
      enabled={!!data.settings?.publicEnabled}
      showBenchmark={data.settings?.publicShowBenchmark ?? true}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <ServiceHeader info={data.info} kindLabel={KIND_LABEL[def.kind]} gurus={def.gurus} extra={share} wikiLink />
      {data.kind === "longterm" ? (
        <LongTermRecord books={data.books} showBenchmark />
      ) : (
        <ServiceRecord
          def={def}
          summary={data.summary}
          list={data.list}
          filters={data.filters}
          params={flatParams(sp)}
          basePath={`/s/${def.slug}`}
          flags={{ internal: true, showBenchmark: true, canEdit: viewer.canLog }}
          period={breakdownPeriod(sp)}
          updatedAt={data.settings?.lastSyncedAt ?? null}
        />
      )}
    </div>
  );
}
