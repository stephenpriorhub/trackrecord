/**
 * Who may manage portfolios.
 *
 * Deliberately NOT "any hub admin". Stephen's rule is: super admins, designated
 * portfolio managers, and gurus limited to their own portfolios. A hub `admin`
 * or `exec_admin` gets NO management rights here unless separately designated as
 * an App Manager — they can administer other OxfordHub apps without being able
 * to publish a trade recommendation under a guru's name.
 *
 *   super_admin        -> everything
 *   AppManager (email) -> everything, whatever their hub role
 *   assigned editor    -> only the portfolios granted, via a service-level or
 *                         portfolio-level PortfolioAssignment
 *   anyone else        -> nothing
 *
 * The `guru` hub role is a LABEL, not a grant: it marks someone as an editor so
 * they show up in the assignment picker. Rights come from the assignment row.
 * A guru with no assignment can manage nothing, which is the safe default when
 * the Hub Manager creates the account before anyone has wired up portfolios.
 *
 * ONE RULE FOR CALLERS: never infer permission from the hub role alone. Call
 * canManagePortfolio() / assertCanManagePortfolio() with the portfolio id.
 */
import { prisma } from "./prisma";
import type { HubUser } from "./hub-auth";

export type ManageScope =
  /** super_admin or a designated App Manager: every portfolio, plus app settings. */
  | { level: "APP"; reason: "super_admin" | "app_manager" }
  /** An editor: only the listed portfolios. */
  | { level: "ASSIGNED"; portfolioIds: string[]; serviceIds: string[] }
  | { level: "NONE" };

function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e || null;
}

/**
 * Resolve everything a user may manage, in ONE pair of queries, so a page can
 * render its whole nav without asking per row.
 */
export async function getManageScope(user: HubUser | null): Promise<ManageScope> {
  if (!user) return { level: "NONE" };

  if (user.role === "super_admin") {
    return { level: "APP", reason: "super_admin" };
  }

  const email = normalizeEmail(user.email);
  if (!email) return { level: "NONE" };

  const manager = await prisma.appManager.findUnique({ where: { email } });
  if (manager) return { level: "APP", reason: "app_manager" };

  const assignments = await prisma.portfolioAssignment.findMany({
    where: { email },
    select: { portfolioId: true, serviceId: true },
  });
  if (assignments.length === 0) return { level: "NONE" };

  return {
    level: "ASSIGNED",
    portfolioIds: assignments
      .map((a) => a.portfolioId)
      .filter((id): id is string => !!id),
    serviceIds: assignments
      .map((a) => a.serviceId)
      .filter((id): id is string => !!id),
  };
}

export function isAppLevel(scope: ManageScope): boolean {
  return scope.level === "APP";
}

/** May this user manage anything at all? Gate for showing /manage in the nav. */
export function canManageAnything(scope: ManageScope): boolean {
  return scope.level !== "NONE";
}

/**
 * May this user edit this specific portfolio?
 *
 * A service-level assignment covers portfolios added to that service LATER,
 * which is the point of granting at the service level — Matt McCall gets every
 * McCall Innovation Report portfolio without re-granting each new one.
 */
export async function canManagePortfolio(
  scope: ManageScope,
  portfolioId: string
): Promise<boolean> {
  if (scope.level === "APP") return true;
  if (scope.level === "NONE") return false;

  if (scope.portfolioIds.includes(portfolioId)) return true;
  if (scope.serviceIds.length === 0) return false;

  const portfolio = await prisma.managedPortfolio.findUnique({
    where: { id: portfolioId },
    select: { serviceId: true },
  });
  return !!portfolio && scope.serviceIds.includes(portfolio.serviceId);
}

/** May this user create a portfolio inside this service? */
export async function canManageService(
  scope: ManageScope,
  serviceId: string
): Promise<boolean> {
  if (scope.level === "APP") return true;
  if (scope.level === "NONE") return false;
  return scope.serviceIds.includes(serviceId);
}

/**
 * A Prisma `where` fragment listing the portfolios in scope, for list queries.
 * Returns null for an APP-level scope (meaning "no restriction") and an
 * impossible filter for NONE, so a caller that forgets to branch fails closed.
 */
export function portfolioScopeFilter(
  scope: ManageScope
): { id?: { in: string[] }; serviceId?: { in: string[] }; OR?: unknown[] } | null {
  if (scope.level === "APP") return null;
  if (scope.level === "NONE") return { id: { in: [] } };
  return {
    OR: [
      { id: { in: scope.portfolioIds } },
      { serviceId: { in: scope.serviceIds } },
    ],
  };
}

/**
 * Record an edit. Saves go live immediately, so this log is the only record of
 * who changed what — it is backend-only and never rendered publicly.
 *
 * Deliberately best-effort: a logging failure must not roll back the guru's
 * actual edit. A missing log line is recoverable; losing their work is not.
 */
export async function logChange(opts: {
  action: string;
  entity: string;
  entityId: string;
  portfolioId?: string | null;
  actor: HubUser | null;
  before?: unknown;
  after?: unknown;
  summary?: string;
}): Promise<void> {
  try {
    await prisma.changeLog.create({
      data: {
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        portfolioId: opts.portfolioId ?? null,
        actorEmail: opts.actor?.email ?? null,
        actorName: opts.actor?.name ?? null,
        actorRole: opts.actor?.role ?? null,
        before: (opts.before ?? null) as never,
        after: (opts.after ?? null) as never,
        summary: opts.summary ?? null,
      },
    });
  } catch (err) {
    console.error("[changelog] failed to record", opts.action, opts.entityId, err);
  }
}
