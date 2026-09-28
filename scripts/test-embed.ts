/**
 * Embed math and option parsing — no database needed.
 *
 * The cases that matter: a partly sold position's total return must include
 * what was sold, an unpriced remainder must never become a number, and nothing
 * from the query string may reach CSS unless it is a plain hex colour.
 *
 * Run: npm run test:embed
 */
import assert from "node:assert/strict";
import { totalReturn } from "../lib/managed/total-return";
import { parseEmbedOptions } from "../lib/managed/embed";

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
const n = (v: { toString(): string } | null) =>
  v === null ? null : Math.round(Number(v.toString()) * 1e6) / 1e6;

const stock = (o: Partial<{ openQty: number; closedQty: number; wavgExit: number | null; last: number | null; manual: number | null; side: string; ratio: number }>) => ({
  side: o.side ?? "BUY",
  ratio: o.ratio ?? 1,
  openQty: o.openQty ?? 0,
  closedQty: o.closedQty ?? 0,
  wavgExit: o.wavgExit ?? null,
  instrument: { lastPrice: o.last ?? null, manualPrice: o.manual ?? null },
});

console.log("\ntotal return");

check("fully open = the mark's move", () => {
  assert.equal(n(totalReturn({ cachedEntryPrice: 10, legs: [stock({ openQty: 100, last: 15 })] })), 0.5);
});

check("fully closed = the realized move", () => {
  assert.equal(n(totalReturn({ cachedEntryPrice: 10, legs: [stock({ closedQty: 100, wavgExit: 30 })] })), 2);
});

check("half sold at +200%, half held at +0% = +100%, not +0%", () => {
  const r = totalReturn({
    cachedEntryPrice: 10,
    legs: [stock({ openQty: 50, closedQty: 50, wavgExit: 30, last: 10 })],
  });
  assert.equal(n(r), 1);
});

check("quantity-weighted: 1/4 sold at 20, 3/4 held at 12 on a 10 entry", () => {
  const r = totalReturn({
    cachedEntryPrice: 10,
    legs: [stock({ openQty: 75, closedQty: 25, wavgExit: 20, last: 12 })],
  });
  // (0.25*20 + 0.75*12) = 14 -> +40%
  assert.equal(n(r), 0.4);
});

check("an unpriced remainder is null, never a loss", () => {
  assert.equal(
    totalReturn({ cachedEntryPrice: 10, legs: [stock({ openQty: 50, closedQty: 50, wavgExit: 30 })] }),
    null,
  );
});

check("manual price is the fallback mark", () => {
  assert.equal(n(totalReturn({ cachedEntryPrice: 10, legs: [stock({ openQty: 10, manual: 11 })] })), 0.1);
});

check("a debit spread partly closed nets its legs", () => {
  // Long 5 call entered 3, short call entered 1: basis 2.
  // Long: half closed at 6, half marked 4 -> 5. Short: half closed at 2, half at 1 -> 1.5.
  const r = totalReturn({
    cachedEntryPrice: 2,
    legs: [
      stock({ openQty: 5, closedQty: 5, wavgExit: 6, last: 4 }),
      stock({ side: "SELL", openQty: 5, closedQty: 5, wavgExit: 2, last: 1 }),
    ],
  });
  // value 5 - 1.5 = 3.5 on 2 -> +75%
  assert.equal(n(r), 0.75);
});

check("no entry basis is null", () => {
  assert.equal(totalReturn({ cachedEntryPrice: null, legs: [stock({ openQty: 1, last: 1 })] }), null);
});

console.log("\nembed options");

check("defaults reproduce the original embed", () => {
  const o = parseEmbedOptions({});
  assert.equal(o.layout, "merged");
  assert.equal(o.tabs, false);
  assert.equal(o.allTab, true);
  assert.deepEqual(o.look, {
    theme: "light", background: null, cards: true, accent: null,
    font: "sans", density: "comfortable", corners: "rounded", title: true,
  });
});

check("look options parse", () => {
  const o = parseEmbedOptions({
    layout: "grouped", tabs: "1", theme: "dark", bg: "none", cards: "0",
    accent: "1d4ed8", font: "serif", density: "compact", corners: "square", title: "0",
  });
  assert.equal(o.layout, "grouped");
  assert.equal(o.tabs, true);
  assert.equal(parseEmbedOptions({ tabs: "1", all: "0" }).allTab, false);
  assert.deepEqual(o.look, {
    theme: "dark", background: "none", cards: false, accent: "#1d4ed8",
    font: "serif", density: "compact", corners: "square", title: false,
  });
});

check("nothing but hex reaches CSS", () => {
  for (const bad of ["red;}body{display:none", "url(x)", "12345", "#ggg", "fff ", "expression(1)"]) {
    const o = parseEmbedOptions({ bg: bad, accent: bad });
    assert.equal(o.look.background, null, `bg ${bad}`);
    assert.equal(o.look.accent, null, `accent ${bad}`);
  }
  assert.equal(parseEmbedOptions({ bg: "#FFF" }).look.background, "#FFF");
});

check("legacy hide= still parses for live iframes", () => {
  assert.deepEqual(parseEmbedOptions({ hide: "a, b" }).hide, ["a", "b"]);
});

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
