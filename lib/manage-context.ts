/**
 * The caller and what they may manage, for a Portfolio Manager page.
 *
 * Every page under the manager calls this and renders <NoManageAccess/> when the
 * scope is empty. It is deliberately per-page rather than a layout gate: a
 * layout runs on navigation, and these pages are also reachable directly by URL.
 * The per-portfolio check still happens on the portfolio page itself, and every
 * mutation re-resolves scope independently in actions.ts.
 */
import { getCurrentHubUser, type HubUser } from "./hub-auth";
import { getManageScope, type ManageScope } from "./authz";

export interface ManageContext {
  user: HubUser | null;
  scope: ManageScope;
}

export async function getManageContext(): Promise<ManageContext> {
  const user = await getCurrentHubUser();
  return { user, scope: await getManageScope(user) };
}
