/**
 * Set the owner on managed positions that were imported before ManagedPosition
 * had a guru column.
 *
 * Uses the SAME ladder as the import and the sync (lib/managed/war-room-owners),
 * so a backfilled row is indistinguishable from a freshly imported one.
 *
 * Also retires "George": he appears as a PERSON on some War Room trades but is
 * not a guru Stephen wants surfaced, so his positions fall through to the
 * verified workbook, which credits the Bryan or Karim the published
 * Bryan-and-Karim-only record already shows.
 *
 * Idempotent — only fills rows whose owner is still null, unless --force.
 *
 * Usage: npm run backfill:owners [-- --force]
 */
import { PrismaClient } from "@prisma/client";
import { airtableFetch, TABLES } from "../lib/airtable";
import { resolvePubCode, AIRTABLE_TO_PUB_CODE } from "../lib/publications";
import { resolveWarRoomOwner } from "../lib/managed/war-room-owners";
import { ensureGurus, guruSlugs, soleEditor } from "../lib/managed/gurus";

const prisma = new PrismaClient();
const FORCE = process.argv.includes("--force");

/* eslint-disable @typescript-eslint/no-explicit-any */
function airtableCodeFor(pubCode: string): string {
  const real = resolvePubCode(pubCode);
  return Object.keys(AIRTABLE_TO_PUB_CODE).find((k) => AIRTABLE_TO_PUB_CODE[k] === real) ?? real;
}

async function main() {
  // Retire George first, so War Room positions credited to him are re-resolved
  // by the ladder below rather than keeping a stale owner.
  const george = await prisma.guru.findUnique({ where: { slug: "george" } });
  if (george) {
    const mirrored = await prisma.positionGuru.deleteMany({ where: { guruId: george.id } });
    await prisma.managedPosition.updateMany({
      where: { guruId: george.id },
      data: { guruId: null },
    });
    await prisma.serviceGuru.deleteMany({ where: { guruId: george.id } });
    await prisma.portfolioGuru.deleteMany({ where: { guruId: george.id } });
    await prisma.trade.updateMany({ where: { guruId: george.id }, data: { guruId: null } });
    await prisma.guru.delete({ where: { id: george.id } });
    console.log(`removed George (${mirrored.count} track-record attributions cleared)`);
  }

  // Create any missing rows rather than assuming the sync has run — that
  // assumption made this script silently resolve nothing.
  const guruIdBySlug = await ensureGurus();

  const services = await prisma.service.findMany({ select: { id: true, pubCode: true } });

  for (const service of services) {
    const where = {
      portfolio: { serviceId: service.id },
      deletedAt: null,
      airtableId: { not: null },
      ...(FORCE ? {} : { guruId: null }),
    };
    const positions = await prisma.managedPosition.findMany({
      where,
      select: { id: true, airtableId: true, openedAt: true, legs: { select: { marketTicker: true } } },
    });
    if (positions.length === 0) {
      console.log(`${service.pubCode}: nothing to do`);
      continue;
    }

    // One pull of the publication's positions, then match by record id.
    const airtableCode = airtableCodeFor(service.pubCode);
    const portfolios = await airtableFetch(TABLES.portfolios, {
      filterByFormula: `{Pub Code} = "${airtableCode}"`,
    });
    const byId = new Map<string, any>();
    for (const p of portfolios) {
      const pName = p.fields["Portfolio Name"];
      if (typeof pName !== "string" || !pName) continue;
      for (const rec of await airtableFetch(TABLES.positions, {
        filterByFormula: `FIND("${pName}", ARRAYJOIN({Portfolio Name (from Portfolio)}))`,
      })) {
        byId.set(rec.id, rec);
      }
    }

    const counts = new Map<string, number>();
    let unresolved = 0;

    for (const pos of positions) {
      const rec = pos.airtableId ? byId.get(pos.airtableId) : null;
      // Airtable's per-trade PERSON, rolled up onto the position. NOT
      // "Reporting Guru(s)", which falls back to the portfolio's editor list and
      // so reports both editors for anything unattributed.
      const named = guruSlugs(rec?.fields?.["Position Guru(s)"]);

      let slug: string | null;
      if (named.length === 1) {
        slug = named[0];
      } else if (service.pubCode === "WAR") {
        slug = resolveWarRoomOwner(
          pos.legs.map((l) => l.marketTicker),
          pos.openedAt,
          named
        );
      } else {
        // Only safe where the publication has one editor — see soleEditor().
        slug = soleEditor(service.pubCode);
      }

      const guruId = slug ? guruIdBySlug.get(slug) : undefined;
      if (!guruId) {
        unresolved += 1;
        continue;
      }
      await prisma.managedPosition.update({ where: { id: pos.id }, data: { guruId } });
      counts.set(slug!, (counts.get(slug!) ?? 0) + 1);
    }

    const summary = [...counts.entries()].map(([s, n]) => `${s}=${n}`).join(" ");
    console.log(
      `${service.pubCode}: ${positions.length} considered  ${summary || "none resolved"}` +
        (unresolved ? `  unresolved=${unresolved}` : "")
    );
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
