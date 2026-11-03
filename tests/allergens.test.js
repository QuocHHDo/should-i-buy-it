// Allergen flags: detection from ingredient text, Open Food Facts tags, names and typical recipes, and the answer
// the app shows. A missed allergen is the failure that matters, so most cases check that a real one is caught.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../js/allergens.js");
const V = require("../js/verdict.js");
const M = require("../js/meals.js");
const B = require("../js/backup.js");
const { FOODS } = require("../js/foods.js");

const ids = map => [...map.keys()].sort();
const food = (n, extra = {}) => ({ n, a: [], s: "1 serving", c: "lookup", src: "off", tags: [], cal: 100, fat: 1, sat: 0, trans: 0, chol: 0, na: 50, carb: 10, fib: 1, sug: 1, add: 0, pro: 5, missing: [], ...extra });

test("ingredient text: synonyms, Contains line and may-contain statements", () => {
  const r = A.fromText("Enriched flour (wheat flour, niacin), sugar, cocoa, whey, soy lecithin. Contains: wheat, milk, soy. May contain peanuts and tree nuts.");
  assert.deepEqual(ids(r.contains), ["milk", "soy", "wheat"]);
  assert.deepEqual(ids(r.may), ["peanut", "treenut"]);
  assert.deepEqual(ids(A.fromText("Sodium caseinate, albumen, tahini, anchovies, shrimp, pecans, groundnut").contains), ["egg", "fish", "milk", "peanut", "sesame", "shellfish", "treenut"]);
  assert.deepEqual(ids(A.fromText("Durum semolina, spelt, bread crumbs").contains), ["wheat"]);
  assert.deepEqual(ids(A.fromText("Made in a facility that also processes sesame and eggs. Rice, salt").may), ["egg", "sesame"]);
  assert.deepEqual(ids(A.fromText("Rice, salt. Made in a facility that also processes sesame and eggs.").contains), []);
});

test("look-alikes don't count: coconut milk, peanut butter, cocoa butter, eggplant, buckwheat, nutmeg", () => {
  const r = A.fromText("Coconut milk, cocoa butter, eggplant, buckwheat flour, rice flour, nutmeg, water chestnuts, oyster mushrooms, cream of tartar, butternut squash");
  assert.deepEqual(ids(r.contains), []);
  assert.deepEqual(ids(A.fromText("Peanut butter (peanuts, salt)").contains), ["peanut"], "peanut butter is peanuts, not dairy");
  assert.deepEqual(ids(A.fromText("Almond milk (water, almonds)").contains), ["treenut"], "almond milk is a tree nut, not dairy");
});

test("negations are ruled out, but never swallow a list", () => {
  assert.deepEqual(ids(A.fromText("Gluten-free oats, dairy-free chocolate, peanut free").contains), []);
  assert.deepEqual(ids(A.fromText("No added sugar, milk, eggs").contains), ["egg", "milk"], "\"no added sugar, milk\" still has milk");
  assert.deepEqual(ids(A.fromText("Fat free milk").contains), ["milk"]);
  assert.deepEqual(ids(A.fromText("Cage-free eggs").contains), ["egg"]);
});

test("refined soybean oil is a \"may\", soy itself is a \"contains\"", () => {
  assert.deepEqual(ids(A.fromText("Corn, soybean oil, salt").contains), []);
  assert.deepEqual(ids(A.fromText("Corn, soybean oil, salt").may), ["soy"]);
  assert.deepEqual(ids(A.fromText("Soybean oil, soy lecithin").contains), ["soy"]);
  // A real peanut butter label (tests/fixtures/walmart-pages.json): its statement names only peanuts.
  assert.deepEqual(ids(A.fromText("Hydrogenated Vegetable Oil (Rapeseed, Cottonseed, Soybean), Salt").contains), []);
  assert.deepEqual(ids(A.fromText("Hydrogenated Vegetable Oil (Rapeseed, Cottonseed, Soybean), Salt").may), ["soy"]);
  assert.deepEqual(ids(A.fromText("Tofu (soybeans, water)").contains), ["soy"]);
});

test("Open Food Facts allergen and traces tags", () => {
  const r = A.check(food("Biscuits", { allergens: ["en:gluten", "en:milk"], traces: ["en:nuts"] }), { allergies: ["wheat", "treenut", "milk"] });
  assert.equal(r.status, "contains");
  assert.deepEqual(r.contains.map(x => x.id).sort(), ["milk", "wheat"]);
  assert.deepEqual(r.may.map(x => x.id), ["treenut"]);
  assert.match(r.contains.find(x => x.id === "wheat").why.join(" "), /gluten/);
});

test("check: the four answers, never \"safe\"", () => {
  const p = { allergies: ["peanut"] };
  assert.equal(A.check(food("Cookies"), V.DEFAULT_PROFILE), null, "no allergens set: no answer");
  assert.equal(A.check(food("Trail mix", { ingredients: "Peanuts, raisins" }), p).status, "contains");
  assert.equal(A.check(food("Crackers", { ingredients: "Wheat flour, salt. May contain peanuts." }), p).status, "may");
  assert.equal(A.check(food("Cheddar", { src: "usda" }), p).status, "unknown", "no ingredient list");
  assert.equal(A.check(food("Peanut brittle", { src: "usda" }), p).status, "contains", "the name alone is enough to flag");
  const clear = A.check(food("Crackers", { ingredients: "Wheat flour, salt" }), p);
  assert.equal(clear.status, "clear");
  for (const r of [clear, A.check(FOODS.find(f => f.n === "Apple"), p)]) assert.doesNotMatch(`${r.title} ${r.text}`, /\bsafe\b/i);
});

test("other allergens typed in: whole words in the name and ingredients", () => {
  const p = { allergies: [], allergyOther: "coconut, mustard" };
  assert.equal(A.check(food("Curry", { ingredients: "Water, coconut milk, mustard seeds" }), p).contains.length, 2);
  assert.equal(A.check(food("Curry", { ingredients: "Water, rice" }), p).status, "clear");
  assert.equal(A.check(FOODS.find(f => f.n === "Breaded shrimp, frozen"), p).status, "contains", "alias \"coconut shrimp\"");
});

test("typical recipes: every name is a built-in food, and names that say an allergen list it", () => {
  const names = new Set(FOODS.map(f => f.n));
  assert.deepEqual(Object.keys(A.TYPICAL).filter(n => !names.has(n)), []);
  for (const f of FOODS) {
    const listed = String(A.TYPICAL[f.n] || "").split(/\s+/).filter(Boolean).map(t => t.replace(/^\?/, ""));
    for (const id of A.scan([f.n, ...(f.a || [])].join(", ")).keys()) assert.ok(listed.includes(id), `${f.n}: name says ${id}`);
  }
  const has = (n, id) => A.detect(FOODS.find(f => f.n === n)).contains.has(id);
  assert.ok(has("Pad thai", "peanut") && has("Pad thai", "fish") && has("Pad thai", "egg"));
  assert.ok(has("Hummus", "sesame") && has("Pesto", "treenut") && has("Caesar salad", "fish") && has("Croissant", "milk"));
  assert.ok(!has("Apple", "milk") && !has("Oat milk", "milk") && !has("Coconut milk, canned", "treenut"));
});

test("plates: the worst answer among the items, naming which item", () => {
  const pf = V.combine([{ food: FOODS.find(f => f.n === "Apple"), mult: 1 }, { food: FOODS.find(f => f.n === "Peanut butter"), mult: 1 }]);
  const r = V.assess(pf, { ...V.DEFAULT_PROFILE, allergies: ["peanut"] }).allergy;
  assert.equal(r.status, "contains");
  assert.deepEqual(r.contains[0].why, ["Peanut butter"]);
});

test("the verdict carries the allergen answer but its score doesn't change", () => {
  const f = FOODS.find(x => x.n === "Peanut butter");
  const plain = V.assess(f, V.DEFAULT_PROFILE), allergic = V.assess(f, { ...V.DEFAULT_PROFILE, allergies: ["peanut"] });
  assert.equal(plain.allergy, null);
  assert.equal(allergic.allergy.status, "contains");
  assert.equal(allergic.tier, plain.tier);
  assert.equal(allergic.score, plain.score);
});

test("swaps and meal ideas leave out foods with your allergens", () => {
  const p = { ...V.DEFAULT_PROFILE, allergies: ["milk"] };
  const f = FOODS.find(x => x.n === "Whole milk");
  for (const s of V.findSwaps(f, FOODS, p, 10)) assert.ok(!["contains", "may"].includes(s.verdict.allergy.status), s.food.n);
  const R = M.roles(FOODS, { ...p, allergies: ["egg", "fish"] });
  assert.ok(R.protein.length > 0);
  assert.ok(!R.protein.some(x => x.n === "Eggs" || x.n === "Salmon"));
});

test("backups keep valid allergens and drop anything else", () => {
  const out = B.KEYS.profile({ cal: 2000, allergies: ["milk", "peanut", "milk", "bogus", 5], allergyOther: "coconut" });
  assert.deepEqual(out.allergies, ["milk", "peanut"]);
  assert.equal(out.allergyOther, "coconut");
  assert.equal(B.KEYS.profile({ cal: 2000, allergyOther: "x".repeat(300) }).allergyOther, undefined);
});
