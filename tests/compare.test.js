// js/compare.js: what the comparison marks as better, the price rows, and the one-line answer.
const test = require("node:test");
const assert = require("node:assert/strict");
const CMP = require("../js/compare.js");
const S = require("../js/sources.js");

const milk = (n, v) => S.makeFood(n, "1 cup (240 mL)", v, { missing: [] });
const whole = milk("Whole milk", { cal: 150, fat: 8, sat: 5, chol: 35, na: 120, carb: 12, sug: 12, add: 0, pro: 8 });
const twoPct = milk("Reduced fat 2% milk", { cal: 120, fat: 5, sat: 3, chol: 20, na: 120, carb: 12, sug: 12, add: 0, pro: 8 });

test("only meaningful differences are marked, in the direction that's better", () => {
  const r = CMP.rows(whole, twoPct);
  const win = k => r.find(x => x.k === k).win;
  assert.equal(win("sat"), 1); // 5 g vs 3 g: 10% of the DV apart
  assert.equal(win("cal"), -1); // calories are shown, never marked
  assert.equal(win("fat"), -1); // total fat: shown, never marked
  assert.equal(win("na"), -1); // the same
});

test("an unknown number is never marked", () => {
  const noSat = S.makeFood("X", "1 cup", { cal: 120, fat: 5, na: 120, carb: 12, sug: 12, add: 0, pro: 8 }, { missing: ["sat"] });
  assert.equal(CMP.rows(whole, noSat).find(x => x.k === "sat").win, -1);
});

test("the one-line answer names the advantages, then the verdicts", () => {
  const s = CMP.summary("Whole milk", "Reduced fat 2% milk", CMP.rows(whole, twoPct), "In moderation", "In moderation");
  assert.equal(s.lead, "Reduced fat 2% milk has less saturated fat.");
  assert.equal(s.verdicts, "Both: In moderation.");
  const same = CMP.summary("A", "B", CMP.rows(whole, whole), "Get it", "Fine");
  assert.equal(same.lead, "No meaningful difference in the nutrients that count.");
  assert.equal(same.verdicts, "A: Get it. B: Fine.");
});

test("price rows: the cheaper serving when 10% and 5¢ apart, and protein per dollar for protein sources", () => {
  const rows = CMP.priceRows({ cost: 0.25, mine: true }, { cost: 0.54, mine: true }, { k: "pro", v: 32 }, { k: "pro", v: 15 });
  assert.deepEqual(rows.map(r => [r.label, r.win]), [["Price", 0], ["Protein per $1", 0]]);
  assert.equal(CMP.priceRows({ cost: 0.50, mine: false }, { cost: 0.53, mine: true }, null, null)[0].win, -1); // 3¢ apart
  assert.equal(CMP.priceRows({ cost: 0.50 }, null, null, null).length, 0); // one side has no price
  assert.equal(CMP.priceRows({ cost: 1 }, { cost: 1 }, { k: "fib", v: 3 }, { k: "pro", v: 9 }).length, 1); // not both protein sources
});
