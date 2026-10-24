"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { logTrade, type LegInput, type LogTradeInput } from "@/app/(tr)/actions";
import { signedPct, tone } from "@/lib/tr/format";

interface ServiceOption {
  code: string;
  name: string;
  slug: string;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const blankLeg = (action = "BUY", right = "C", expiry = ""): LegInput => ({ action, right, strike: "", expiry });

const KINDS = [
  { value: "SINGLE", label: "Bought a call or put", hint: "One option, bought." },
  { value: "MULTI", label: "Spread / multi-leg", hint: "Two or more legs: verticals, butterflies, strangles…" },
  { value: "PUT_SELL", label: "Sold a put", hint: "Opened for a credit." },
] as const;

const EMPTY = (code: string): LogTradeInput => ({
  code,
  portfolio: "dark-ticker",
  underlying: "",
  structure: "SINGLE",
  credit: false,
  legs: [blankLeg()],
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
  const setLeg = (i: number, k: keyof LegInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, legs: x.legs.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) }));

  function setKind(kind: string) {
    setF((x) => {
      const first = x.legs[0] ?? blankLeg();
      if (kind === "SINGLE") return { ...x, structure: kind, credit: false, legs: [{ ...first, action: "BUY" }] };
      if (kind === "PUT_SELL") return { ...x, structure: kind, credit: true, legs: [{ ...first, action: "SELL", right: "P" }] };
      // A spread starts as two legs: buy one, sell one, same type and expiry.
      const legs = x.legs.length >= 2 ? x.legs : [{ ...first, action: "BUY" }, blankLeg("SELL", first.right, first.expiry)];
      return { ...x, structure: kind, legs };
    });
  }

  const credit = f.structure === "PUT_SELL" || (f.structure === "MULTI" && f.credit);
  const entry = Number(f.entryPrice);
  const exit = Number(f.exitPrice);
  const ret =
    entry > 0 && f.exitPrice !== "" && exit >= 0 ? (credit ? (entry - exit) / entry : exit / entry - 1) : null;
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
        <h2 className="font-semibold">The position</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Kind of trade">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={f.structure === k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-xl border p-3 text-left ${
                f.structure === k.value ? "border-brand bg-brand-soft" : "border-line bg-white hover:border-brand"
              }`}
            >
              <span className="block text-sm font-semibold text-ink">{k.label}</span>
              <span className="block text-xs text-muted">{k.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 max-w-xs">
          <label className={label} htmlFor="l-u">Ticker</label>
          <input id="l-u" value={f.underlying} onChange={set("underlying")} className={field} autoComplete="off" required />
        </div>

        <div className="mt-4 space-y-3">
          {f.legs.map((leg, i) => (
            <div key={i} className="grid items-end gap-3 rounded-xl bg-paper p-3 sm:grid-cols-[auto_1fr_1fr_1fr_auto]">
              <p className="text-sm font-medium text-muted sm:pb-2.5">{f.legs.length > 1 ? `Leg ${i + 1}` : "Option"}</p>
              {f.structure === "MULTI" ? (
                <div>
                  <label className={label} htmlFor={`l-a${i}`}>Buy or sell</label>
                  <select id={`l-a${i}`} value={leg.action} onChange={setLeg(i, "action")} className={field}>
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                  </select>
                </div>
              ) : (
                <div className="hidden sm:block" />
              )}
              <div>
                <label className={label} htmlFor={`l-r${i}`}>Call or put</label>
                <select
                  id={`l-r${i}`}
                  value={leg.right}
                  onChange={setLeg(i, "right")}
                  disabled={f.structure === "PUT_SELL"}
                  className={field}
                >
                  <option value="C">Call</option>
                  <option value="P">Put</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:col-span-1 sm:grid-cols-1">
                <div>
                  <label className={label} htmlFor={`l-k${i}`}>Strike ($)</label>
                  <input id={`l-k${i}`} inputMode="decimal" value={leg.strike} onChange={setLeg(i, "strike")} className={field} required />
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className={label} htmlFor={`l-x${i}`}>Expiration</label>
                  <input id={`l-x${i}`} type="date" value={leg.expiry} onChange={setLeg(i, "expiry")} className={field} required />
                </div>
                {f.structure === "MULTI" && f.legs.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setF((x) => ({ ...x, legs: x.legs.filter((_, j) => j !== i) }))}
                    className="mb-1 rounded-lg px-2 py-2 text-sm text-muted hover:text-loss"
                    aria-label={`Remove leg ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {f.structure === "MULTI" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setF((x) => ({ ...x, legs: [...x.legs, blankLeg("BUY", x.legs[0]?.right ?? "C", x.legs[0]?.expiry ?? "")] }))}
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-brand hover:border-brand"
              >
                + Add a leg
              </button>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.credit}
                  onChange={(e) => setF((x) => ({ ...x, credit: e.target.checked }))}
                />
                Opened for a net credit
              </label>
            </div>
          )}
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
            <label className={label} htmlFor="l-ep">
              {credit ? "Credit received per contract ($)" : f.structure === "MULTI" ? "Net debit paid per spread ($)" : "Price paid per contract ($)"}
            </label>
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
            <label className={label} htmlFor="l-xp">
              {credit ? "Cost to close per contract ($)" : f.structure === "MULTI" ? "Net received to close ($)" : "Closing price per contract ($)"}
            </label>
            <input id="l-xp" inputMode="decimal" value={f.exitPrice} onChange={set("exitPrice")} className={field} required />
            <p className={hint}>Enter 0 if it expired worthless.</p>
          </div>
          <div className="rounded-xl bg-paper px-4 py-3">
            <p className="text-sm text-muted">Return</p>
            <p className={`num text-2xl font-semibold ${tone(ret)}`}>{signedPct(ret)}</p>
            {credit && <p className={hint}>Share of the credit kept.</p>}
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
