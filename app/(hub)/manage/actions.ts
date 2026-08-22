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
import { createPosition, closePosition, type LegInput } from "@/lib/managed/positions";
import { parseDecimal, type D } from "@/lib/money";

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

// ---------------------------------------------------------------- positions

/**
 * Parse a money field a guru typed. Accepts "$12.50", "12.50", "1,250".
 * Returns null for blank so an optional field stays unset.
 */
function money(v: FormDataEntryValue | null): D | null {
  return parseDecimal(str(v));
}

/** A date field. Blank means today, so the fast path is one less decision. */
function date(v: FormDataEntryValue | null): Date {
  const s = str(v);
  if (!s) return new Date();
  // A bare YYYY-MM-DD is read as UTC midnight, matching how dates are stored and
  // rendered. Reading it as local time shifts a US afternoon entry to the day before.
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Read the leg rows out of the form. The simple path submits no leg fields at
 * all and gets one stock leg; the options path submits legKind/legSide/... as
 * parallel arrays, one entry per leg.
 */
function readLegs(form: FormData): LegInput[] {
  const kinds = form.getAll("legKind").map((v) => str(v));
  if (kinds.length === 0) {
    const price = money(form.get("entryPrice"));
    if (!price) throw new Error("Enter an entry price.");
    return [{ kind: "STOCK", side: "BUY", price }];
  }

  const sides = form.getAll("legSide").map((v) => str(v));
  const prices = form.getAll("legPrice").map((v) => str(v));
  const expiries = form.getAll("legExpiry").map((v) => str(v));
  const strikes = form.getAll("legStrike").map((v) => str(v));
  const rights = form.getAll("legRight").map((v) => str(v));
  const ratios = form.getAll("legRatio").map((v) => str(v));

  const legs: LegInput[] = [];
  for (let i = 0; i < kinds.length; i += 1) {
    // A blank price marks an unused leg row the form rendered but nobody filled.
    const price = parseDecimal(prices[i]);
    if (!price) continue;
    const kind = kinds[i] === "OPTION" ? "OPTION" : "STOCK";
    legs.push({
      kind,
      side: sides[i] === "SELL" ? "SELL" : "BUY",
      price,
      ratio: Math.max(1, parseInt(ratios[i] || "1", 10) || 1),
      ...(kind === "OPTION"
        ? {
            expiry: expiries[i] || undefined,
            strike: parseDecimal(strikes[i]) ?? undefined,
            right: rights[i] === "PUT" ? ("PUT" as const) : ("CALL" as const),
          }
        : {}),
    });
  }
  if (legs.length === 0) throw new Error("Enter at least one entry price.");
  return legs;
}

export async function createPositionAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const portfolioId = str(form.get("portfolioId"));
  if (!portfolioId) return { ok: false, error: "Missing portfolio." };
  if (!(await canManagePortfolio(scope, portfolioId))) return DENIED;

  try {
    const position = await createPosition({
      portfolioId,
      underlying: str(form.get("underlying")),
      companyName: str(form.get("companyName")) || null,
      openedAt: date(form.get("openedAt")),
      legs: readLegs(form),
      buyUpToPrice: money(form.get("buyUpToPrice")),
      stopLossPrice: money(form.get("stopLossPrice")),
      targetPrice: money(form.get("targetPrice")),
      comment: str(form.get("comment")) || null,
      actorEmail: user?.email ?? null,
      actorName: user?.name ?? null,
    });

    await logChange({
      action: "position.create",
      entity: "ManagedPosition",
      entityId: position.id,
      portfolioId,
      actor: user,
      after: { label: position.label, openedAt: position.openedAt },
    });

    revalidatePath(`/manage/${portfolioId}`);
    return { ok: true, message: `Added ${position.label}.` };
  } catch (err) {
    // Surface the library's own message: they are written for a guru to read
    // ("Enter an entry price", "only 1 is open"), not for a developer.
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function closePositionAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const positionId = str(form.get("positionId"));
  if (!positionId) return { ok: false, error: "Missing position." };

  const position = await prisma.managedPosition.findUnique({
    where: { id: positionId },
    select: { portfolioId: true, label: true, legs: { select: { id: true } } },
  });
  if (!position) return { ok: false, error: "Position not found." };
  if (!(await canManagePortfolio(scope, position.portfolioId))) return DENIED;

  // Prices and quantities arrive as legPrice_<legId> so a multi-leg close can
  // carry a different price per leg in one submit.
  const prices: Record<string, D> = {};
  const quantities: Record<string, number> = {};
  for (const leg of position.legs) {
    const p = parseDecimal(str(form.get(`legPrice_${leg.id}`)));
    if (!p) continue;
    prices[leg.id] = p;
    const q = parseInt(str(form.get(`legQty_${leg.id}`)) || "", 10);
    if (Number.isFinite(q) && q > 0) quantities[leg.id] = q;
  }

  try {
    await closePosition({
      positionId,
      executedAt: date(form.get("closedAt")),
      prices,
      quantities,
      comment: str(form.get("comment")) || null,
      actorEmail: user?.email ?? null,
      actorName: user?.name ?? null,
    });

    const after = await prisma.managedPosition.findUnique({
      where: { id: positionId },
      select: { status: true },
    });

    await logChange({
      action: "position.close",
      entity: "ManagedPosition",
      entityId: positionId,
      portfolioId: position.portfolioId,
      actor: user,
      after: { status: after?.status },
      summary: Object.entries(quantities).length ? "Partial exit" : undefined,
    });

    revalidatePath(`/manage/${position.portfolioId}`);
    return {
      ok: true,
      message: after?.status === "CLOSED" ? "Position closed." : "Partial exit recorded.",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not close." };
  }
}

export async function addCommentAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const positionId = str(form.get("positionId"));
  const body = str(form.get("body"));
  if (!positionId || !body) return { ok: false, error: "Write a comment first." };

  const position = await prisma.managedPosition.findUnique({
    where: { id: positionId },
    select: { portfolioId: true },
  });
  if (!position) return { ok: false, error: "Position not found." };
  if (!(await canManagePortfolio(scope, position.portfolioId))) return DENIED;

  const comment = await prisma.managedComment.create({
    data: {
      positionId,
      body,
      authorEmail: user?.email ?? null,
      authorName: user?.name ?? null,
    },
  });

  await logChange({
    action: "comment.create",
    entity: "ManagedComment",
    entityId: comment.id,
    portfolioId: position.portfolioId,
    actor: user,
    after: { body },
  });

  revalidatePath(`/manage/${position.portfolioId}`);
  return { ok: true, message: "Comment added." };
}

/**
 * Soft-delete a position. Nothing is hard-deleted: a position may already be on
 * a public page and the change log has to keep pointing at something.
 */
export async function deletePositionAction(form: FormData): Promise<ActionResult> {
  const { user, scope } = await actor();
  const positionId = str(form.get("positionId"));
  if (!positionId) return { ok: false, error: "Missing position." };

  const position = await prisma.managedPosition.findUnique({
    where: { id: positionId },
    select: { portfolioId: true, label: true, deletedAt: true },
  });
  if (!position) return { ok: false, error: "Position not found." };
  if (!(await canManagePortfolio(scope, position.portfolioId))) return DENIED;

  const restore = str(form.get("restore")) === "1";
  await prisma.managedPosition.update({
    where: { id: positionId },
    data: { deletedAt: restore ? null : new Date(), updatedByEmail: user?.email ?? null },
  });

  await logChange({
    action: restore ? "position.restore" : "position.delete",
    entity: "ManagedPosition",
    entityId: positionId,
    portfolioId: position.portfolioId,
    actor: user,
    before: { label: position.label, deletedAt: position.deletedAt },
  });

  revalidatePath(`/manage/${position.portfolioId}`);
  return { ok: true, message: restore ? "Restored." : `Removed ${position.label}.` };
}
