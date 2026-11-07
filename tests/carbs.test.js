// The optional carb limit (Goals → Carb limit): off by default, judged on net carbs (carbs minus fiber).
const test = require("node:test");
const assert = require("node:assert/strict");
const { FOODS } = require("../js/foods.js");
const V = require("../js/verdict.js");
const B = require("../js/backup.js");
const food = n => { const f = FOODS.find(x => x.n === n); assert.ok(f, `no food ${n}`); return f; };
const P = V.DEFAULT_PROFILE, LOW = { ...P, carb: 100 }, KETO = { ...P, carb: 25 };
const word = (n, p) => V.assess(food(n), p).word;

test("net carbs: carbs minus fiber, never below zero; unknown fiber counts as none; unknown carbs is null", () => {
  assert.equal(V.netCarb({ carb: 25, fib: 4.4, missing: [] }), 20.6);
  assert.equal(V.netCarb({ carb: 3, fib: 5, missing: [] }), 0);
  assert.equal(V.netCarb({ carb: 20, fib: 0, missing: ["fib"] }), 20);
  assert.equal(V.netCarb({ carb: 0, fib: 0, missing: ["carb"] }), null);
});

test("no carb limit by default: every verdict is the same as before", () => {
  assert.equal(P.carb, 0);
  for (const f of FOODS) assert.deepEqual(V.assess(f, { ...P, carb: 0 }).score, V.assess(f, P).score, f.n);
});

test("keto (25 g): fruit, starchy veg and beans aren't top picks; bread is Limit it; low-carb foods are unchanged", () => {
  for (const n of ["Apple", "Banana", "Sweet potato, baked", "Black beans, canned"]) assert.equal(word(n, KETO), "In moderation", n);
  assert.equal(word("White bread", KETO), "Limit it");
  for (const n of ["Broccoli", "Salmon", "Almonds", "Avocado", "Chicken breast, grilled"]) assert.equal(word(n, KETO), word(n, P), n);
  const r = V.assess(food("Apple"), KETO).reasons.find(x => x.n === "carb");
  assert.equal(r.d, -3, "an apple is most of a keto day's carbs");
  assert.match(r.t, /20\.6 g net carbs \(25 g carbs minus 4\.4 g fiber\) is 82% of your 25 g daily limit/);
});

test("low carb (100 g): an apple is still Get it; one serving at 30%+ of the limit can't be", () => {
  assert.equal(word("Apple", LOW), "Get it");
  const big = { ...food("Apple"), n: "Big fruit bowl", carb: 40, fib: 8 }; // 32 g net = 32%
  const a = V.assess(big, LOW);
  assert.ok(a.score >= 2, "the score alone would be Get it");
  assert.equal(a.word, "In moderation");
  assert.ok(a.reasons.some(x => /^Can't be "Get it" on your 100 g carb limit/.test(x.t)));
});

test("unknown carbs block Get it only when a carb limit is set", () => {
  const f = { ...food("Salmon"), n: "Mystery salmon", missing: ["carb"] };
  assert.equal(V.assess(f, P).word, "Get it");
  assert.equal(V.assess(f, KETO).word, "In moderation");
});

test("plates: net carbs count against a third of the limit", () => {
  const plate = V.combine([{ food: food("Salmon"), mult: 1 }, { food: food("Broccoli"), mult: 1 }, { food: food("Banana"), mult: 1 }]);
  const a = V.assess(plate, KETO);
  assert.ok(a.reasons.some(x => x.n === "carb" && x.d === -2), "a banana is over a keto meal's share");
  assert.notEqual(a.word, "Get it");
  assert.ok(!V.assess(plate, P).reasons.some(x => x.n === "carb"));
});

test("breakdown and label explain show net carbs only with a limit", () => {
  assert.ok(!V.breakdown(food("Apple"), P).rows.some(r => r.k === "carb"));
  const row = V.breakdown(food("Apple"), KETO).rows.find(r => r.k === "carb");
  assert.equal(row.points, -3); assert.match(row.text, /20\.6 g · 82% of your limit/);
  assert.match(V.explain("carb", food("Apple"), KETO)[3], /net-carb limit is 25 g/);
  assert.match(V.explain("carb", food("Apple"), P)[3], /fiber and added-sugar/);
});

test("backups keep a valid carb limit and drop a silly one", () => {
  const ok = B.KEYS.profile({ carb: 25 }), bad = B.KEYS.profile({ carb: 5000, cal: 2000 });
  assert.equal(ok.carb, 25); assert.ok(!("carb" in bad));
});
