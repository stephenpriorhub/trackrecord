"use client";

/**
 * A form that posts to a server action and shows what happened.
 *
 * Gurus are the primary users here and several are not technical, so a save must
 * never fail silently: every submit ends in a visible confirmation or a plain
 * error sentence, and the button disables itself while in flight so a
 * double-click cannot create two portfolios.
 */
import { useActionState } from "react";
import type { ActionResult } from "./actions";

type Props = {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  /** Shown as a browser confirm() before submitting — for archive/remove. */
  confirm?: string;
  className?: string;
  variant?: "primary" | "quiet" | "danger";
  /** Hide the inline result and rely on the page updating (for reorder arrows). */
  silent?: boolean;
};

const VARIANTS: Record<string, string> = {
  primary: "bg-blue-600 hover:bg-blue-500 text-white",
  quiet: "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700",
  danger:
    "bg-red-900/60 hover:bg-red-900 text-red-200 border border-red-800/60",
};

export default function ActionForm({
  action,
  children,
  submitLabel,
  confirm,
  className,
  variant = "primary",
  silent,
}: Props) {
  const [result, submit, pending] = useActionState(
    async (_prev: ActionResult | null, form: FormData) => action(form),
    null,
  );

  return (
    <form
      action={submit}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${VARIANTS[variant]}`}
      >
        {pending ? "Saving…" : submitLabel}
      </button>
      {!silent && result && (
        <p
          className={`mt-2 text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}
          role="status"
        >
          {result.ok ? (result.message ?? "Saved.") : result.error}
        </p>
      )}
    </form>
  );
}
