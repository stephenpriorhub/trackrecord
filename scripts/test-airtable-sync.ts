/**
 * Airtable -> Portfolio Manager sync planning — no database needed.
 *
 * Fixtures are the real McCall Innovation Report trades entered 2026-09-28:
 * DXYZ bought at 26.40 and sold in two halves, TMC sold a half then a quarter.
 *
 * Run: npm run test:airtable-sync
 */
import assert from "node:assert/strict";
import {
  desiredFills,
  planPosition,
  UNITS_PER_WEIGHT,
  type LegRef,
} from "../lib/managed/airtable-sync";
import { totalReturn } from "../lib/managed/total-return";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const trade = (id: string, f: Record<string, unknown>) => ({ id, fields: f });
const open = (id: string, sym: string, px: number, date: string, w = 1) =>
  trade(id, { SYMBOL: sym, "To Open or Close": "Open", Action: "Buy", "Trade Price": px, "Trade Date": date, "Weight: Effective": w, "Investment Type": "Stock" });
const close = (id: string, sym: string, px: number, date: string, w: number) =>
  trade(id, { SYMBOL: sym, "To Open or Close": "Close", Action: "Sell", "Trade Price": px, "Trade Date": date, "Weight: Effective": w, "Investment Type": "Stock" });

const leg: LegRef = { id: "leg1", marketTicker: "DXYZ", side: "BUY", ratio: 1 };

console.log("\ndesired fills");

check("Airtable weight becomes units: 1 -> 100, 0.5 -> 50, 0.25 -> 25", () => {
  const f = desiredFills([
    open("a", "TMC", 1.2, "2024-11-20"),
    close("b", "TMC", 1.85, "2025-01-17", 0.5),
    close("c", "TMC", 7.07, "2025-06-18", 0.25),
  ]);
  assert.deepEqual(f.map((x) => x.quantity), [100, 50, 25]);
  assert.equal(UNITS_PER_WEIGHT, 100);
});

check("chronological regardless of Airtable order", () => {
  const f = desiredFills([
    close("c", "DXYZ", 50, "2026-05-29", 0.5),
    open("a", "DXYZ", 26.4, "2026-03-11"),
    close("b", "DXYZ", 69.11, "2026-05-11", 0.5),
  ]);
  assert.deepEqual(f.map((x) => x.tradeId), ["a", "b", "c"]);
});

check("dividends, cash and unfilled trades are ignored", () => {
  const f = desiredFills([
    open("a", "CTS", 40, "2026-01-01"),
    trade("d", { SYMBOL: "CTS", "To Open or Close": "Close", Action: "Distribution", "Investment Type": "Cash", "Trade Date": "2026-09-25" }),
    { ...close("w", "CTS", 45, "2026-09-28", 0.5), fields: { ...close("w", "CTS", 45, "2026-09-28", 0.5).fields, "Waiting for Fill?": true } },
  ]);
  assert.deepEqual(f.map((x) => x.tradeId), ["a"]);
});

check("an expired option closes at $0 even without a Trade Price", () => {
  const f = desiredFills([
    trade("o", { SYMBOL: "X261016C00010000", "To Open or Close": "Open", Action: "Buy", "Trade Price": 1.2, "Trade Date": "2026-09-01", "Investment Type": "Option" }),
    trade("e", { SYMBOL: "X261016C00010000", "To Open or Close": "Close", Action: "Expire", "Trade Date": "2026-10-16", "Investment Type": "Option" }),
  ]);
  assert.equal(f.length, 2);
  assert.equal(f[1].price.toNumber(), 0);
});

console.log("\nplanning");

const dxyz = desiredFills([
  open("a", "DXYZ", 26.4, "2026-03-11"),
  close("b", "DXYZ", 69.11, "2026-05-11", 0.5),
  close("c", "DXYZ", 50, "2026-05-29", 0.5),
]);

check("a position imported before the partial exits is rebuilt", () => {
  const stored = [{ legId: "leg1", intent: "OPEN", quantity: 1, price: "26.4", executedAt: new Date("2026-03-11") }];
  const p = planPosition([leg], stored, dxyz, false);
  assert.equal(p.kind, "rebuild");
  if (p.kind === "rebuild") assert.deepEqual(p.fills.map((f) => f.quantity), [100, 50, 50]);
});

check("an already-synced position is left unchanged", () => {
  const stored = dxyz.map((f) => ({ legId: "leg1", intent: f.intent, quantity: f.quantity, price: f.price.toString(), executedAt: f.executedAt }));
  assert.equal(planPosition([leg], stored, dxyz, false).kind, "unchanged");
});

check("a legacy 1-unit import that matches in shape is NOT rewritten", () => {
  const whole = desiredFills([open("a", "DXYZ", 26.4, "2026-03-11")]);
  const stored = [{ legId: "leg1", intent: "OPEN", quantity: 1, price: "26.4", executedAt: new Date("2026-03-11") }];
  assert.equal(planPosition([leg], stored, whole, false).kind, "unchanged");
});

check("...but a legacy import missing a partial exit still is", () => {
  const stored = [
    { legId: "leg1", intent: "OPEN", quantity: 1, price: "26.4", executedAt: new Date("2026-03-11") },
  ];
  assert.equal(planPosition([leg], stored, dxyz, false).kind, "rebuild");
});

check("hub edits are never overwritten", () => {
  const p = planPosition([leg], [], dxyz, true);
  assert.equal(p.kind, "conflict");
});

check("closing more than was opened is refused", () => {
  const over = desiredFills([open("a", "DXYZ", 26.4, "2026-03-11"), close("b", "DXYZ", 60, "2026-05-11", 1.5)]);
  assert.equal(planPosition([leg], [], over, false).kind, "conflict");
});

check("a trade in a symbol with no leg is refused", () => {
  const other = desiredFills([open("a", "OTHER", 1, "2026-01-01")]);
  assert.equal(planPosition([leg], [], other, false).kind, "conflict");
});

check("DXYZ after the sync: total return blends both halves (+125.59%)", () => {
  // 0.5 x 69.11 + 0.5 x 50 = 59.555 on a 26.40 entry.
  const r = totalReturn({
    cachedEntryPrice: 26.4,
    legs: [{ side: "BUY", ratio: 1, openQty: 0, closedQty: 100, wavgExit: 59.555, instrument: { lastPrice: null, manualPrice: null } }],
  });
  assert.equal(Math.round(Number(r) * 10000) / 100, 125.59);
});

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
