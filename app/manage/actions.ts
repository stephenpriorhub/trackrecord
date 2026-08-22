"use server";

/**
 * Mutations for Portfolio Manager.
 *
 * EVERY export here starts by resolving the hub user and its manage scope, and
 * refuses before touching Prisma. Server actions are POST endpoints reachable by
 * anyone who can guess them — the fact that the calling page rendered a form is
 * NOT authorization. There is no shared middleware doing this; the check is
 * colocated on purpose so a new action cannot inherit a permissive default by
 * forgetting to opt in.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentHubUser, isHubAdmin, type HubUser } from "@/lib/hub-auth";
import {
  getManageScope,
  canManagePortfolio,
  canManageService,
  isAppLevel,
  logChange,
  type ManageScope,
} from "@/lib/authz";
import { createPortfolio, ensureService } from "@/lib/managed/portfolios";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const DENIED: ActionResult = {
  ok: false,
  error: "You do not have permission to manage this portfolio.",
};

/** Resolve caller + scope once per action. */
async function actor(): Promise<{ user: HubUser | null; scope: ManageScope }> {
  const user = await getCurrentHubUser();
  return { user, scope: await getManageScope(user) };
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

// --------------------------------------------------------------- portfolios

export async function createPortfolioAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const serviceId = str(form.get("serviceId"));
  const name = str(form.get("name"));

  if (!serviceId || !name) return { ok: false, error: "Pick a service and enter a name." };
  if (!(await canManageService(scope, serviceId))) return DENIED;

  const portfolio = await createPortfolio({
    serviceId,
    name,
    description: str(form.get("description")) || null,
    benchmarkTicker: str(form.get("benchmarkTicker")) || "SPY",
    createdByEmail: user?.email ?? null,
  });

  await logChange({
    action: "portfolio.create",
    entity: "ManagedPortfolio",
    entityId: portfolio.id,
    portfolioId: portfolio.id,
    actor: user,
    after: { name: portfolio.name, slug: portfolio.slug },
  });

  revalidatePath("/manage");
  return { ok: true, message: `Created "${portfolio.name}".` };
}

export async function updatePortfolioAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const id = str(form.get("portfolioId"));
  if (!id) return { ok: false, error: "Missing portfolio." };
  if (!(await canManagePortfolio(scope, id))) return DENIED;

  const before = await prisma.managedPortfolio.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Portfolio not found." };

  const name = str(form.get("name")) || before.name;
  const benchmarkTicker = (str(form.get("benchmarkTicker")) || before.benchmarkTicker).toUpperCase();
  const description = str(form.get("description")) || null;
  const visibility = str(form.get("visibility")) === "PUBLIC" ? "PUBLIC" : "PRIVATE";

  const after = await prisma.managedPortfolio.update({
    where: { id },
    data: { name, benchmarkTicker, description, visibility },
  });

  await logChange({
    action: "portfolio.update",
    entity: "ManagedPortfolio",
    entityId: id,
    portfolioId: id,
    actor: user,
    before: {
      name: before.name,
      benchmarkTicker: before.benchmarkTicker,
      visibility: before.visibility,
      description: before.description,
    },
    after: {
      name: after.name,
      benchmarkTicker: after.benchmarkTicker,
      visibility: after.visibility,
      description: after.description,
    },
    // The slug is deliberately absent above: it is the public embed key and is
    // never changed by a rename, so a live iframe cannot break.
    summary: before.name !== after.name ? `Renamed from "${before.name}"` : undefined,
  });

  revalidatePath("/manage");
  revalidatePath(`/manage/${id}`);
  return { ok: true, message: "Saved." };
}

/**
 * Archive rather than delete. A portfolio may already be embedded on a live
 * page and its positions are a published record; archiving hides it from the
 * manager and 404s the embed while keeping every row recoverable.
 */
export async function archivePortfolioAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const id = str(form.get("portfolioId"));
  if (!id) return { ok: false, error: "Missing portfolio." };
  if (!(await canManagePortfolio(scope, id))) return DENIED;

  const before = await prisma.managedPortfolio.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Portfolio not found." };

  const restore = str(form.get("restore")) === "1";
  await prisma.managedPortfolio.update({
    where: { id },
    data: { archivedAt: restore ? null : new Date() },
  });

  await logChange({
    action: restore ? "portfolio.restore" : "portfolio.archive",
    entity: "ManagedPortfolio",
    entityId: id,
    portfolioId: id,
    actor: user,
    before: { archivedAt: before.archivedAt },
  });

  revalidatePath("/manage");
  return { ok: true, message: restore ? "Restored." : `Archived "${before.name}".` };
}

export async function reorderPortfolioAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const id = str(form.get("portfolioId"));
  const dir = str(form.get("direction")) === "up" ? -1 : 1;
  if (!id) return { ok: false, error: "Missing portfolio." };
  if (!(await canManagePortfolio(scope, id))) return DENIED;

  const target = await prisma.managedPortfolio.findUnique({ where: { id } });
  if (!target) return { ok: false, error: "Portfolio not found." };

  const siblings = await prisma.managedPortfolio.findMany({
    where: { serviceId: target.serviceId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const at = siblings.findIndex((s) => s.id === id);
  const swapWith = siblings[at + dir];
  if (!swapWith) return { ok: true }; // already at the end; nothing to do

  // Rewrite the whole run's sortOrder rather than swapping two values: seeded
  // rows can share a sortOrder, and swapping equal numbers is a no-op that
  // looks like a broken button.
  const reordered = [...siblings];
  reordered[at] = swapWith;
  reordered[at + dir] = target;
  await prisma.$transaction(
    reordered.map((p, i) =>
      prisma.managedPortfolio.update({ where: { id: p.id }, data: { sortOrder: i } })
    )
  );

  await logChange({
    action: "portfolio.reorder",
    entity: "ManagedPortfolio",
    entityId: id,
    portfolioId: id,
    actor: user,
  });

  revalidatePath("/manage");
  return { ok: true };
}

// ----------------------------------------------------------------- services

export async function createServiceAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  // Creating a whole publication is an app-level act, not something an assigned
  // editor may do.
  if (!isAppLevel(scope)) return DENIED;

  const pubCode = str(form.get("pubCode")).toUpperCase();
  const name = str(form.get("name"));
  if (!pubCode || !name) return { ok: false, error: "Enter a pub code and a name." };

  const service = await ensureService(pubCode, { name });
  await logChange({
    action: "service.create",
    entity: "Service",
    entityId: service.id,
    actor: user,
    after: { pubCode: service.pubCode, name: service.name },
  });

  revalidatePath("/manage");
  return { ok: true, message: `Created "${service.name}".` };
}

// -------------------------------------------------------------- permissions

/**
 * Designating who may manage things is app-level, and additionally requires hub
 * admin — an App Manager can run portfolios but cannot appoint more managers,
 * so the permission set cannot be widened from inside the app.
 */
export async function grantAppManagerAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  if (!isAppLevel(scope) || !isHubAdmin(user)) {
    return { ok: false, error: "Only a hub admin can designate portfolio managers." };
  }

  const email = str(form.get("email")).toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };

  const created = await prisma.appManager.upsert({
    where: { email },
    update: { name: str(form.get("name")) || undefined },
    create: {
      email,
      name: str(form.get("name")) || null,
      createdByEmail: user?.email ?? null,
    },
  });

  await logChange({
    action: "appManager.grant",
    entity: "AppManager",
    entityId: created.id,
    actor: user,
    after: { email },
  });

  revalidatePath("/manage/settings");
  return { ok: true, message: `${email} can now manage every portfolio.` };
}

export async function revokeAppManagerAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  if (!isAppLevel(scope) || !isHubAdmin(user)) {
    return { ok: false, error: "Only a hub admin can change portfolio managers." };
  }
  const id = str(form.get("id"));
  if (!id) return { ok: false, error: "Missing record." };

  const before = await prisma.appManager.findUnique({ where: { id } });
  if (!before) return { ok: true };

  await prisma.appManager.delete({ where: { id } });
  await logChange({
    action: "appManager.revoke",
    entity: "AppManager",
    entityId: id,
    actor: user,
    before: { email: before.email },
  });

  revalidatePath("/manage/settings");
  return { ok: true, message: `Removed ${before.email}.` };
}

/**
 * Assign an editor to a service (all its portfolios, including future ones) or
 * to a single portfolio. App-level scope required — an editor cannot widen their
 * own grant or hand it to someone else.
 */
export async function assignEditorAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  if (!isAppLevel(scope)) return DENIED;

  const email = str(form.get("email")).toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };

  const serviceId = str(form.get("serviceId")) || null;
  const portfolioId = str(form.get("portfolioId")) || null;
  if (!serviceId === !portfolioId) {
    return { ok: false, error: "Choose either a whole service or one portfolio." };
  }

  const existing = await prisma.portfolioAssignment.findFirst({
    where: { email, serviceId, portfolioId },
  });
  if (existing) return { ok: true, message: "Already assigned." };

  const created = await prisma.portfolioAssignment.create({
    data: {
      email,
      name: str(form.get("name")) || null,
      serviceId,
      portfolioId,
      createdByEmail: user?.email ?? null,
    },
  });

  await logChange({
    action: "assignment.grant",
    entity: "PortfolioAssignment",
    entityId: created.id,
    portfolioId,
    actor: user,
    after: { email, serviceId, portfolioId },
  });

  revalidatePath("/manage/settings");
  return { ok: true, message: `${email} can now edit ${serviceId ? "this service" : "this portfolio"}.` };
}

export async function unassignEditorAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  if (!isAppLevel(scope)) return DENIED;

  const id = str(form.get("id"));
  if (!id) return { ok: false, error: "Missing record." };

  const before = await prisma.portfolioAssignment.findUnique({ where: { id } });
  if (!before) return { ok: true };

  await prisma.portfolioAssignment.delete({ where: { id } });
  await logChange({
    action: "assignment.revoke",
    entity: "PortfolioAssignment",
    entityId: id,
    portfolioId: before.portfolioId,
    actor: user,
    before: { email: before.email, serviceId: before.serviceId, portfolioId: before.portfolioId },
  });

  revalidatePath("/manage/settings");
  return { ok: true, message: `Removed ${before.email}.` };
}
