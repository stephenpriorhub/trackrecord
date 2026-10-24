"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

interface Option {
  value: string;
  label: string;
}

/**
 * Filters for the trade list. Submits as plain query parameters, so every
 * filtered view is a link someone can bookmark or send.
 */
export function TradeFilters({
  basePath,
  portfolios,
  gurus,
  types,
  sorts,
  showAirtable,
}: {
  basePath: string;
  portfolios: Option[];
  gurus: string[];
  types: Option[];
  sorts: Option[];
  showAirtable: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [more, setMore] = useState(
    ["openedFrom", "openedTo", "closedFrom", "closedTo", "airtable"].some((k) => sp.get(k)),
  );

  function submit(form: HTMLFormElement) {
    const next = new URLSearchParams();
    // Keep the non-filter state of the page (breakdown period).
    const bp = sp.get("bp");
    if (bp) next.set("bp", bp);
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === "string" && v.trim()) next.set(k, v.trim());
    }
    const qs = next.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}#trades`, { scroll: false });
  }

  const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";
  const label = "mb-1 block text-xs font-medium text-muted";
  const v = (k: string) => sp.get(k) ?? "";

  return (
    <form
      key={sp.toString()}
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="rounded-xl border border-line bg-paper p-4"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <div className="col-span-2">
          <label className={label} htmlFor="f-q">Ticker</label>
          <input id="f-q" name="q" defaultValue={v("q")} placeholder="Search by ticker" className={field} />
        </div>
        {portfolios.length > 1 && (
          <div>
            <label className={label} htmlFor="f-p">Portfolio</label>
            <select id="f-p" name="portfolio" defaultValue={v("portfolio")} className={field}>
              <option value="">All</option>
              {portfolios.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        )}
        {gurus.length > 1 && (
          <div>
            <label className={label} htmlFor="f-g">Editor</label>
            <select id="f-g" name="guru" defaultValue={v("guru")} className={field}>
              <option value="">All</option>
              {gurus.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className={label} htmlFor="f-t">Trade type</label>
          <select id="f-t" name="type" defaultValue={v("type")} className={field}>
            <option value="">All</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="f-r">Result</label>
          <select id="f-r" name="result" defaultValue={v("result")} className={field}>
            <option value="">All</option>
            <option value="win">Winners</option>
            <option value="loss">Not winners</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="f-s">Sort by</label>
          <select id="f-s" name="sort" defaultValue={v("sort")} className={field}>
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="f-d">Order</label>
          <select id="f-d" name="dir" defaultValue={v("dir")} className={field}>
            <option value="">Newest / highest first</option>
            <option value="asc">Oldest / lowest first</option>
          </select>
        </div>
      </div>

      {more && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <div>
            <label className={label} htmlFor="f-of">Opened from</label>
            <input id="f-of" type="date" name="openedFrom" defaultValue={v("openedFrom")} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="f-ot">Opened to</label>
            <input id="f-ot" type="date" name="openedTo" defaultValue={v("openedTo")} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="f-cf">Closed from</label>
            <input id="f-cf" type="date" name="closedFrom" defaultValue={v("closedFrom")} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="f-ct">Closed to</label>
            <input id="f-ct" type="date" name="closedTo" defaultValue={v("closedTo")} className={field} />
          </div>
          {showAirtable && (
            <div className="col-span-2">
              <label className={label} htmlFor="f-a">Airtable</label>
              <select id="f-a" name="airtable" defaultValue={v("airtable")} className={field}>
                <option value="">All trades</option>
                <option value="missing">Not found in Airtable</option>
                <option value="matched">Found in Airtable</option>
              </select>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          Apply filters
        </button>
        <button
          type="button"
          onClick={() => router.push(`${basePath}${sp.get("bp") ? `?bp=${sp.get("bp")}` : ""}#trades`, { scroll: false })}
          className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink"
        >
          Clear
        </button>
        <button type="button" onClick={() => setMore((m) => !m)} className="ml-auto text-sm text-brand hover:underline">
          {more ? "Fewer filters" : "Date ranges & more filters"}
        </button>
      </div>
    </form>
  );
}
