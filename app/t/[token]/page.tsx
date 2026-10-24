import { notFound } from "next/navigation";
import { LongTermRecord } from "@/components/tr/LongTermRecord";
import { ServiceHeader } from "@/components/tr/ServiceHeader";
import { ServiceRecord } from "@/components/tr/ServiceRecord";
import { prisma } from "@/lib/prisma";
import { breakdownPeriod, flatParams, loadServicePage, type SearchParams } from "@/lib/tr/page-data";
import { KIND_LABEL, serviceByCode } from "@/lib/tr/services";

export const dynamic = "force-dynamic";

async function resolve(token: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const row = await prisma.trService.findUnique({ where: { publicToken: token } });
  // A disabled link 404s exactly like an unknown one.
  if (!row?.publicEnabled) return null;
  const def = serviceByCode(row.code);
  return def ? { def, row } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const r = await resolve((await params).token);
  return {
    title: r ? `${r.def.name} · Track Record` : "Track Record",
    robots: { index: false, follow: false },
  };
}

export default async function PublicServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const r = await resolve(token);
  if (!r) notFound();
  const { def, row } = r;
  const sp = await searchParams;
  const data = await loadServicePage(def, sp, true);

  return (
    <div className="space-y-6">
      <ServiceHeader info={data.info} kindLabel={KIND_LABEL[def.kind]} gurus={def.gurus} />
      {data.kind === "longterm" ? (
        <LongTermRecord books={data.books} showBenchmark={row.publicShowBenchmark} />
      ) : (
        <ServiceRecord
          def={def}
          summary={data.summary}
          list={data.list}
          filters={data.filters}
          params={flatParams(sp)}
          basePath={`/t/${token}`}
          flags={{ internal: false, showBenchmark: row.publicShowBenchmark }}
          period={breakdownPeriod(sp)}
          updatedAt={row.lastSyncedAt}
        />
      )}
    </div>
  );
}
