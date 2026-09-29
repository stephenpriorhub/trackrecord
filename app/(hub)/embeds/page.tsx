import { prisma } from "@/lib/prisma";
import { getManageContext } from "@/lib/manage-context";
import { canManageAnything, canManageService, portfolioScopeFilter } from "@/lib/authz";
import NoManageAccess from "../NoManageAccess";
import EmbedBuilder, { type EmbedService, type SavedEmbedRow } from "../EmbedBuilder";

export const dynamic = "force-dynamic";

/**
 * Every embed variation from one place: any publication, whole or one
 * portfolio at a time, in any look. Portfolio and publication pages link here
 * pre-selected rather than each carrying their own copy of the builder.
 *
 * Lists only what the caller may manage — the same scope filter the rest of the
 * hub uses — so an editor sees their own books and nothing else. The embeds
 * themselves are public; this page only decides which ones you are offered.
 */
export default async function EmbedsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; portfolio?: string; saved?: string }>;
}) {
  const { user, scope } = await getManageContext();
  if (!canManageAnything(scope)) return <NoManageAccess user={user} />;
  const sp = await searchParams;

  const scopeFilter = portfolioScopeFilter(scope) as Record<string, unknown> | null;
  const services = await prisma.service.findMany({
    where: scopeFilter ? { portfolios: { some: scopeFilter } } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      portfolios: {
        where: { archivedAt: null, ...(scopeFilter ?? {}) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true, visibility: true },
      },
    },
  });

  const counts = await prisma.managedPosition.groupBy({
    by: ["portfolioId"],
    where: {
      deletedAt: null,
      portfolioId: { in: services.flatMap((s) => s.portfolios.map((p) => p.id)) },
    },
    _count: { _all: true },
  });
  const positions = new Map(counts.map((c) => [c.portfolioId, c._count._all]));

  const options: EmbedService[] = services
    .filter((s) => s.portfolios.length > 0)
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      books: s.portfolios.map((p) => ({
        slug: p.slug,
        name: p.name,
        isPublic: p.visibility === "PUBLIC",
        positions: positions.get(p.id) ?? 0,
      })),
    }));

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "https://trackrecord.oxfordhub.app";

  // Saved embeds for publications this person manages outright. A guru with
  // one portfolio sees none: a saved embed can span the whole publication.
  const manageable: string[] = [];
  for (const s of services) {
    if (await canManageService(scope, s.id)) manageable.push(s.id);
  }
  const saved = await prisma.savedEmbed.findMany({
    where: { deletedAt: null, serviceId: { in: manageable } },
    orderBy: { updatedAt: "desc" },
    include: { service: { select: { slug: true } } },
  });
  const savedList: SavedEmbedRow[] = saved.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    serviceSlug: r.service.slug,
    target: r.target,
    query: r.query,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedByEmail,
  }));
  const editing = sp.saved ? savedList.find((r) => r.id === sp.saved) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Embeds</h2>
        <p className="mt-1 max-w-prose text-sm text-gray-500">
          Build an embed for any publication or portfolio, preview it live, then
          copy the code into any page.
        </p>
      </div>
      {options.length === 0 ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-500">
          No portfolios to embed yet.
        </p>
      ) : (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <EmbedBuilder
            // Remount when switching saved embeds so every control re-seeds.
            key={editing?.id ?? "new"}
            origin={origin}
            editing={editing}
            savedList={savedList}
            services={options}
            initialService={sp.service}
            initialTarget={sp.portfolio}
          />
        </section>
      )}
    </div>
  );
}
