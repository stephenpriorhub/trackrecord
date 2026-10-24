/**
 * Who is looking at a signed-in track-record page, and what they may change.
 *
 * Viewing needs an OxfordHub grant to this app (the hub row is exec-only).
 * Changing settings (public links) and logging trades additionally needs
 * Portfolio-Manager app level (super_admin or a designated App Manager) or
 * exec_admin. Every server action re-checks this itself.
 */
import { redirect } from "next/navigation";
import { getCurrentHubUser, type HubUser } from "../hub-auth";
import { getManageScope, isAppLevel } from "../authz";

export interface Viewer {
  user: HubUser;
  canAdmin: boolean;
  /**
   * May log and edit trades (written into the sheets). Stephen, 2026-10-24:
   * "Admins and specified admins (kristin and jmead)" — hub admins plus the
   * app's designated App Managers (People & access).
   */
  canLog: boolean;
}

const SIGN_IN = "https://oxfordhub.app/login";

export async function currentViewer(): Promise<Viewer | null> {
  const user = await getCurrentHubUser();
  if (!user) return null;
  const scope = await getManageScope(user);
  const appLevel = isAppLevel(scope);
  const hubAdmin = user.role === "super_admin" || user.role === "exec_admin" || user.role === "admin";
  return { user, canAdmin: appLevel || hubAdmin, canLog: appLevel || hubAdmin };
}

/** For pages: the viewer, or a redirect to OxfordHub sign-in. */
export async function requireViewer(): Promise<Viewer> {
  const v = await currentViewer();
  if (!v) redirect(SIGN_IN);
  return v;
}

/** For the trade-logging action. Throws for anyone not allowed to log. */
export async function requireLogger(): Promise<Viewer> {
  const v = await currentViewer();
  if (!v?.canLog) throw new Error("Only admins and the app's designated managers can add or edit trades.");
  return v;
}

/** For server actions: throws instead of redirecting. */
export async function requireAdmin(): Promise<Viewer> {
  const v = await currentViewer();
  if (!v?.canAdmin) throw new Error("You don't have permission to change track-record settings.");
  return v;
}
