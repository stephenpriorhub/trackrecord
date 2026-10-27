import Link from "next/link";
import { StatsTable } from "./StatsTable";
import { TradeFilters } from "./TradeFilters";
import { EditTradeButton } from "./EditTradeButton";
import { chipTone, days, fmtDate, int, pct, price, signedPct, tone } from "@/lib/tr/format";
import {
  PAGE_SIZE,
  SORTS,
  TYPE_FILTERS,
  airtableUrl,
  defaultDir,
  type ServiceSummary,
  type TradeFilters as Filters,
  type TradeRow,
} from "@/lib/tr/queries";
import type { ServiceDef } from "@/lib/tr/services";
import { PERIOD_LABEL, type PeriodKey, type PeriodStats } from "@/lib/tr/stats";

export interface RecordFlags {
  /** Signed-in view: Airtable links + flags. Public pages never show them. */
  internal: boolean;
  showBenchmark: boolean;
  /** Admins and App Managers: an Edit button per trade. */
  canEdit?: boolean;
}

const PERIODS: PeriodKey[] = ["week", "lastWeek", "month", "year", "inception"];

function qs(sp: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function Breakdown({
  def,
  summary,
  period,
  basePath,
  params,
}: {
  def: ServiceDef;
  summary: ServiceSummary;
  period: PeriodKey;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (summary.groups.length === 0) return null;
  const sections: { title: string; rows: { label: string; note?: string; s: PeriodStats; filter: Record<string, string> }[] }[] = [];
  const gurus = summary.groups.filter((g) => g.kind === "guru");
  const books = summary.groups.filter((g) => g.kind === "portfolio");
  if (gurus.length) {
    sections.push({
      title: "By editor",
      rows: gurus.map((g) => ({ label: g.label, s: g.stats[period], filter: { guru: g.key } })),
    });
  }
  if (books.length) {
    sections.push({
      title: def.byGuru ? "By strategy" : "By portfolio",
      rows: books.map((g) => ({
        label: g.label,
        note: g.inHeadline ? undefined : "Tracked separately — not in the service totals",
        s: g.stats[period],
        filter: { portfolio: g.key },
      })),
    });
  }
  const ret = (s: PeriodStats) => (def.weighted ? s.weightedAvgReturn : s.avgReturn);

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Breakdown</h2>
        <div className="flex flex-wrap rounded-lg border border-line bg-paper p-0.5 text-xs">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`${basePath}${qs(params, { bp: p === "inception" ? undefined : p })}`}
              scroll={false}
              className={`rounded-md px-2.5 py-1 ${p === period ? "bg-card font-medium text-brand shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>
      </div>
      {sections.map((sec) => (
        <div key={sec.title} className="mt-4 overflow-x-auto">
          <table className="num w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">{sec.title}</th>
                <th className="px-3 py-2 text-right font-medium">Closed</th>
                <th className="px-3 py-2 text-right font-medium">Win rate</th>
                <th className="px-3 py-2 text-right font-medium">{def.weighted ? "Weighted avg." : "Avg. return"}</th>
                <th className="px-3 py-2 text-right font-medium">Avg. days</th>
                <th className="px-3 py-2 text-left font-medium">Best trade</th>
                <th className="py-2 pl-3" />
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((r) => (
                <tr key={r.label} className="border-b border-line/70 last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {r.label}
                    {r.note && <span className="block text-[11px] font-normal text-faint">{r.note}</span>}
                  </th>
                  <td className="px-3 py-2 text-right">{int(r.s.closed)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.s.winRate, 1)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${tone(ret(r.s))}`}>{pct(ret(r.s))}</td>
                  <td className="px-3 py-2 text-right">{days(r.s.avgDaysHeld)}</td>
                  <td className="px-3 py-2 text-left text-xs">
                    {r.s.best ? (
                      <>
                        {r.s.best.name} <span className={`font-semibold ${tone(r.s.best.returnPct)}`}>{pct(r.s.best.returnPct)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <Link href={`${basePath}${qs({}, { ...r.filter, bp: params.bp })}#trades`} className="text-xs text-brand hover:underline">
                      Trades →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function BenchmarkPanel({ summary }: { summary: ServiceSummary }) {
  const cells = (["year", "inception"] as PeriodKey[]).map((k) => ({ k, b: summary.benchmark[k] }));
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Compared with the S&amp;P 500</h2>
      <p className="mt-1 text-sm text-muted">
        For every closed trade we measured what buying and holding the S&amp;P 500 would have returned over the exact
        same days — from the close on the day the trade opened to the close on the day it closed, dividends included.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {cells.map(({ k, b }) => (
          <div key={k} className="rounded-xl bg-paper p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-faint">{PERIOD_LABEL[k]}</p>
            {b.trades === 0 ? (
              <p className="mt-2 text-sm text-muted">No closed trades.</p>
            ) : (
              <dl className="num mt-2 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted">Avg. trade</dt>
                  <dd className={`text-lg font-semibold ${tone(b.avgTrade)}`}>{signedPct(b.avgTrade)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">S&amp;P, same days</dt>
                  <dd className={`text-lg font-semibold ${tone(b.avgSpx)}`}>{signedPct(b.avgSpx)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Beat the S&amp;P</dt>
                  <dd className="text-lg font-semibold">{pct(b.beatRate, 0)}</dd>
                </div>
              </dl>
            )}
            {b.trades > 0 && <p className="mt-1 text-[11px] text-faint">{int(b.trades)} trades</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Massive 2026-10-27T15:02Z" -> "Massive · Oct 27, 11:02 AM". */
function priceSource(notes: string | null): string {
  if (!notes?.startsWith("Massive")) return "Airtable price";
  const at = notes.slice(8);
  if (!at) return "Massive";
  const d = new Date(at);
  return `Massive · ${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function tradeKind(r: TradeRow): string {
  if (r.assetType === "STOCK") return r.side === "SHORT" ? "Stock (short)" : "Stock";
  switch (r.structure) {
    case "PUT_SELL": return "Sold put";
    case "STRANGLE": return "Strangle";
    case "SPREAD": return `${r.optionType === "PUT" ? "Put" : r.optionType === "CALL" ? "Call" : "Option"} spread`;
    case "BUTTERFLY": return "Butterfly";
    default: return r.optionType === "CALL" ? "Bought call" : r.optionType === "PUT" ? "Bought put" : "Option";
  }
}

interface SortState {
  key: string;
  dir: "asc" | "desc";
  href: (key: string, dir: "asc" | "desc") => string;
}

/** A column header that sorts the table; a second click reverses it. */
function SortTh({ label, k, sort, right }: { label: React.ReactNode; k: string; sort?: SortState; right?: boolean }) {
  const cls = `px-3 py-2.5 font-medium ${right ? "text-right" : ""}`;
  if (!sort) return <th className={cls}>{label}</th>;
  const active = sort.key === k;
  const next = active ? (sort.dir === "asc" ? "desc" : "asc") : defaultDir(k);
  return (
    <th className={cls} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={sort.href(k, next)}
        scroll={false}
        className={`inline-flex items-center gap-1 hover:text-brand ${active ? "text-ink" : ""}`}
      >
        {label}
        <span className={active ? "text-brand" : "text-faint"} aria-hidden>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

function TradeTable({
  def,
  rows,
  flags,
  sort,
}: {
  def: ServiceDef;
  rows: TradeRow[];
  flags: RecordFlags;
  sort?: SortState;
}) {
  const book = (k: string) => def.subPortfolios.find((p) => p.key === k)?.label;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="num w-full min-w-[860px] text-sm">
        <thead className="bg-paper">
          <tr className="text-left text-xs text-muted">
            <SortTh label="Trade" k="symbol" sort={sort} />
            <SortTh label="Opened" k="opened" sort={sort} />
            {rows.some((r) => r.status === "CLOSED") || !sort ? (
              <SortTh label="Closed" k="closed" sort={sort} />
            ) : (
              <th className="px-3 py-2.5 font-medium">Closed</th>
            )}
            <SortTh label="Days" k="days" sort={sort} right />
            <th className="px-3 py-2.5 text-right font-medium">Entry → Exit</th>
            <SortTh label="Return" k="return" sort={sort} right />
            {flags.showBenchmark && <SortTh label={<>S&amp;P same days</>} k="spx" sort={sort} right />}
            {flags.internal && <th className="px-3 py-2.5 text-right font-medium">Airtable</th>}
            {flags.canEdit && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody className="bg-card">
          {rows.map((r) => {
            const beat = r.returnPct !== null && r.spxReturnPct !== null ? r.returnPct - r.spxReturnPct : null;
            const sub = [
              tradeKind(r),
              def.subPortfolios.length > 1 ? book(r.portfolio) : null,
              def.byGuru && r.guru ? r.guru.split(" ")[0] : null,
            ].filter(Boolean);
            return (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-xs text-muted">{sub.join(" · ")}</p>
                  {r.status === "OPEN" && (
                    <span className="mt-1 inline-block rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">Open</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(r.openDate)}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(r.closeDate)}</td>
                <td className="px-3 py-2.5 text-right">{r.holdDays ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted">
                  {price(r.entryPrice)} → {price(r.status === "OPEN" ? r.currentPrice : r.exitPrice)}
                  {r.status === "OPEN" && (
                    <span className="block text-[11px] text-faint">{priceSource(r.notes)}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`inline-block rounded-md px-2 py-0.5 font-semibold ${chipTone(r.returnPct)}`}>{signedPct(r.returnPct)}</span>
                  {r.premiumCapture !== null && def.premiumCapture && (
                    <span className="mt-0.5 block text-[11px] text-muted">{pct(r.premiumCapture, 1)} of premium kept</span>
                  )}
                </td>
                {flags.showBenchmark && (
                  <td className="px-3 py-2.5 text-right">
                    <span className={tone(r.spxReturnPct)}>{signedPct(r.spxReturnPct)}</span>
                    {beat !== null && (
                      <span className={`block text-[11px] ${beat > 0 ? "text-gain" : "text-faint"}`}>
                        {beat > 0 ? `beat by ${pct(beat, 1)}` : "trailed"}
                      </span>
                    )}
                  </td>
                )}
                {flags.internal && (
                  <td className="px-3 py-2.5 text-right">
                    {r.airtableId ? (
                      <a
                        href={airtableUrl(r.airtableId)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block rounded-md border border-line px-2 py-1 text-xs text-brand hover:border-brand"
                      >
                        Open ↗
                      </a>
                    ) : (
                      <span
                        className="inline-block rounded-md bg-warn-soft px-2 py-1 text-xs font-medium text-warn"
                        title={`No matching Airtable position. Sheet: ${r.sheetTab}, row ${r.sheetRow}`}
                      >
                        ⚑ Not in Airtable
                      </span>
                    )}
                  </td>
                )}
                {flags.canEdit && (
                  <td className="px-2 py-2.5 text-right">
                    {!r.sheetTab.startsWith("Archive") && r.sheetTab !== "Airtable" && <EditTradeButton
                      trade={{
                        id: r.id,
                        name: r.name,
                        openDate: r.openDate.toISOString().slice(0, 10),
                        closeDate: r.closeDate ? r.closeDate.toISOString().slice(0, 10) : null,
                        entryPrice: r.entryPrice,
                        exitPrice: r.exitPrice,
                        returnPct: r.returnPct,
                        credit: r.side === "SHORT",
                        returnFromSheet: def.code === "PMK" || def.code === "TPU",
                        sheetTab: r.sheetTab,
                        sheetRow: r.sheetRow,
                      }}
                    />}
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-10 text-center text-muted">
                No trades match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ServiceRecord({
  def,
  summary,
  list,
  open = [],
  filters,
  params,
  basePath,
  flags,
  period,
  updatedAt,
  mainLogoUrl = null,
}: {
  def: ServiceDef;
  summary: ServiceSummary;
  list: { rows: TradeRow[]; total: number; page: number; pages: number; filtered: PeriodStats };
  /** Open positions from Airtable; internal pages only. */
  open?: TradeRow[];
  filters: Filters;
  params: Record<string, string | undefined>;
  basePath: string;
  flags: RecordFlags;
  period: PeriodKey;
  updatedAt: Date | null;
  /** The service's own logo, for its first book when books have their own. */
  mainLogoUrl?: string | null;
}) {
  const filtering = Object.entries(filters).some(([k, v]) => v && !["page", "sort", "dir"].includes(k));
  const ret = def.weighted ? list.filtered.weightedAvgReturn : list.filtered.avgReturn;
  const gurus = def.byGuru ? def.gurus : [];
  const types = TYPE_FILTERS.filter((t) =>
    def.code === "WAR" ? true : !["strangles", "put-sells"].includes(t.value),
  );

  return (
    <div className="space-y-6">
      {def.bookTables ? (
        def.subPortfolios.map((p, i) => {
          const g = summary.groups.find((x) => x.kind === "portfolio" && x.key === p.key);
          if (!g) return null;
          const logo = p.logoUrl ?? (i === 0 ? mainLogoUrl : null);
          return (
            <section key={p.key} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt={p.label} className="h-10 w-auto max-w-[220px] object-contain" />
                  ) : null}
                  <h2 className="text-lg font-semibold">
                    {p.label}
                    {p.years && <span className="ml-2 font-normal text-muted">({p.years})</span>}
                  </h2>
                </div>
                <Link
                  href={`${basePath}${qs({}, { portfolio: p.key })}#trades`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  See these trades →
                </Link>
              </div>
              <div className="mt-3">
                <StatsTable stats={g.stats} weighted={!!def.weighted} />
              </div>
              {i === 0 && updatedAt && (
                <p className="mt-2 text-xs text-faint">
                  Updated from the spreadsheet {updatedAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET
                </p>
              )}
            </section>
          );
        })
      ) : (
        <>
      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Performance summary</h2>
            <p className="text-xs text-muted">
              {summary.firstTrade && <>Since {fmtDate(summary.firstTrade)} · </>}
              {updatedAt && <>Updated from the spreadsheet {updatedAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET</>}
            </p>
          </div>
          <div className="mt-3">
            <StatsTable stats={summary.headline} weighted={!!def.weighted} />
          </div>
          {def.subPortfolios.some((p) => !p.inHeadline) && (
            <p className="mt-2 text-xs text-faint">
              Totals exclude {def.subPortfolios.filter((p) => !p.inHeadline).map((p) => p.label).join(", ")}, which is tracked separately below.
            </p>
          )}
        </section>
  
        <Breakdown def={def} summary={summary} period={period} basePath={basePath} params={params} />
        </>
      )}

      {flags.showBenchmark && <BenchmarkPanel summary={summary} />}

      {flags.internal && (
        <section id="open" className="scroll-mt-20 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Open positions</h2>
            <p className="text-sm text-muted">{int(open.length)} open in Airtable</p>
          </div>
          {open.length > 0 ? (
            <TradeTable
              def={def}
              rows={open}
              flags={flags}
              sort={{
                key: params.osort && params.osort !== "closed" ? params.osort : "opened",
                dir: params.odir === "asc" ? "asc" : params.odir === "desc" ? "desc" : defaultDir(params.osort ?? "opened"),
                href: (k, d) => `${basePath}${qs(params, { osort: k, odir: d })}#open`,
              }}
            />
          ) : (
            <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-sm text-muted">No open positions.</p>
          )}
          <p className="text-xs text-faint">
            From Airtable, at Airtable&apos;s latest price. When the spreadsheet records the close, the trade moves to
            the list below with the sheet&apos;s numbers, and the app adds the closing trade to Airtable.
          </p>
        </section>
      )}

      <section id="trades" className="scroll-mt-20 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{filters.q && !filters.status ? "All trades" : "Closed trades"}</h2>
          <p className="text-sm text-muted">
            {int(list.total)} {filtering ? "matching" : ""} trades
            {list.filtered.closed > 0 && (
              <>
                {" "}· win rate {pct(list.filtered.winRate, 1)} · {def.weighted ? "weighted avg." : "avg."}{" "}
                <span className={`font-semibold ${tone(ret)}`}>{pct(ret)}</span>
              </>
            )}
          </p>
        </div>
        <TradeFilters
          basePath={basePath}
          portfolios={def.subPortfolios.map((p) => ({ value: p.key, label: p.label }))}
          gurus={gurus}
          types={types}
          sorts={SORTS}
          showAirtable={flags.internal}
        />
        <TradeTable
          def={def}
          rows={list.rows}
          flags={flags}
          sort={{
            key: filters.sort ?? "closed",
            dir: filters.dir ?? defaultDir(filters.sort ?? "closed"),
            href: (k, d) => `${basePath}${qs(params, { sort: k, dir: d, page: undefined })}#trades`,
          }}
        />
        {list.pages > 1 && (
          <nav className="flex items-center justify-between text-sm">
            <span className="text-muted">
              Showing {int((list.page - 1) * PAGE_SIZE + 1)}–{int(Math.min(list.page * PAGE_SIZE, list.total))} of {int(list.total)}
            </span>
            <span className="flex gap-2">
              {list.page > 1 && (
                <Link href={`${basePath}${qs(params, { page: String(list.page - 1) })}#trades`} className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-brand">
                  ← Previous
                </Link>
              )}
              {list.page < list.pages && (
                <Link href={`${basePath}${qs(params, { page: String(list.page + 1) })}#trades`} className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-brand">
                  Next →
                </Link>
              )}
            </span>
          </nav>
        )}
        <p className="text-xs text-faint">
          Returns are as published in the service&apos;s track-record spreadsheet. Option trades are per contract; put
          sells and strangles are measured on the credit received.
        </p>
      </section>
    </div>
  );
}
