import Link from "next/link";
import { MarketStrip } from "@/components/tr/MarketStrip";
import { ServiceCard, type CardView } from "@/components/tr/ServiceCard";
import { fmtDate, int, pct, signedPct, tone } from "@/lib/tr/format";
import { longTermBooks, summariseBooks } from "@/lib/tr/longterm";
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
  // Long-term services read either a sheet (Trend Advisory) or Portfolio
  // Manager (McCall); only the latter go through the books loader.
  const longTerm = SERVICES.filter((s) => s.kind === "INVESTING" && !s.sheetId);
  const sheetLongTerm = SHEET_SERVICES.filter((s) => s.kind === "INVESTING");

  const [market, info, byCode, lt] = await Promise.all([
    marketStrip(today),
    allPublicationInfo(SERVICES.map((s) => s.code)),
    loadSummaryTrades(SHEET_SERVICES.map((s) => s.code)),
    Promise.all(longTerm.map(async (s) => summariseBooks(await longTermBooks(s, false)))),
  ]);
  const week = weekAcrossServices(byCode, today);
  const wk = periodBounds("week", today);
  const nameOf = (code: string) => SERVICES.find((s) => s.code === code)?.name ?? code;

  const tradeCard = (def: (typeof SHEET_SERVICES)[number]) => {
          const trades = byCode.get(def.code) ?? [];
          const summary = summarise(def, trades, today);
          const views: CardView[] = [{ key: "all", label: def.byGuru ? "Combined" : "All", stats: summary.headline }];
          if (def.bookTables) {
            // One view per brand, each with its own figures (Trend Advisory first).
            views.splice(0, 1);
            for (const sp of def.subPortfolios) {
              const g = summary.groups.find((x) => x.kind === "portfolio" && x.key === sp.key);
              if (g) views.push({ key: sp.key, label: sp.years ? `${sp.label.replace(/^Monument /, "")} (${sp.years})` : sp.label, stats: g.stats });
            }
          }
          if (def.byGuru) {
            for (const g of summary.groups.filter((x) => x.kind === "guru")) {
              views.push({ key: g.key, label: g.label.split(" ")[0], stats: g.stats });
            }
          }
          const excluded = def.bookTables ? [] : def.subPortfolios.filter((p) => !p.inHeadline);
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
              wikiUrl={info[def.code]?.wikiUrl}
            />
          );
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted">{fmtDate(today)}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">MTA Track Record</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every closed trade from every MTA service. Pick a service to see each trade.
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
        {SHEET_SERVICES.filter((d) => d.kind !== "INVESTING").map(tradeCard)}
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Long-term portfolios</h2>
        <p className="mb-4 text-sm text-muted">
          Services that hold positions for the long run. Matt McCall&apos;s portfolios are summarised as portfolios
          rather than trades.
        </p>
        {sheetLongTerm.length > 0 && <div className="mb-4 space-y-6">{sheetLongTerm.map(tradeCard)}</div>}
        <div className="grid gap-4 lg:grid-cols-2">
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
                {s.some((b) => b.open + b.closed > 0) ? (
                  <table className="num mt-4 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="pb-1 font-medium">Portfolio</th>
                        <th className="pb-1 text-right font-medium">Total</th>
                        <th className="pb-1 text-right font-medium">Realized</th>
                        <th className="pb-1 text-right font-medium">Unrealized</th>
                        <th className="pb-1 text-right font-medium">S&amp;P 500</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.map((b) => (
                        <tr key={b.key} className="border-t border-line">
                          <td className="py-1.5 font-medium">{b.label}</td>
                          <td className={`py-1.5 text-right font-semibold ${tone(b.totalReturn)}`}>{signedPct(b.totalReturn)}</td>
                          <td className={`py-1.5 text-right ${tone(b.realized)}`}>{signedPct(b.realized)}</td>
                          <td className={`py-1.5 text-right ${tone(b.unrealized)}`}>{signedPct(b.unrealized)}</td>
                          <td className={`py-1.5 text-right ${tone(b.spx)}`}>{signedPct(b.spx)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
