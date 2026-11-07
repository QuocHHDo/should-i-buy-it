// "Better in this aisle" (js/alternatives.js): other products in the same Open Food Facts category.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../js/verdict.js");
const ALT = require("../js/alternatives.js");
const A = require("../js/allergens.js");

// Open Food Facts-shaped records (per serving), as /cgi/search.pl returns them.
const bar = (code, name, n, extra = {}) => ({ code, product_name: name, brands: "Brand", serving_size: "1 bar (40 g)", serving_quantity: 40,
  categories_tags: ["en:snacks", "en:sweet-snacks", "en:bars", "en:cereal-bars", "en:granola-bars"],
  nutriments: { "energy-kcal_serving": n.cal, fat_serving: n.fat, "saturated-fat_serving": n.sat, sodium_serving: n.na / 1000, carbohydrates_serving: n.carb,
    fiber_serving: n.fib, sugars_serving: n.sug, "added-sugars_serving": n.add, proteins_serving: n.pro, "trans-fat_serving": 0, cholesterol_serving: 0 }, ...extra });
const sweet = bar("111", "Honey Crunch Bar", { cal: 190, fat: 7, sat: 3, na: 160, carb: 29, fib: 2, sug: 13, add: 12, pro: 3 });
const DATA = { products: [
  bar("222", "Protein Nut Bar", { cal: 200, fat: 13, sat: 3, na: 140, carb: 14, fib: 7, sug: 5, add: 4, pro: 12 }),
  bar("333", "Plain Oat Bar", { cal: 160, fat: 6, sat: 1, na: 100, carb: 24, fib: 4, sug: 6, add: 5, pro: 4 }),
  bar("444", "Choco Fudge Bar", { cal: 210, fat: 9, sat: 5, na: 150, carb: 31, fib: 1, sug: 18, add: 17, pro: 2 }),
  bar("555", "Peanut Butter Bar", { cal: 190, fat: 12, sat: 2.5, na: 150, carb: 15, fib: 4, sug: 5, add: 4, pro: 9 }, { allergens_tags: ["en:peanuts"] }),
  bar("666", "Broken Bar", { cal: 190, fat: 2, sat: 9, na: 100, carb: 20, fib: 3, sug: 5, add: 4, pro: 5 }), // sat fat above total fat: can't be right
  { code: "777", product_name: "No numbers bar", nutriments: {} },
  bar("111", "Honey Crunch Bar", { cal: 190, fat: 7, sat: 3, na: 160, carb: 29, fib: 2, sug: 13, add: 12, pro: 3 }),
] };
const S = require("../js/sources.js");
const cur = S.fromOff("111", sweet);
const P = V.DEFAULT_PROFILE;

test("the most specific category, skipping broad ones; the search asks for US products in it", () => {
  assert.equal(ALT.category(cur), "en:granola-bars");
  assert.equal(ALT.category({ categories: ["en:snacks", "en:beverages"] }), null);
  assert.equal(ALT.categoryName("en:granola-bars"), "granola bars");
  const u = new URL(ALT.categoryUrl("en:granola-bars"));
  assert.equal(u.searchParams.get("tag_1"), "en:granola-bars"); assert.equal(u.searchParams.get("tag_0"), "united-states"); assert.equal(u.searchParams.get("page_size"), "40");
});

test("parsing leaves out records with no nutrition, impossible numbers, and repeats", () => {
  const names = ALT.parse(DATA).map(f => f.n);
  assert.ok(!names.some(n => /Broken|No numbers/.test(n)), names.join(", "));
  assert.equal(names.filter(n => /Honey Crunch/.test(n)).length, 1);
});

test("only clearly better products, best first, each with its clearest reason", () => {
  const picks = ALT.better(cur, ALT.parse(DATA), P);
  const names = picks.map(p => p.food.n);
  assert.ok(picks.length >= 2 && picks.length <= 3);
  assert.ok(!names.some(n => /Choco Fudge|Honey Crunch/.test(n)), "not worse ones, not the same product");
  const rank = { good: 3, fine: 2, mid: 1, bad: 0 };
  assert.ok(picks.every(p => rank[p.verdict.tier] > rank[V.assess(cur, P).tier] || p.verdict.score >= V.assess(cur, P).score + 2));
  for (let i = 1; i < picks.length; i++) assert.ok(rank[picks[i - 1].verdict.tier] >= rank[picks[i].verdict.tier]);
  const pn = picks.find(p => /Protein Nut/.test(p.food.n));
  assert.equal(pn.basis, "per 100 calories", "brands' servings differ, so the reason compares the same calories");
  assert.match(pn.why, /^(less added sugar: 2 g vs 6\.3 g|more fiber: 3\.5 g vs 1\.1 g|more protein: 6 g vs 1\.6 g)$/);
});

test("your allergies rule products out", () => {
  const pr = { ...P, allergies: ["peanut"] };
  const all = ALT.better(cur, ALT.parse(DATA), pr, { max: 10 }).map(p => p.food.n);
  const safe = ALT.better(cur, ALT.parse(DATA), pr, { max: 10, blocked: f => A.check(f, pr).status === "contains" }).map(p => p.food.n);
  assert.ok(all.some(n => /Peanut Butter/.test(n)) && !safe.some(n => /Peanut Butter/.test(n)));
});

test("with a carb limit the reason can be net carbs", () => {
  const picks = ALT.better(cur, ALT.parse(DATA), { ...P, carb: 25 }, { max: 10 });
  assert.ok(picks.some(p => /^fewer net carbs/.test(p.why)), picks.map(p => p.why).join(" | "));
});

test("nothing clearly better: an empty list", () => {
  assert.deepEqual(ALT.better(S.fromOff("222", DATA.products[0]), ALT.parse(DATA).filter(f => /Choco|Honey/.test(f.n)), P), []);
});
