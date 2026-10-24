"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { serviceByCode } from "@/lib/tr/services";
import { syncSheets } from "@/lib/tr/sync";
import { LOGGABLE, editTradeInSheet, logTradeToSheet, type Leg, type LoggedTrade, type TradeEdit } from "@/lib/tr/sheets/write";
import { requireAdmin, requireLogger } from "@/lib/tr/viewer";

function newToken(): string {
  return crypto.randomBytes(15).toString("base64url");
}

function checkCode(code: string) {
  const def = serviceByCode(code);
  if (!def) throw new Error("Unknown service.");
  return def;
}

/** Turn the public, read-only page on or off. A token is minted the first time. */
export async function setPublicEnabled(code: string, enabled: boolean) {
  await requireAdmin();
  const def = checkCode(code);
  const row = await prisma.trService.findUnique({ where: { code: def.code }, select: { publicToken: true } });
  const token = row?.publicToken ?? newToken();
  await prisma.trService.upsert({
    where: { code: def.code },
    create: { code: def.code, publicEnabled: enabled, publicToken: token },
    update: { publicEnabled: enabled, publicToken: token },
  });
  revalidatePath(`/s/${def.slug}`);
}

export async function setPublicBenchmark(code: string, show: boolean) {
  await requireAdmin();
  const def = checkCode(code);
  await prisma.trService.upsert({
    where: { code: def.code },
    create: { code: def.code, publicShowBenchmark: show },
    update: { publicShowBenchmark: show },
  });
  revalidatePath(`/s/${def.slug}`);
}

/** New link; the old one stops working immediately. */
export async function rotatePublicToken(code: string) {
  await requireAdmin();
  const def = checkCode(code);
  await prisma.trService.upsert({
    where: { code: def.code },
    create: { code: def.code, publicToken: newToken() },
    update: { publicToken: newToken() },
  });
  revalidatePath(`/s/${def.slug}`);
}

export async function syncNow(codes?: string[]) {
  await requireAdmin();
  const report = await syncSheets(codes);
  revalidatePath("/", "layout");
  return report.map((r) => ({ code: r.code, ok: r.ok, message: r.message }));
}

export interface LegInput {
  action: string;
  right: string;
  strike: string;
  expiry: string;
}

export interface LogTradeInput {
  code: string;
  portfolio: string;
  underlying: string;
  structure: string; // SINGLE | MULTI | PUT_SELL
  credit: boolean;
  legs: LegInput[];
  quantity: string;
  openDate: string;
  entryPrice: string;
  closeDate: string;
  exitPrice: string;
}

type Result = { ok: true; message: string } | { ok: false; error: string };

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (s: string | number) => Number(String(s).replace(/[$,\s]/g, ""));

/**
 * Log a closed trade: write it into the service's sheet, then re-sync that
 * service so it appears at once. Admins and App Managers only.
 */
export async function logTrade(input: LogTradeInput): Promise<Result> {
  try {
    await requireLogger();
    const def = checkCode(input.code);
    if (!(LOGGABLE as readonly string[]).includes(def.code) || !def.sheetId) {
      return { ok: false, error: `${def.name} trades can't be logged here.` };
    }
    const underlying = input.underlying.trim().toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(underlying)) return { ok: false, error: "Enter the ticker (letters only)." };
    const structure = (["SINGLE", "MULTI", "PUT_SELL"] as const).find((x) => x === input.structure);
    if (!structure) return { ok: false, error: "Choose the kind of trade." };

    const legs: Leg[] = [];
    for (const [i, l] of input.legs.entries()) {
      const strike = num(l.strike);
      if (l.right !== "C" && l.right !== "P") return { ok: false, error: `Leg ${i + 1}: choose call or put.` };
      if (!(strike > 0)) return { ok: false, error: `Leg ${i + 1}: enter the strike.` };
      if (!isYmd(l.expiry)) return { ok: false, error: `Leg ${i + 1}: enter the expiration.` };
      legs.push({ action: l.action === "SELL" ? "SELL" : "BUY", right: l.right, strike, expiry: l.expiry });
    }
    if (structure === "SINGLE" && legs.length !== 1) return { ok: false, error: "A single option has one leg." };
    if (structure === "MULTI" && legs.length < 2) return { ok: false, error: "A spread needs at least two legs." };
    if (structure === "PUT_SELL") {
      if (legs.length !== 1 || legs[0].right !== "P") return { ok: false, error: "A put sell is one put." };
      legs[0].action = "SELL";
    }
    const credit = structure === "PUT_SELL" ? true : structure === "MULTI" ? !!input.credit : false;

    const quantity = num(input.quantity);
    const entryPrice = num(input.entryPrice);
    const exitPrice = num(input.exitPrice);
    if (!isYmd(input.openDate) || !isYmd(input.closeDate)) return { ok: false, error: "Enter the open and close dates." };
    if (input.closeDate < input.openDate) return { ok: false, error: "The close date is before the open date." };
    if (!(quantity > 0)) return { ok: false, error: "Enter the number of contracts (or the weight)." };
    if (!(entryPrice > 0)) return { ok: false, error: credit ? "Enter the credit received." : "Enter the price paid." };
    if (!(exitPrice >= 0)) return { ok: false, error: "Enter the closing price (0 if it expired worthless)." };
    const portfolio = def.code === "PMK" ? (input.portfolio === "stock-flips" ? "stock-flips" : "dark-ticker") : "main";

    const written = await logTradeToSheet({
      code: def.code as LoggedTrade["code"],
      sheetId: def.sheetId,
      portfolio,
      underlying,
      structure,
      legs,
      credit,
      quantity,
      openDate: input.openDate,
      entryPrice,
      closeDate: input.closeDate,
      exitPrice,
    });
    await syncSheets([def.code]);
    revalidatePath(`/s/${def.slug}`);
    revalidatePath("/");
    return {
      ok: true,
      message: `Added to ${def.name}'s sheet (${written.map((w) => `${w.tab}, row ${w.row}`).join("; ")}).`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log the trade." };
  }
}

export interface EditTradeInput {
  id: string;
  openDate: string;
  closeDate: string;
  entryPrice: string;
  exitPrice: string;
  /** Percent as typed, e.g. "25.5" for +25.5%. */
  returnPct: string;
}

/**
 * Edit a trade: rewrite its dates, prices and return in the sheet row it came
 * from, then re-sync. Admins and App Managers only.
 */
export async function editTrade(input: EditTradeInput): Promise<Result> {
  try {
    await requireLogger();
    const t = await prisma.trTrade.findUnique({ where: { id: input.id } });
    if (!t) return { ok: false, error: "That trade is no longer in the track record — the sheet may have changed." };
    const def = checkCode(t.serviceCode);
    if (!def.sheetId) return { ok: false, error: "This trade isn't from a sheet." };

    const entryPrice = num(input.entryPrice);
    const exitPrice = num(input.exitPrice);
    const returnPct = num(input.returnPct) / 100;
    if (!isYmd(input.openDate) || !isYmd(input.closeDate)) return { ok: false, error: "Enter the open and close dates." };
    if (input.closeDate < input.openDate) return { ok: false, error: "The close date is before the open date." };
    if (!Number.isFinite(entryPrice) || entryPrice === 0) return { ok: false, error: "Enter the entry price." };
    if (!Number.isFinite(exitPrice)) return { ok: false, error: "Enter the exit price." };
    if (!Number.isFinite(returnPct)) return { ok: false, error: "Enter the return." };

    // Write only what changed, so fixing a date never rewrites a price column
    // the sheet fills on a different basis.
    const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
    const differs = (a: number | null, b: number) => a === null || Math.abs(a - b) > 1e-9;
    const edit: TradeEdit = {};
    if (input.openDate !== ymd(t.openDate)) edit.openDate = input.openDate;
    if (input.closeDate !== ymd(t.closeDate)) edit.closeDate = input.closeDate;
    if (differs(t.entryPrice, entryPrice)) edit.entryPrice = entryPrice;
    if (differs(t.exitPrice, exitPrice)) edit.exitPrice = exitPrice;
    if (differs(t.returnPct, returnPct) && Math.abs((t.returnPct ?? 0) - returnPct) > 5e-7) edit.returnPct = returnPct;
    if (Object.keys(edit).length === 0) return { ok: true, message: "Nothing changed." };

    await editTradeInSheet({
      code: def.code,
      sheetId: def.sheetId,
      tab: t.sheetTab,
      row: t.sheetRow,
      expect: { openDate: t.openDate.toISOString().slice(0, 10), returnPct: t.returnPct },
      edit,
    });
    await syncSheets([def.code]);
    revalidatePath(`/s/${def.slug}`);
    revalidatePath("/");
    return { ok: true, message: `Updated ${t.sheetTab}, row ${t.sheetRow} in ${def.name}'s sheet.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update the trade." };
  }
}
