/**
 * Permission tests for Portfolio Manager.
 *
 * Two kinds of check, because they catch different failures:
 *
 *  1. BEHAVIOUR — resolve real scopes against a real database and assert who can
 *     touch what. Notably that a hub `admin` with no grant is refused: the rule
 *     is "super admins, designated managers and assigned editors", and an admin
 *     is none of those by default. It is the assertion most likely to be
 *     "helpfully" relaxed by a future change.
 *
 *  2. STATIC — every exported server action must contain an authorization call.
 *     A new action added without a gate is a silent hole that no behavioural
 *     test would notice, because the test would have to know the action exists.
 *
 * Run: npm run test:authz   (uses .env — a LOCAL throwaway Postgres)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  getManageScope,
  canManagePortfolio,
  canManageService,
  isAppLevel,
  canManageAnything,
  portfolioScopeFilter,
} from "../lib/authz";
import type { HubUser } from "../lib/hub-auth";

const prisma = new PrismaClient();
const TAG = `authztest-${Date.now()}`;
let failures = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failures += 1;
      console.error(`  ✗ ${name}\n    ${err.message}`);
    });
}

function user(role: HubUser["role"], email: string): HubUser {
  return { id: `test:${email}`, email, name: email, role };
}

async function main() {
  // ---------------------------------------------------------------- fixtures
  const service = await prisma.service.create({
    data: { pubCode: `T-${TAG}`, name: `Test Service ${TAG}`, slug: `svc-${TAG}` },
  });
  const other = await prisma.service.create({
    data: { pubCode: `O-${TAG}`, name: `Other Service ${TAG}`, slug: `oth-${TAG}` },
  });
  const pA = await prisma.managedPortfolio.create({
    data: { serviceId: service.id, name: `A ${TAG}`, slug: `a-${TAG}` },
  });
  const pB = await prisma.managedPortfolio.create({
    data: { serviceId: service.id, name: `B ${TAG}`, slug: `b-${TAG}` },
  });
  const pOther = await prisma.managedPortfolio.create({
    data: { serviceId: other.id, name: `C ${TAG}`, slug: `c-${TAG}` },
  });

  const managerEmail = `manager-${TAG}@example.com`;
  const serviceGuruEmail = `serviceguru-${TAG}@example.com`;
  const oneBookGuruEmail = `onebook-${TAG}@example.com`;

  await prisma.appManager.create({ data: { email: managerEmail } });
  await prisma.portfolioAssignment.create({
    data: { email: serviceGuruEmail, serviceId: service.id },
  });
  await prisma.portfolioAssignment.create({
    data: { email: oneBookGuruEmail, portfolioId: pA.id },
  });

  console.log("\nbehaviour");

  await check("anonymous can manage nothing", async () => {
    const s = await getManageScope(null);
    assert.equal(s.level, "NONE");
    assert.equal(canManageAnything(s), false);
    assert.equal(await canManagePortfolio(s, pA.id), false);
  });

  await check("super_admin manages everything", async () => {
    const s = await getManageScope(user("super_admin", `sa-${TAG}@example.com`));
    assert.equal(s.level, "APP");
    assert.ok(isAppLevel(s));
    assert.equal(await canManagePortfolio(s, pOther.id), true);
    assert.equal(portfolioScopeFilter(s), null, "app scope means no row restriction");
  });

  // THE load-bearing assertion. Hub admins administer other OxfordHub apps; that
  // must not let them publish trade recommendations under a guru's name.
  for (const role of ["admin", "exec_admin", "user", "guru"] as const) {
    await check(`hub ${role} with no grant is refused`, async () => {
      const s = await getManageScope(user(role, `${role}-${TAG}@example.com`));
      assert.equal(s.level, "NONE", `${role} should have no scope without a grant`);
      assert.equal(await canManagePortfolio(s, pA.id), false);
      assert.equal(await canManageService(s, service.id), false);
    });
  }

  await check("designated App Manager manages everything despite role 'user'", async () => {
    const s = await getManageScope(user("user", managerEmail));
    assert.equal(s.level, "APP");
    assert.equal(await canManagePortfolio(s, pOther.id), true);
  });

  await check("App Manager lookup is case-insensitive on email", async () => {
    const s = await getManageScope(user("user", managerEmail.toUpperCase()));
    assert.equal(s.level, "APP", "hub may return a differently-cased email");
  });

  await check("service-level editor gets every portfolio in that service only", async () => {
    const s = await getManageScope(user("guru", serviceGuruEmail));
    assert.equal(s.level, "ASSIGNED");
    assert.equal(await canManagePortfolio(s, pA.id), true);
    assert.equal(await canManagePortfolio(s, pB.id), true);
    assert.equal(await canManagePortfolio(s, pOther.id), false);
    assert.equal(await canManageService(s, service.id), true);
    assert.equal(await canManageService(s, other.id), false);
  });

  await check("service-level editor also gets portfolios added later", async () => {
    const s = await getManageScope(user("guru", serviceGuruEmail));
    const added = await prisma.managedPortfolio.create({
      data: { serviceId: service.id, name: `Later ${TAG}`, slug: `later-${TAG}` },
    });
    assert.equal(await canManagePortfolio(s, added.id), true);
  });

  await check("portfolio-level editor is confined to that one portfolio", async () => {
    const s = await getManageScope(user("guru", oneBookGuruEmail));
    assert.equal(s.level, "ASSIGNED");
    assert.equal(await canManagePortfolio(s, pA.id), true);
    assert.equal(await canManagePortfolio(s, pB.id), false, "same service, not granted");
    assert.equal(
      await canManageService(s, service.id),
      false,
      "a single-portfolio grant must not allow creating more portfolios"
    );
  });

  await check("an unknown portfolio id is refused, not allowed", async () => {
    const s = await getManageScope(user("guru", serviceGuruEmail));
    assert.equal(await canManagePortfolio(s, "does-not-exist"), false);
  });

  await check("NONE scope produces a filter that matches no rows", async () => {
    const s = await getManageScope(user("user", `nobody-${TAG}@example.com`));
    const filter = portfolioScopeFilter(s);
    assert.deepEqual(filter, { id: { in: [] } }, "must fail closed, not open");
  });

  // ------------------------------------------------------------------ static
  console.log("\nstatic");

  await check("every exported server action authorizes before mutating", () => {
    const src = readFileSync(new URL("../app/(hub)/manage/actions.ts", import.meta.url), "utf8");
    assert.ok(src.startsWith('"use server"'), "actions.ts must be a server module");

    const exported = [...src.matchAll(/export async function (\w+)\s*\(/g)].map((m) => m[1]);
    assert.ok(exported.length > 0, "found no exported actions — did the file move?");

    const GATES = ["canManagePortfolio", "canManageService", "isAppLevel", "isHubAdmin"];
    const ungated: string[] = [];

    for (const name of exported) {
      const start = src.indexOf(`export async function ${name}`);
      const next = exported
        .map((n) => src.indexOf(`export async function ${n}`))
        .filter((i) => i > start);
      const body = src.slice(start, next.length ? Math.min(...next) : src.length);

      const resolvesActor = body.includes("await actor()");
      const hasGate = GATES.some((g) => body.includes(g));
      if (!resolvesActor || !hasGate) ungated.push(name);
    }

    assert.deepEqual(
      ungated,
      [],
      `these actions never check permission: ${ungated.join(", ")}`
    );
    console.log(`    (${exported.length} actions checked)`);
  });

  // ----------------------------------------------------------------- cleanup
  await prisma.portfolioAssignment.deleteMany({
    where: { email: { in: [serviceGuruEmail, oneBookGuruEmail] } },
  });
  await prisma.appManager.deleteMany({ where: { email: managerEmail } });
  await prisma.managedPortfolio.deleteMany({
    where: { serviceId: { in: [service.id, other.id] } },
  });
  await prisma.service.deleteMany({ where: { id: { in: [service.id, other.id] } } });

  console.log(failures === 0 ? "\nall permission tests passed\n" : `\n${failures} FAILED\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
