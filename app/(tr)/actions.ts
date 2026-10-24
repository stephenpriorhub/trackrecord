"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { serviceByCode } from "@/lib/tr/services";
import { syncSheets } from "@/lib/tr/sync";
import { LOGGABLE, logTradeToSheet, type LoggedTrade } from "@/lib/tr/sheets/write";
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

export interface LogTradeInput {
  code: string;
  portfolio: string;
  underlying: string;
  right: string;
  strike: string;
  expiry: string;
  quantity: string;
  openDate: string;
  entryPrice: string;
  closeDate: string;
  exitPrice: string;
}

/**
 * Log a closed trade: write it into the service's sheet, then re-sync that
 * service so it appears at once. Super_admin and App Managers only.
 */
export async function logTrade(input: LogTradeInput): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    await requireLogger();
    const def = checkCode(input.code);
    if (!(LOGGABLE as readonly string[]).includes(def.code) || !def.sheetId) {
      return { ok: false, error: `${def.name} trades can't be logged here.` };
    }
    const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const num = (s: string) => Number(String(s).replace(/[$,\s]/g, ""));
    const underlying = input.underlying.trim().toUpperCase();
    const strike = num(input.strike);
    const quantity = num(input.quantity);
    const entryPrice = num(input.entryPrice);
    const exitPrice = num(input.exitPrice);
    if (!/^[A-Z]{1,6}$/.test(underlying)) return { ok: false, error: "Enter the ticker (letters only)." };
    if (input.right !== "C" && input.right !== "P") return { ok: false, error: "Choose call or put." };
    if (!(strike > 0)) return { ok: false, error: "Enter the strike price." };
    if (!isYmd(input.expiry) || !isYmd(input.openDate) || !isYmd(input.closeDate)) {
      return { ok: false, error: "Enter the expiration, open and close dates." };
    }
    if (input.closeDate < input.openDate) return { ok: false, error: "The close date is before the open date." };
    if (!(quantity > 0)) return { ok: false, error: "Enter the number of contracts (or the weight)." };
    if (!(entryPrice > 0)) return { ok: false, error: "Enter the price paid per contract." };
    if (!(exitPrice >= 0)) return { ok: false, error: "Enter the closing price (0 if it expired worthless)." };
    const portfolio = def.code === "PMK" ? (input.portfolio === "stock-flips" ? "stock-flips" : "dark-ticker") : "main";

    const written = await logTradeToSheet({
      code: def.code as LoggedTrade["code"],
      sheetId: def.sheetId,
      portfolio,
      underlying,
      right: input.right,
      strike,
      expiry: input.expiry,
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
