"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { logTrade, type LogTradeInput } from "@/app/(tr)/actions";
import { signedPct, tone } from "@/lib/tr/format";

interface ServiceOption {
  code: string;
  name: string;
  slug: string;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const EMPTY = (code: string): LogTradeInput => ({
  code,
  portfolio: "dark-ticker",
  underlying: "",
  right: "C",
  strike: "",
  expiry: "",
  quantity: "1",
  openDate: "",
  entryPrice: "",
  closeDate: today(),
  exitPrice: "",
});

/** One closed options trade -> one row in the service's sheet. */
export function LogTradeForm({ services, sheetAccess }: { services: ServiceOption[]; sheetAccess: string | null }) {
  const [f, setF] = useState<LogTradeInput>(EMPTY(services[0]?.code ?? ""));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string; slug?: string } | null>(null);

  const set = (k: keyof LogTradeInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: k === "underlying" ? e.target.value.toUpperCase() : e.target.value }));

  const entry = Number(f.entryPrice);
  const exit = Number(f.exitPrice);
  const ret = entry > 0 && f.exitPrice !== "" && exit >= 0 ? exit / entry - 1 : null;
  const svc = services.find((s) => s.code === f.code);

  const field = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-brand focus:outline-none";
  const label = "mb-1 block text-sm font-medium text-ink";
  const hint = "mt-1 text-xs text-muted";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await logTrade(f);
          if (r.ok) {
            setResult({ ok: true, text: r.message, slug: svc?.slug });
            setF((x) => ({ ...EMPTY(x.code), portfolio: x.portfolio }));
          } else setResult({ ok: false, text: r.error });
        });
      }}
      className="space-y-6"
    >
      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Service</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="l-svc">Which service is this for?</label>
            <select id="l-svc" value={f.code} onChange={set("code")} className={field}>
              {services.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>
          {f.code === "PMK" && (
            <div>
              <label className={label} htmlFor="l-pf">Trade type</label>
              <select id="l-pf" value={f.portfolio} onChange={set("portfolio")} className={field}>
                <option value="dark-ticker">Dark Ticker</option>
                <option value="stock-flips">Stock Flips</option>
              </select>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="font-semibold">The option</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <div>
            <label className={label} htmlFor="l-u">Ticker</label>
            <input id="l-u" value={f.underlying} onChange={set("underlying")} className={field} autoComplete="off" required />
          </div>
          <div>
            <label className={label} htmlFor="l-r">Call or put</label>
            <select id="l-r" value={f.right} onChange={set("right")} className={field}>
              <option value="C">Call</option>
              <option value="P">Put</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="l-k">Strike ($)</label>
            <input id="l-k" inputMode="decimal" value={f.strike} onChange={set("strike")} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="l-x">Expiration</label>
            <input id="l-x" type="date" value={f.expiry} onChange={set("expiry")} className={field} required />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="font-semibold">The trade</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="l-od">Date opened</label>
            <input id="l-od" type="date" value={f.openDate} onChange={set("openDate")} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="l-ep">Price paid per contract ($)</label>
            <input id="l-ep" inputMode="decimal" value={f.entryPrice} onChange={set("entryPrice")} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="l-q">{f.code === "PMK" ? "Position weight" : "Contracts"}</label>
            <input id="l-q" inputMode="decimal" value={f.quantity} onChange={set("quantity")} className={field} required />
            {f.code === "PMK" && <p className={hint}>1 = a full position, 0.5 = a half.</p>}
          </div>
          <div>
            <label className={label} htmlFor="l-cd">Date closed</label>
            <input id="l-cd" type="date" value={f.closeDate} onChange={set("closeDate")} className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="l-xp">Closing price per contract ($)</label>
            <input id="l-xp" inputMode="decimal" value={f.exitPrice} onChange={set("exitPrice")} className={field} required />
            <p className={hint}>Enter 0 if it expired worthless.</p>
          </div>
          <div className="rounded-xl bg-paper px-4 py-3">
            <p className="text-sm text-muted">Return</p>
            <p className={`num text-2xl font-semibold ${tone(ret)}`}>{signedPct(ret)}</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending || !sheetAccess}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {pending ? "Adding to the sheet…" : "Add trade to the sheet"}
        </button>
        {result && (
          <p className={`text-sm ${result.ok ? "text-gain" : "text-loss"}`}>
            {result.text}{" "}
            {result.ok && result.slug && (
              <Link href={`/s/${result.slug}`} className="font-medium text-brand underline">
                View track record
              </Link>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
