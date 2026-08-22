import { prisma } from "@/lib/prisma";
import { getCurrentHubUser, isHubAdmin } from "@/lib/hub-auth";
import { getManageScope, isAppLevel } from "@/lib/authz";
import ActionForm from "../ActionForm";
import {
  grantAppManagerAction,
  revokeAppManagerAction,
  assignEditorAction,
  unassignEditorAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentHubUser();
  const scope = await getManageScope(user);

  // Assigned editors have no business seeing who else has access.
  if (!isAppLevel(scope)) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="font-semibold">Not available</h2>
        <p className="mt-2 text-sm text-gray-400">
          Only portfolio managers can change who has access.
        </p>
      </div>
    );
  }

  const hubAdmin = isHubAdmin(user);
  const [managers, assignments, services] = await Promise.all([
    prisma.appManager.findMany({ orderBy: { email: "asc" } }),
    prisma.portfolioAssignment.findMany({
      orderBy: { email: "asc" },
      include: {
        service: { select: { name: true, pubCode: true } },
        portfolio: { select: { name: true, service: { select: { name: true } } } },
      },
    }),
    prisma.service.findMany({
      orderBy: { name: "asc" },
      include: {
        portfolios: {
          where: { archivedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-4">
          <h2 className="font-semibold">Portfolio managers</h2>
          <p className="mt-1 max-w-prose text-xs text-gray-500">
            Can manage every portfolio in every service, whatever their OxfordHub role.
            Super admins always have this. Hub admins do <em>not</em> — they have to be
            added here like anyone else.
          </p>
        </div>

        <ul className="divide-y divide-gray-800/60">
          {managers.length === 0 && (
            <li className="px-5 py-3 text-sm text-gray-500">
              Nobody designated yet. Super admins still have full access.
            </li>
          )}
          {managers.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{m.email}</p>
                {m.name && <p className="text-xs text-gray-500">{m.name}</p>}
              </div>
              {hubAdmin && (
                <ActionForm
                  action={revokeAppManagerAction}
                  submitLabel="Remove"
                  variant="danger"
                  confirm={`Remove ${m.email} as a portfolio manager?`}
                  silent
                >
                  <input type="hidden" name="id" value={m.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>

        <div className="border-t border-gray-800 px-5 py-4">
          {hubAdmin ? (
            <ActionForm
              action={grantAppManagerAction}
              submitLabel="Add manager"
              className="flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  OxfordHub email
                </span>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-72 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  Name (optional)
                </span>
                <input
                  name="name"
                  className="w-48 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                />
              </label>
            </ActionForm>
          ) : (
            <p className="text-xs text-gray-500">
              Only a hub admin can add or remove portfolio managers.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-4">
          <h2 className="font-semibold">Editors</h2>
          <p className="mt-1 max-w-prose text-xs text-gray-500">
            A guru assigned to a service can edit every portfolio in it, including ones
            added later. Assign a single portfolio instead to keep them to just that one.
          </p>
        </div>

        <ul className="divide-y divide-gray-800/60">
          {assignments.length === 0 && (
            <li className="px-5 py-3 text-sm text-gray-500">No editors assigned yet.</li>
          )}
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{a.email}</p>
                <p className="text-xs text-gray-500">
                  {a.service
                    ? `${a.service.name} — every portfolio`
                    : a.portfolio
                      ? `${a.portfolio.service.name} — ${a.portfolio.name}`
                      : "orphaned grant"}
                </p>
              </div>
              <ActionForm
                action={unassignEditorAction}
                submitLabel="Remove"
                variant="danger"
                confirm={`Remove ${a.email}'s access?`}
                silent
              >
                <input type="hidden" name="id" value={a.id} />
              </ActionForm>
            </li>
          ))}
        </ul>

        <div className="border-t border-gray-800 px-5 py-4">
          <ActionForm
            action={assignEditorAction}
            submitLabel="Assign editor"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                OxfordHub email
              </span>
              <input
                name="email"
                type="email"
                required
                className="w-72 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Whole service
              </span>
              <select
                name="serviceId"
                className="w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="">—</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                …or one portfolio
              </span>
              <select
                name="portfolioId"
                className="w-64 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="">—</option>
                {services.map((s) => (
                  <optgroup key={s.id} label={s.name}>
                    {s.portfolios.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
