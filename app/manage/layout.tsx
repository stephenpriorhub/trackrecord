import Link from "next/link";
import { getCurrentHubUser } from "@/lib/hub-auth";
import { getManageScope, canManageAnything, isAppLevel } from "@/lib/authz";

export const metadata = { title: "Portfolio Manager" };

/**
 * The gate for every /manage page.
 *
 * A layout is the right place for the coarse "may this person be here at all"
 * check, but it is NOT the only check: each server action re-resolves the scope
 * and each portfolio page verifies that specific portfolio. A layout runs on
 * navigation, not on a direct POST to an action.
 */
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentHubUser();
  const scope = await getManageScope(user);

  if (!user) {
    return (
      <Shell>
        <Notice
          title="Sign in required"
          body="Sign in to OxfordHub, then reload this page."
        />
      </Shell>
    );
  }

  if (!canManageAnything(scope)) {
    return (
      <Shell>
        <Notice
          title="No portfolios assigned to you"
          body={`You're signed in as ${user.email}, but no portfolios have been assigned to your account yet. Ask a portfolio manager to assign you.`}
        />
      </Shell>
    );
  }

  return (
    <Shell
      nav={
        <>
          <Link href="/manage" className="text-gray-300 hover:text-white">
            Portfolios
          </Link>
          {isAppLevel(scope) && (
            <Link href="/manage/settings" className="text-gray-300 hover:text-white">
              People &amp; access
            </Link>
          )}
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-300">
            Track Record
          </Link>
        </>
      }
      who={`${user.name ?? user.email}${
        scope.level === "APP" ? " · portfolio manager" : " · editor"
      }`}
    >
      {children}
    </Shell>
  );
}

function Shell({
  children,
  nav,
  who,
}: {
  children: React.ReactNode;
  nav?: React.ReactNode;
  who?: string;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">Portfolio Manager</h1>
            {who && <span className="text-xs text-gray-500">{who}</span>}
          </div>
          {nav && <nav className="mt-3 flex flex-wrap gap-4 text-sm">{nav}</nav>}
        </header>
        {children}
      </div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-prose text-sm text-gray-400">{body}</p>
    </div>
  );
}
