import type { HubUser } from "@/lib/hub-auth";

/** Shown when someone reaches a manager page without rights. */
export default function NoManageAccess({ user }: { user: HubUser | null }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="font-semibold text-white">
        {user ? "No portfolios assigned to you" : "Sign in required"}
      </h2>
      <p className="mt-2 max-w-prose text-sm text-gray-400">
        {user
          ? `You're signed in as ${user.email}, but no portfolios have been assigned to your account yet. Ask a portfolio manager to assign you.`
          : "Sign in to OxfordHub, then reload this page."}
      </p>
    </div>
  );
}
