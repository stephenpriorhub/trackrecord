"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateNow, saveRecipients } from "./actions";

const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60";
const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";

export function GenerateButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {err && <span className="text-sm text-red-600">{err}</span>}
      <button
        type="button"
        disabled={pending}
        className={btn}
        onClick={() =>
          start(async () => {
            setErr(null);
            try {
              router.push(`/report/${await generateNow()}`);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Couldn't make the draft.");
            }
          })
        }
      >
        {pending ? "Building…" : label}
      </button>
    </div>
  );
}

export function RecipientsForm({ to, cc, updatedBy }: { to: string[]; cc: string[]; updatedBy: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setMsg(null);
          try {
            const { bad } = await saveRecipients(String(fd.get("to") ?? ""), String(fd.get("cc") ?? ""));
            setMsg(bad.length ? `Saved. Skipped (not an email address): ${bad.join("; ")}` : "Saved.");
            router.refresh();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Couldn't save.");
          }
        });
      }}
    >
      <div>
        <label htmlFor="r-to" className="mb-1 block text-xs font-medium text-muted">To ({to.length})</label>
        <textarea id="r-to" name="to" rows={5} defaultValue={to.join("\n")} className={field} />
      </div>
      <div>
        <label htmlFor="r-cc" className="mb-1 block text-xs font-medium text-muted">Cc ({cc.length})</label>
        <textarea id="r-cc" name="cc" rows={5} defaultValue={cc.join("\n")} className={field} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>{pending ? "Saving…" : "Save recipients"}</button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
        {!msg && updatedBy && <span className="text-xs text-faint">Last changed by {updatedBy}</span>}
      </div>
    </form>
  );
}
