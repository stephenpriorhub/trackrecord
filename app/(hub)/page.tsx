import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getManageContext } from "@/lib/manage-context";
import { canManageAnything, isAppLevel, portfolioScopeFilter } from "@/lib/authz";
import { statsByService, statsByPortfolio, type Stats } from "@/lib/managed/stats";
import { benchmarkSince, earliestStart } from "@/lib/managed/benchmark";
import { seedServicesFromTrackRecord } from "@/lib/managed/seed";
import { DEFAULT_BENCHMARK } from "@/lib/publications";
import NoManageAccess from "./NoManageAccess";
import { StatBar } from "./StatBar";

export const dynamic = "force-dynamic";

/**
 * The landing page: every publication with its overall figures, and a way into
 * its portfolios. Portfolio Manager is the app's front door now; the Airtable
 * Track Record lives in the nav.
 */
export default async function PublicationsPage() {
  const { user, scope } = await getManageContext();
  if (!canManageAnything(scope)) return <NoManageAccess user={user} />;

  // Derive services from the Track Record on first view so a fresh deploy is
  // never empty. Reads the mirror only; imports no positions.
  if (isAppLevel(scope)) await seedServicesFromTrackRecord();

  const scopeFilter = portfolioScopeFilter(scope) as Record<string, unknown> | null;
  const services = await prisma.service.findMany({
    where: scopeFilter ? { portfolios: { some: scopeFilter } } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      gurus: { include: { guru: true } },
      portfolios: {
        where: { archivedAt: null, ...(scopeFilter ?? {}) },
        select: { id: true, benchmarkTicker: true, startDate: true },
      },
    },
  });

  const stats = await statsByService(services.map((s) => s.id));
  // Per-portfolio stats too, purely for their earliest open dates: a
  // publication's benchmark window opens with whichever of its books started
  // first, and each book resolves its own start date before that comparison.
  const perPortfolio = await statsByPortfolio(
    services.flatMap((s) => s.portfolios.map((p) => p.id))
  );

  // One benchmark per publication: whatever most of its portfolios compare
  // against, so the headline matches what the reader sees inside.
  const rows = await Promise.all(
    services.map(async (s) => {
      const st = stats.get(s.id) ?? null;
      const ticker = commonBenchmark(s.portfolios.map((p) => p.benchmarkTicker));
      const from =
        earliestStart(
          s.portfolios.map((p) => ({
            startDate: p.startDate,
            earliestOpen: perPortfolio.get(p.id)?.since ?? null,
          }))
        ) ?? st?.since ?? null;
      const benchmark = st ? await benchmarkSince(ticker, from) : null;
      return { service: s, stats: st, benchmark };
    })
  );

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-xl font-bold">Publications</h2>
        <p className="mt-1 text-sm text-gray-500">
          Figures cover every portfolio in the publication. Open one to see its
          portfolios and positions.
        </p>
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
          No publications yet.
        </p>
      )}

      {rows.map(({ service, stats: st, benchmark }) => (
        <section key={service.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">{service.name}</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {service.pubCode}
                {service.gurus.length > 0 &&
                  ` · ${service.gurus.map((g) => g.guru.name).join(", ")}`}
                {" · "}
                {service.portfolios.length}{" "}
                {service.portfolios.length === 1 ? "portfolio" : "portfolios"}
              </p>
            </div>
            <Link
              href={`/publication/${service.slug}`}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              View portfolios →
            </Link>
          </div>

          {st && st.positions > 0 ? (
            <StatBar stats={st} benchmark={benchmark} showBenchmark />
          ) : (
            <p className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
              No positions yet.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/** The benchmark most of a publication's portfolios use. */
function commonBenchmark(tickers: string[]): string {
  if (tickers.length === 0) return DEFAULT_BENCHMARK;
  const counts = new Map<string, number>();
  for (const t of tickers) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export type { Stats };
