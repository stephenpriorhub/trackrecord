import Link from "next/link";
import { MarketStrip } from "@/components/tr/MarketStrip";
import { ServiceCard, type CardView } from "@/components/tr/ServiceCard";
import { fmtDate, int, pct, signedPct, tone } from "@/lib/tr/format";
import { longTermSummary } from "@/lib/tr/longterm";
import { marketStrip } from "@/lib/tr/market";
import { allPublicationInfo } from "@/lib/tr/publications";
import { loadSummaryTrades, summarise, weekAcrossServices } from "@/lib/tr/queries";
import { SERVICES, SHEET_SERVICES } from "@/lib/tr/services";
import { periodBounds, statsByPeriod, todayNY } from "@/lib/tr/stats";
import { requireViewer } from "@/lib/tr/viewer";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireViewer();
  const today = todayNY();
  const longTerm = SERVICES.filter((s) => s.kind === "INVESTING");

  const [market, info, byCode, lt] = await Promise.all([
    marketStrip(today),
    allPublicationInfo(SERVICES.map((s) => s.code)),
    loadSummaryTrades(SHEET_SERVICES.map((s) => s.code)),
    Promise.all(longTerm.map((s) => longTermSummary(s))),
  ]);
  const week = weekAcrossServices(byCode, today);
  const wk = periodBounds("week", today);
  const nameOf = (code: string) => SERVICES.find((s) => s.code === code)?.name ?? code;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted">{fmtDate(today)}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">MTA Track Record</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every closed trade from every MTA service, straight from each service&apos;s published spreadsheet. Pick a
          service to see each trade.
        </p>
      </header>

      <MarketStrip rows={market.rows} asOf={market.asOf} />

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">This week across MTA</h2>
          <p className="text-xs text-muted">
            Trades closed {fmtDate(wk.start)} – {fmtDate(today)}, all trading services
          </p>
        </div>
        <dl className="num mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ["Closed trades", int(week.stats.closed), "text-ink"],
              ["Winners", int(week.stats.winners), "text-ink"],
              ["Win rate", pct(week.stats.winRate, 1), "text-ink"],
              ["Average return", pct(week.stats.avgReturn), tone(week.stats.avgReturn)],
            ] as const
          ).map(([k, v, c]) => (
            <div key={k} className="rounded-xl bg-paper px-4 py-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className={`text-2xl font-semibold ${c}`}>{v}</dd>
            </div>
          ))}
        </dl>
        {week.top.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-medium text-muted">Top trades this week</h3>
            <ul className="mt-2 divide-y divide-line">
              {week.top.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium text-ink">{t.name}</span>
                    <span className="text-muted">
                      {" "}· {nameOf(t.serviceCode)}
                      {t.guru && <> · <span className="text-ink">{t.guru}</span></>}
                    </span>
                  </span>
                  <span className="num">
                    <span className={`font-semibold ${tone(t.returnPct)}`}>{signedPct(t.returnPct)}</span>
                    {t.holdDays !== null && <span className="text-faint"> · {t.holdDays} days</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="space-y-6">
        {SHEET_SERVICES.map((def) => {
          const trades = byCode.get(def.code) ?? [];
          const summary = summarise(def, trades, today);
          const views: CardView[] = [{ key: "all", label: def.byGuru ? "Combined" : "All", stats: summary.headline }];
          if (def.byGuru) {
            for (const g of summary.groups.filter((x) => x.kind === "guru")) {
              views.push({ key: g.key, label: g.label.split(" ")[0], stats: g.stats });
            }
          }
          const excluded = def.subPortfolios.filter((p) => !p.inHeadline);
          let note: string | undefined;
          if (excluded.length) {
            const ex = statsByPeriod(trades.filter((t) => excluded.some((p) => p.key === t.portfolio)), today).inception;
            note = `${excluded.map((p) => p.label).join(", ")} trades are tracked separately (${int(ex.closed)} trades, ${pct(ex.avgReturn)} avg.).`;
          }
          return (
            <ServiceCard
              key={def.code}
              name={def.name}
              href={`/s/${def.slug}`}
              logoUrl={info[def.code]?.logoUrl ?? null}
              gurus={def.gurus}
              views={views}
              weighted={!!def.weighted}
              note={note}
            />
          );
        })}
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Long-term portfolios</h2>
        <p className="mb-4 text-sm text-muted">
          Matt McCall&apos;s research services hold positions for the long run, so they&apos;re summarised as portfolios
          rather than trades.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {longTerm.map((def, i) => {
            const s = lt[i];
            const logo = info[def.code]?.logoUrl;
            return (
              <Link
                key={def.code}
                href={`/s/${def.slug}`}
                className="group flex flex-col rounded-2xl border border-line bg-card p-5 shadow-sm hover:border-brand"
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={def.name} className="h-12 w-auto max-w-[220px] object-contain" />
                ) : (
                  <h3 className="text-lg font-semibold leading-tight">{def.name}</h3>
                )}
                <p className="mt-1 text-sm text-muted">{def.gurus.join(" & ")}</p>
                {s.positions > 0 ? (
                  <dl className="num mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted">Open positions</dt>
                      <dd className="font-semibold">{int(s.open)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Avg. return</dt>
                      <dd className={`font-semibold ${tone(s.avgReturn)}`}>{signedPct(s.avgReturn)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Positions up</dt>
                      <dd className="font-semibold">{pct(s.winRate, 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">S&amp;P 500, same span</dt>
                      <dd className={`font-semibold ${tone(s.spx)}`}>{signedPct(s.spx)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-4 text-sm text-muted">No positions published yet.</p>
                )}
                <span className="mt-4 text-sm font-medium text-brand group-hover:underline">View portfolio →</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
