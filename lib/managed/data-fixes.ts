/**
 * Standing corrections the Airtable sync re-applies on every run, so a fix
 * made once cannot be undone by the next import.
 */
import { prisma } from "../prisma";
import { ensureGurus, PUBLICATION_OWNER } from "./gurus";
import { recomputePosition } from "./positions";

/**
 * Stock tickers stored without their exchange suffix, and the ticker that
 * actually prices. Stella-Jones is a TSX listing (Stephen, 2026-09-29): "SJTO"
 * matched nothing anywhere; "SJ.TO" prices from TMX (see ./tmx.ts).
 */
export const TICKER_RENAMES: Record<string, string> = {
  SJTO: "SJ.TO",
};

/** Move every stock leg on `from` to `to`, carrying the position label along. */
export async function renameStockTicker(from: string, to: string): Promise<number> {
  const legs = await prisma.managedLeg.findMany({
    where: { marketTicker: from, kind: "STOCK" },
    select: { id: true, positionId: true },
  });
  if (legs.length === 0) return 0;

  await prisma.marketInstrument.upsert({
    where: { ticker: to },
    update: { active: true },
    create: { ticker: to, kind: "STOCK", underlying: to },
  });
  await prisma.managedLeg.updateMany({
    where: { id: { in: legs.map((l) => l.id) } },
    data: { marketTicker: to, underlying: to },
  });

  const positionIds = [...new Set(legs.map((l) => l.positionId))];
  const positions = await prisma.managedPosition.findMany({
    where: { id: { in: positionIds } },
    select: { id: true, underlying: true, label: true },
  });
  for (const p of positions) {
    await prisma.managedPosition.update({
      where: { id: p.id },
      data: {
        underlying: p.underlying === from ? to : p.underlying,
        label: p.label.split(from).join(to),
      },
    });
  }

  // Kept, inactive, rather than deleted: nothing may be left pointing at it,
  // and a retired row costs nothing.
  const stillUsed = await prisma.managedLeg.count({ where: { marketTicker: from } });
  if (stillUsed === 0) {
    await prisma.marketInstrument.update({ where: { ticker: from }, data: { active: false } });
  }

  for (const id of positionIds) await recomputePosition(id);
  return legs.length;
}

/** Apply every rename; returns "SJTO -> SJ.TO (2 legs)" lines for the report. */
export async function applyTickerRenames(): Promise<string[]> {
  const done: string[] = [];
  for (const [from, to] of Object.entries(TICKER_RENAMES)) {
    const n = await renameStockTicker(from, to);
    if (n > 0) done.push(`${from} -> ${to} (${n} leg${n === 1 ? "" : "s"})`);
  }
  return done;
}

/** Give every position in an owner-defined publication its owner. */
export async function enforcePublicationOwner(pubCode: string): Promise<number> {
  const slug = PUBLICATION_OWNER[pubCode];
  if (!slug) return 0;
  const guruId = (await ensureGurus()).get(slug);
  if (!guruId) return 0;
  const r = await prisma.managedPosition.updateMany({
    where: {
      deletedAt: null,
      portfolio: { service: { pubCode } },
      OR: [{ guruId: null }, { guruId: { not: guruId } }],
    },
    data: { guruId },
  });
  return r.count;
}
