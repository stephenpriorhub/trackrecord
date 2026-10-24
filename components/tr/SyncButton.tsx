"use client";

import { useState, useTransition } from "react";
import { syncNow } from "@/app/(tr)/actions";

export function SyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-sm text-muted">{msg}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            try {
              const r = await syncNow();
              const bad = r.filter((x) => !x.ok);
              setMsg(bad.length ? `Failed: ${bad.map((b) => b.code).join(", ")}` : "All sheets synced.");
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Sync failed.");
            }
          })
        }
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync sheets now"}
      </button>
    </div>
  );
}
