/**
 * OxfordHub SSO — identity resolution only. Authorization lives in lib/authz.ts.
 *
 * Mechanism (the standard *.oxfordhub.app pattern): the hub session cookie is
 * scoped to .oxfordhub.app, so the browser sends it to this app's admin host.
 * We forward it server-side to the hub's /api/me to resolve {id,email,name,role}.
 * Reference: mta-sms lib/hub-auth.ts + memory oxfordhub-server-side-auth.
 *
 * WHY THE ADMIN SURFACE IS NOT ON mtachallenge.com: the hub cookie is scoped to
 * .oxfordhub.app and hub /api/me only allows *.oxfordhub.app origins. On the
 * apex the cookie is simply never sent, so SSO cannot work there at all. proxy.ts
 * redirects /admin and /trader to ADMIN_HOST before any page tries to resolve a
 * user — otherwise a trader lands on a "sign in" screen that signing in cannot
 * fix (they sign in on the hub, get a .oxfordhub.app cookie, come back to the
 * apex, and it still isn't sent).
 *
 * Fail-closed: hub unreachable or cookie invalid => no user.
 */
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const PROJECT_ID = process.env.NEXT_PUBLIC_HUB_PROJECT_ID ?? "trackrecord";

const HUB_BASE = process.env.HUB_URL ?? "https://oxfordhub.app";
const HUB_ME_URL = `${HUB_BASE}/api/me?projectId=${encodeURIComponent(PROJECT_ID)}`;

/**
 * `guru` is the OxfordHub role for an editor who maintains their own model
 * portfolios. It is NOT an admin tier — in app-hub it falls through
 * isAdminRole()/roleVisibilityFilter() exactly like `user`, so a guru sees only
 * the apps they are granted. What a guru may EDIT is decided per portfolio in
 * lib/authz.ts, never by this role alone.
 */
export type HubRole = "super_admin" | "exec_admin" | "admin" | "user" | "guru";

export interface HubUser {
  id: string;
  email: string;
  name: string | null;
  role: HubRole;
}

/** Maintenance / server-to-server identity via the shared token. */
function serviceUser(token: string | null): HubUser | null {
  const expected = process.env.HUB_API_TOKEN;
  if (!token || !expected || token !== expected) return null;
  return {
    id: "service",
    email: "service@oxfordhub.app",
    name: "Maintenance Script",
    role: "admin",
  };
}

/**
 * Local-development bypass. Set TRACKRECORD_DEV_AUTH=you@example.com to work
 * without a hub session. Hard-disabled in production — the env var is ignored
 * there, so shipping it by accident cannot open a hole.
 */
function devUser(): HubUser | null {
  if (process.env.NODE_ENV === "production") return null;
  const email = process.env.TRACKRECORD_DEV_AUTH;
  if (!email) return null;
  return { id: `dev:${email}`, email, name: "Dev User", role: "super_admin" };
}

/** Ask the hub who owns this cookie. Returns null on any failure. */
async function resolveFromCookie(cookie: string | null): Promise<HubUser | null> {
  if (!cookie) return null;
  try {
    const res = await fetch(HUB_ME_URL, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      authenticated?: boolean;
      authorized?: boolean;
      user?: HubUser;
    };
    return data.authenticated && data.authorized && data.user ? data.user : null;
  } catch {
    return null;
  }
}

/** Resolve the requesting user in a route handler. */
export async function getHubUser(req: NextRequest): Promise<HubUser | null> {
  return (
    serviceUser(req.headers.get("x-hub-token")) ??
    devUser() ??
    (await resolveFromCookie(req.headers.get("cookie")))
  );
}

/**
 * Resolve the current user in a SERVER COMPONENT (no NextRequest available).
 * Server components cannot see x-hub-token, which is correct — that token is
 * for machine callers hitting API routes, not for rendering pages.
 */
export async function getCurrentHubUser(): Promise<HubUser | null> {
  const dev = devUser();
  if (dev) return dev;
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return resolveFromCookie(cookie || null);
}

/**
 * PROJECT-LEVEL gate. A non-null user here means the hub already returned
 * authenticated && authorized for projectId `trackrecord` — the caller holds a
 * grant to this app. That grant is what lets someone READ the track record.
 *
 * *** NECESSARY BUT NOT SUFFICIENT for Portfolio Manager. ***
 * Managing portfolios is a separate, narrower question answered only by
 * lib/authz.ts: super_admin, a designated App Manager, or a guru assigned to
 * that specific portfolio. Deliberately NOT every hub admin. Narrow at the CALL
 * SITE — never widen this function.
 */
export function isAuthorizedHubUser(user: HubUser | null): boolean {
  return !!user;
}

/**
 * HUB admin tier. Note this is NOT the Portfolio Manager permission — see
 * lib/authz.ts, where `admin` and `exec_admin` get no management rights unless
 * they are separately designated. This is only for app-wide administration
 * (designating App Managers, running the Airtable import).
 */
export function isHubAdmin(user: HubUser | null): boolean {
  return (
    !!user &&
    (user.role === "super_admin" ||
      user.role === "exec_admin" ||
      user.role === "admin")
  );
}

export function unauthorized(
  message = "Sign in to OxfordHub to continue."
): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(
  message = "Your OxfordHub account does not have access to this app."
): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** Ownership and existence failures share this response, so a probe cannot
 * distinguish "not yours" from "does not exist". See lib/authz.ts. */
export function notFound(message = "Not found."): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}
