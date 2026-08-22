import Link from "next/link";
import { getCurrentHubUser } from "@/lib/hub-auth";
import { getManageScope, isAppLevel, portfolioScopeFilter } from "@/lib/authz";
import { listServicesWithPortfolios } from "@/lib/managed/portfolios";
import { seedServicesFromTrackRecord } from "@/lib/managed/seed";
import ActionForm from "./ActionForm";
import {
  createPortfolioAction,
  archivePortfolioAction,
  reorderPortfolioAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function ManageIndex() {
  const user = await getCurrentHubUser();
  const scope = await getManageScope(user);
  const appLevel = isAppLevel(scope);

  // Derive the services from the Track Record on first view, so the page is
  // never empty on a fresh deploy and nobody has to run a seed script. Reading
  // the mirror only — it imports no positions.
  if (appLevel) await seedServicesFromTrackRecord();

  const services = await listServicesWithPortfolios(
    portfolioScopeFilter(scope) as Record<string, unknown> | null
  );

  return (
    <div className="space-y-8">
      {services.length === 0 && (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
          No services yet.
        </p>
      )}

      {services.map((service) => (
        <section key={service.id} className="rounded-xl border border-gray-800 bg-gray-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-800 px-5 py-4">
            <div>
              <h2 className="font-semibold text-white">{service.name}</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {service.pubCode}
                {service.gurus.length > 0 &&
                  ` · ${service.gurus.map((g) => g.guru.name).join(", ")}`}
              </p>
            </div>
            <span className="text-xs text-gray-500">
              {service.portfolios.length}{" "}
              {service.portfolios.length === 1 ? "portfolio" : "portfolios"}
            </span>
          </div>

          <ul className="divide-y divide-gray-800/60">
            {service.portfolios.map((p, i) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-gray-800/30"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/manage/${p.id}`}
                    className="font-medium text-white hover:text-blue-400"
                  >
                    {p.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p._count.positions}{" "}
                    {p._count.positions === 1 ? "position" : "positions"} ·{" "}
                    <span className={p.visibility === "PUBLIC" ? "text-green-500" : ""}>
                      {p.visibility === "PUBLIC" ? "public embed" : "private"}
                    </span>{" "}
                    · vs {p.benchmarkTicker}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {i > 0 && (
                    <ActionForm
                      action={reorderPortfolioAction}
                      submitLabel="↑"
                      variant="quiet"
                      silent
                    >
                      <input type="hidden" name="portfolioId" value={p.id} />
                      <input type="hidden" name="direction" value="up" />
                    </ActionForm>
                  )}
                  {i < service.portfolios.length - 1 && (
                    <ActionForm
                      action={reorderPortfolioAction}
                      submitLabel="↓"
                      variant="quiet"
                      silent
                    >
                      <input type="hidden" name="portfolioId" value={p.id} />
                      <input type="hidden" name="direction" value="down" />
                    </ActionForm>
                  )}
                  <ActionForm
                    action={archivePortfolioAction}
                    submitLabel="Archive"
                    variant="quiet"
                    confirm={`Archive "${p.name}"? Its positions are kept and it can be restored, but any live embed will stop showing it.`}
                    silent
                  >
                    <input type="hidden" name="portfolioId" value={p.id} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>

          {(appLevel || scope.level === "ASSIGNED") && (
            <div className="border-t border-gray-800 px-5 py-4">
              <ActionForm
                action={createPortfolioAction}
                submitLabel="Add portfolio"
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="serviceId" value={service.id} />
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    Portfolio name
                  </span>
                  <input
                    name="name"
                    required
                    className="w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    Compare against
                  </span>
                  <input
                    name="benchmarkTicker"
                    defaultValue="SPY"
                    className="w-24 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  />
                </label>
              </ActionForm>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
