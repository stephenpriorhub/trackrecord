import Link from "next/link";
import { Inter } from "next/font/google";
import Script from "next/script";
import "../globals.css";
import { getManageContext } from "@/lib/manage-context";
import { canManageAnything, isAppLevel } from "@/lib/authz";

const inter = Inter({ subsets: ["latin"] });

export const metadata = { title: "MTA Portfolios" };

/**
 * Everything behind OxfordHub sign-in: Portfolio Manager (now the front door)
 * and the Airtable-mirrored Track Record.
 *
 * globals.css is imported HERE and not in the root layout, so its
 * `html { visibility: hidden }` auth gate — undone by hub-nav.js once a session
 * is confirmed — applies only to these routes and never to a public embed.
 *
 * This layout only builds the nav. Access is enforced per page, because a layout
 * runs on navigation while these pages are also reachable directly by URL.
 */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const { user, scope } = await getManageContext();
  const canManage = canManageAnything(scope);

  return (
    <div className={`${inter.className} min-h-screen bg-gray-950 text-white`}>
      <Script
        src="https://oxfordhub.app/hub-nav.js"
        data-project-id={process.env.NEXT_PUBLIC_HUB_PROJECT_ID || "mta-track-record"}
        strategy="afterInteractive"
        id="hub-nav"
      />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">MTA Portfolios</h1>
            {user && (
              <span className="text-xs text-gray-500">
                {user.name ?? user.email}
                {scope.level === "APP"
                  ? " · portfolio manager"
                  : scope.level === "ASSIGNED"
                    ? " · editor"
                    : ""}
              </span>
            )}
          </div>
          <nav className="mt-3 flex flex-wrap gap-4 text-sm">
            {canManage && (
              <Link href="/" className="text-gray-300 hover:text-white">
                Portfolios
              </Link>
            )}
            <Link href="/dashboard" className="text-gray-300 hover:text-white">
              Track Record
            </Link>
            {isAppLevel(scope) && (
              <Link href="/settings" className="text-gray-300 hover:text-white">
                People &amp; access
              </Link>
            )}
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}
