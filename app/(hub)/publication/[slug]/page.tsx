import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getManageContext } from "@/lib/manage-context";
import {
  canManageAnything,
  canManageService,
  portfolioScopeFilter,
  isAppLevel,
} from "@/lib/authz";
import { statsByPortfolio, serviceStats } from "@/lib/managed/stats";
import { benchmarkSince } from "@/lib/managed/benchmark";
import { DEFAULT_BENCHMARK, benchmarkLabel } from "@/lib/publications";
import NoManageAccess from "../../NoManageAccess";
import { StatBar } from "../../StatBar";
import ActionForm from "../../ActionForm";
import { createPortfolioAction, archivePortfolioAction, reorderPortfolioAction } from "../../actions";

export const dynamic = "force-dynamic";

/** One publication: its overall figures, then a breakdown by portfolio. */
export default async function PublicationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, scope } = await getManageContext();
  if (!canManageAnything(scope)) return <NoManageAccess user={user} />;

  const scopeFilter = portfolioScopeFilter(scope) as Record<string, unknown> | null;

  const service = await prisma.service.findUnique({
    where: { slug },
    include: {
      gurus: { include: { guru: true } },
      portfolios: {
        where: { archivedAt: null, ...(scopeFilter ?? {}) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });
  // An editor who holds nothing in this publication gets the same 404 as a bad
  // slug, so probing tells them nothing.
  if (!service || service.portfolios.length === 0) notFound();

  const overall = await serviceStats(service.id);
  const perPortfolio = await statsByPortfolio(service.portfolios.map((p) => p.id));

  const headlineBenchmark = await benchmarkSince(
    service.portfolios[0]?.benchmarkTicker ?? DEFAULT_BENCHMARK,
    overall.since
  );

  const rows = await Promise.all(
    service.portfolios.map(async (p) => {
      const st = perPortfolio.get(p.id)!;
      const bench = p.showBenchmark ? await benchmarkSince(p.benchmarkTicker, st.since) : null;
      return { portfolio: p, stats: st, bench };
    })
  );

  const canAddPortfolio = await canManageService(scope, service.id);

  return (
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
          ← All publications
        </Link>
        <h2 className="mt-2 text-xl font-bold">{service.name}</h2>
        <p className="mt-1 text-xs text-gray-500">
          {service.pubCode}
          {service.gurus.length > 0 &&
            ` · ${service.gurus.map((g) => g.guru.name).join(", ")}`}
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-xs uppercase tracking-wide text-gray-500">
          Whole publication
        </h3>
        <StatBar stats={overall} benchmark={headlineBenchmark} showBenchmark />
      </section>

      <section className="space-y-5">
        <h3 className="text-xs uppercase tracking-wide text-gray-500">
          Portfolios ({rows.length})
        </h3>

        {rows.map(({ portfolio: p, stats: st, bench }, i) => (
          <div key={p.id} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/portfolio/${p.id}`}
                  className="font-semibold text-white hover:text-blue-400"
                >
                  {p.name}
                </Link>
                {p.description && (
                  <p className="mt-0.5 max-w-prose text-xs text-gray-500">{p.description}</p>
                )}
                <p className="mt-0.5 text-xs text-gray-600">
                  <span className={p.visibility === "PUBLIC" ? "text-green-500" : ""}>
                    {p.visibility === "PUBLIC" ? "public embed" : "private"}
                  </span>
                  {p.showBenchmark && ` · vs ${benchmarkLabel(p.benchmarkTicker)}`}
                </p>
              </div>

              <div className="flex items-center gap-1">
                {i > 0 && (
                  <ActionForm action={reorderPortfolioAction} submitLabel="↑" variant="quiet" silent>
                    <input type="hidden" name="portfolioId" value={p.id} />
                    <input type="hidden" name="direction" value="up" />
                  </ActionForm>
                )}
                {i < rows.length - 1 && (
                  <ActionForm action={reorderPortfolioAction} submitLabel="↓" variant="quiet" silent>
                    <input type="hidden" name="portfolioId" value={p.id} />
                    <input type="hidden" name="direction" value="down" />
                  </ActionForm>
                )}
                <Link
                  href={`/portfolio/${p.id}`}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
                >
                  Open
                </Link>
                <ActionForm
                  action={archivePortfolioAction}
                  submitLabel="Archive"
                  variant="quiet"
                  confirm={`Archive "${p.name}"? Its positions are kept and it can be restored, but any live embed stops showing it.`}
                  silent
                >
                  <input type="hidden" name="portfolioId" value={p.id} />
                </ActionForm>
              </div>
            </div>

            {st.positions > 0 ? (
              <StatBar stats={st} benchmark={bench} showBenchmark={p.showBenchmark} compact />
            ) : (
              <p className="text-sm text-gray-500">No positions yet.</p>
            )}
          </div>
        ))}
      </section>

      {canAddPortfolio && (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="mb-3 font-semibold">Add a portfolio</h3>
          <ActionForm
            action={createPortfolioAction}
            submitLabel="Add portfolio"
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="serviceId" value={service.id} />
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">Name</span>
              <input
                name="name"
                required
                className="w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Description (optional)
              </span>
              <input
                name="description"
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </label>
          </ActionForm>
        </section>
      )}

      {isAppLevel(scope) && (
        <p className="text-xs text-gray-600">
          Figures exclude positions nothing can price, rather than counting them as zero.
        </p>
      )}
    </div>
  );
}
