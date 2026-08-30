import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getManageContext } from "@/lib/manage-context";
import { canManagePortfolio, canManageAnything } from "@/lib/authz";
import { portfolioStats } from "@/lib/managed/stats";
import { benchmarkSince } from "@/lib/managed/benchmark";
import { BENCHMARKS, benchmarkLabel } from "@/lib/publications";
import NoManageAccess from "../../NoManageAccess";
import { StatBar } from "../../StatBar";
import EmbedBuilder from "../../EmbedBuilder";
import ActionForm from "../../ActionForm";
import AddPositionForm from "./AddPositionForm";
import {
  createPositionAction,
  closePositionAction,
  addCommentAction,
  deletePositionAction,
  updatePortfolioAction,
  setManualPriceAction,
} from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Closed positions rendered on this page. The figures above the table come from
 * portfolioStats, which runs its own query over the whole book, so capping what
 * is listed never changes what is reported.
 */
const CLOSED_PAGE = 200;

/** A stored FRACTION rendered as a signed percentage, with its colour. */
function pctSimple(v: unknown): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: "—", cls: "text-gray-500" };
  const n = Number(v) * 100;
  return {
    text: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`,
    cls: n >= 0 ? "text-green-400" : "text-red-400",
  };
}

function money(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return `$${Number(v).toFixed(2)}`;
}

function day(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ portfolioId: string }>;
}) {
  const { portfolioId } = await params;
  const { user, scope } = await getManageContext();
  if (!canManageAnything(scope)) return <NoManageAccess user={user} />;

  // Per-portfolio check. The layout only established that this person may be in
  // /manage at all; an editor assigned to one portfolio must not open another by
  // editing the URL. Ownership and existence failures both 404 so a probe cannot
  // tell "not yours" from "does not exist".
  if (!(await canManagePortfolio(scope, portfolioId))) notFound();

  const portfolio = await prisma.managedPortfolio.findUnique({
    where: { id: portfolioId },
    include: { service: true },
  });
  if (!portfolio) notFound();

  // Open and closed are fetched separately so the closed table can be capped
  // without capping the open one. Daily Profits Live imported 3,659 closed
  // trades into a single book; loading every one with its legs, instruments and
  // comments to render one page is a heavy query and a huge document, and the
  // editor is only ever looking at the recent end of it.
  const positionInclude = {
    guru: { select: { name: true } },
    legs: { orderBy: { legIndex: "asc" as const }, include: { instrument: true } },
    comments: {
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" as const },
      take: 3,
    },
  };

  const [open, closed, closedTotal] = await Promise.all([
    prisma.managedPosition.findMany({
      where: { portfolioId, deletedAt: null, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      include: positionInclude,
    }),
    prisma.managedPosition.findMany({
      where: { portfolioId, deletedAt: null, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      include: positionInclude,
      take: CLOSED_PAGE,
    }),
    prisma.managedPosition.count({
      where: { portfolioId, deletedAt: null, status: "CLOSED" },
    }),
  ]);

  const stats = await portfolioStats(portfolio.id);
  // Same window the embed uses: the explicit start date if set, otherwise the
  // earliest entry. The two views must never disagree about the comparison.
  const benchmark = portfolio.showBenchmark
    ? await benchmarkSince(
        portfolio.benchmarkTicker,
        portfolio.startDate ?? stats.since,
      )
    : null;
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "https://trackrecord.oxfordhub.app";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/publication/${portfolio.service.slug}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← {portfolio.service.name}
        </Link>
        <h2 className="mt-2 text-xl font-bold">{portfolio.name}</h2>
        {portfolio.description && (
          <p className="mt-1 max-w-prose text-sm text-gray-400">{portfolio.description}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {open.length} open · {closedTotal} closed
          {portfolio.showBenchmark && ` · vs ${benchmarkLabel(portfolio.benchmarkTicker)}`}
        </p>
      </div>

      <StatBar stats={stats} benchmark={benchmark} showBenchmark={portfolio.showBenchmark} />

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 font-semibold">Add a position</h3>
        <AddPositionForm
          portfolioId={portfolio.id}
          action={createPositionAction}
        />
      </section>

      <PositionTable
        title="Open positions"
        positions={open}
        empty="Nothing open yet."
        showClose
      />

      <PositionTable
        title={
          closedTotal > closed.length
            ? `Closed positions — most recent ${closed.length} of ${closedTotal.toLocaleString()}`
            : "Closed positions"
        }
        positions={closed}
        empty="Nothing closed yet."
      />

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-1 font-semibold">Portfolio settings</h3>
        <p className="mb-4 max-w-prose text-xs text-gray-500">
          Making this public lets anyone with the link view the embed. Renaming does not
          change the embed link.
        </p>
        <ActionForm
          action={updatePortfolioAction}
          submitLabel="Save settings"
          className="space-y-3"
        >
          <input type="hidden" name="portfolioId" value={portfolio.id} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">Name</span>
              <input
                name="name"
                defaultValue={portfolio.name}
                className="w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex min-w-[18rem] flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Description
              </span>
              <input
                name="description"
                defaultValue={portfolio.description ?? ""}
                placeholder="Shown above the positions"
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Compare against
              </span>
              <select
                name="benchmarkTicker"
                defaultValue={portfolio.benchmarkTicker}
                className="w-52 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                {BENCHMARKS.map((b) => (
                  <option key={b.ticker} value={b.ticker}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Show benchmark
              </span>
              <select
                name="showBenchmark"
                defaultValue={portfolio.showBenchmark ? "1" : "0"}
                className="w-32 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Start date
              </span>
              <input
                type="date"
                name="startDate"
                defaultValue={
                  portfolio.startDate
                    ? portfolio.startDate.toISOString().slice(0, 10)
                    : ""
                }
                className="w-44 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
              <span className="text-xs text-gray-600">
                {portfolio.startDate
                  ? "Clear to use the earliest entry"
                  : stats.since
                    ? `Earliest entry: ${stats.since.toLocaleDateString("en-US", { timeZone: "UTC" })}`
                    : "No positions yet"}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-500">Embed</span>
              <select
                name="visibility"
                defaultValue={portfolio.visibility}
                className="w-36 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="PRIVATE">Private</option>
                <option value="PUBLIC">Public</option>
              </select>
            </label>
          </div>
        </ActionForm>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-1 font-semibold">Embed this portfolio</h3>
        <p className="mb-4 max-w-prose text-xs text-gray-500">
          Pick what to show, then copy the code into any page.
        </p>
        <EmbedBuilder
          mode="portfolio"
          slug={portfolio.slug}
          origin={origin}
          isPublic={portfolio.visibility === "PUBLIC"}
        />
      </section>
    </div>
  );
}

/** Just the fields this table renders — keeps the component honest about what
 * the query must select. */
type PositionRow = {
  id: string;
  label: string;
  underlying: string;
  companyName: string | null;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  cachedEntryPrice: unknown;
  cachedCurrentPrice: unknown;
  cachedReturnPct: unknown;
  cachedUnpriced: boolean;
  cachedManualPriced: boolean;
  guru: { name: string } | null;
  buyUpToPrice: unknown;
  stopLossPrice: unknown;
  legs: {
    id: string;
    marketTicker: string;
    openQty: number;
    side: string;
    wavgEntry: unknown;
    instrument: {
      lastPrice: unknown;
      lastPriceAt: Date | null;
      /** Null means no refresh has looked at it yet — see setManualPriceAction. */
      lastCheckedAt: Date | null;
      manualPrice: unknown;
      priceSource: string;
    };
  }[];
  comments: {
    id: string;
    body: string;
    authorName: string | null;
    createdAt: Date;
  }[];
};

function PositionTable({
  title,
  positions,
  empty,
  showClose,
}: {
  title: string;
  positions: PositionRow[];
  empty: string;
  showClose?: boolean;
}) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-5 py-4">
        <h3 className="font-semibold">{title}</h3>
      </div>

      {positions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-800/60">
          {positions.map((p) => {
            const ret = pctSimple(p.cachedReturnPct);
            return (
              <li key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white">{p.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {/* Who made the pick. In the War Room this is the whole
                          point — Bryan and Karim never co-own a position. */}
                      {p.guru ? (
                        <span className="text-gray-400">{p.guru.name}</span>
                      ) : (
                        <span className="text-yellow-700">no owner set</span>
                      )}
                      {" · "}
                      {p.companyName ? `${p.companyName} · ` : ""}
                      opened {day(p.openedAt)}
                      {p.closedAt ? ` · closed ${day(p.closedAt)}` : ""}
                      {" · entry "}
                      {money(p.cachedEntryPrice)}
                      {p.cachedCurrentPrice !== null &&
                        ` · now ${money(p.cachedCurrentPrice)}`}
                    </p>
                    {p.cachedUnpriced && (
                      <p className="mt-1 text-xs text-yellow-500">
                        No current price available — return is not shown rather
                        than assumed.
                      </p>
                    )}
                  </div>

                  <div className={`text-lg font-bold ${ret.cls}`}>
                    {ret.text}
                  </div>
                </div>

                {p.comments.length > 0 && (
                  <ul className="mt-3 space-y-1 border-l-2 border-gray-800 pl-3">
                    {p.comments.map((c) => (
                      <li key={c.id} className="text-xs text-gray-400">
                        {c.body}
                        <span className="ml-2 text-gray-600">
                          {c.authorName ?? ""} {day(c.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <ActionForm
                    action={addCommentAction}
                    submitLabel="Comment"
                    variant="quiet"
                    className="flex items-end gap-2"
                  >
                    <input type="hidden" name="positionId" value={p.id} />
                    <input
                      name="body"
                      placeholder="Add a note"
                      className="w-64 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600"
                    />
                  </ActionForm>

                  {showClose && (
                    <ActionForm
                      action={closePositionAction}
                      submitLabel="Close"
                      variant="quiet"
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="positionId" value={p.id} />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-wide text-gray-500">
                          Date closed
                        </span>
                        <input
                          name="closedAt"
                          type="date"
                          className="w-36 rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-white [color-scheme:dark]"
                        />
                      </label>
                      {p.legs
                        .filter((l) => l.openQty > 0)
                        .map((l) => (
                          <label key={l.id} className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-wide text-gray-500">
                              {p.legs.length > 1
                                ? `${l.marketTicker} price`
                                : "Closing price"}
                            </span>
                            <div className="flex gap-1">
                              <input
                                name={`legPrice_${l.id}`}
                                inputMode="decimal"
                                className="w-24 rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-white"
                              />
                              {l.openQty > 1 && (
                                <input
                                  name={`legQty_${l.id}`}
                                  inputMode="numeric"
                                  placeholder={`of ${l.openQty}`}
                                  title="Leave blank to close all of it"
                                  className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-white placeholder-gray-600"
                                />
                              )}
                            </div>
                          </label>
                        ))}
                    </ActionForm>
                  )}

                  {p.legs
                    .filter(
                      (l) =>
                        l.openQty > 0 &&
                        l.instrument.lastPrice === null &&
                        l.instrument.lastCheckedAt !== null
                    )
                    .map((l) => (
                      <ActionForm
                        key={`mp-${l.id}`}
                        action={setManualPriceAction}
                        submitLabel={l.instrument.manualPrice ? "Update price" : "Set price"}
                        variant="quiet"
                        className="flex items-end gap-2"
                      >
                        <input type="hidden" name="positionId" value={p.id} />
                        <input type="hidden" name="ticker" value={l.marketTicker} />
                        <label className="flex flex-col gap-1">
                          <span
                            className="text-xs uppercase tracking-wide text-gray-500"
                            title="No price feed covers this instrument, so it can be entered by hand. A market price always wins if one appears."
                          >
                            {l.marketTicker} price (no feed)
                          </span>
                          <input
                            name="price"
                            inputMode="decimal"
                            defaultValue={
                              l.instrument.manualPrice
                                ? Number(l.instrument.manualPrice).toFixed(2)
                                : ""
                            }
                            className="w-28 rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-white"
                          />
                        </label>
                      </ActionForm>
                    ))}

                  <ActionForm
                    action={deletePositionAction}
                    submitLabel="Remove"
                    variant="danger"
                    confirm={`Remove ${p.label}? It stops showing on embeds but is kept and can be restored.`}
                    silent
                  >
                    <input type="hidden" name="positionId" value={p.id} />
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
