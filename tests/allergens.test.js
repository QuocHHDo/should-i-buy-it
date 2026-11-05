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

// Cases found on real labels by eval/allergen-eval.mjs.
test("real-label false flags: other flours, refined peanut oil, lecithin with no source", () => {
  for (const t of ["SOYA flour (30%), tapioca starch", "black gram flour, corn flour", "legume flour in variable proportion (peas, beans)", "thickener (flour of carob seeds)"])
    assert.ok(!A.fromText(t).contains.has("wheat"), t);
  assert.ok(A.fromText("Enriched flour (niacin), sugar").contains.has("wheat"), "plain flour is still wheat");
  const nuts = A.fromText("Cashews, Almonds, Highly refined peanut oil. May contain: Peanuts, Milk.");
  assert.ok(!nuts.contains.has("peanut") && nuts.may.has("peanut"));
  assert.ok(A.fromText("Peanut oil, salt").contains.has("peanut"), "unrefined peanut oil is still a contains");
  assert.deepEqual(ids(A.fromText("Sugar, emulsifiers: lecithins, salt").may), ["soy"]);
  assert.deepEqual(ids(A.fromText("Sugar, sunflower lecithin").may), []);
  assert.ok(!A.fromText("Sea salt, tamari soy sauce powder (tamari soy sauce [soybeans, salt])").contains.has("wheat"), "tamari is made without wheat");
  const muffin = A.fromText("Wheat flour, soy lecithin. Made in a bakery that may also use tree nuts.");
  assert.ok(!muffin.contains.has("treenut") && muffin.may.has("treenut"), "\"may also use\" is cross-contact");
  // Cadbury Oreo (India): "Emulsifier (322)" is lecithin by its additive number; the label's statement says soy.
  assert.deepEqual(ids(A.fromText("Starch, Emulsifier (322), Flavouring").may), ["soy"]);
  assert.deepEqual(ids(A.fromText("Sugar, soy lecithin").contains), ["soy"]);
});

test("Open Food Facts allergen and traces tags", () => {
  const r = A.check(food("Biscuits", { allergens: ["en:gluten", "en:milk"], traces: ["en:nuts"] }), { allergies: ["wheat", "treenut", "milk"] });
  assert.equal(r.status, "contains");
  assert.deepEqual(r.contains.map(x => x.id), ["milk"]);
  // Their gluten tag covers oats and barley too (Oatly is tagged gluten): a "may" for wheat until the list says wheat.
  assert.deepEqual(r.may.map(x => x.id).sort(), ["treenut", "wheat"]);
  assert.match(r.may.find(x => x.id === "wheat").why.join(" "), /gluten/);
  const flour = A.check(food("Biscuits", { allergens: ["en:gluten"], ingredients: "Wheat flour, sugar" }), { allergies: ["wheat"] });
  assert.equal(flour.status, "contains");
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
    for (const id of [...A.scan([f.n, ...(f.a || [])].join(", ")).keys()].filter(id => A.IDS.includes(id))) assert.ok(listed.includes(id), `${f.n}: name says ${id}`);
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

// ---------- diets: gluten-free, vegetarian, vegan ----------
const flagOf = (t, d) => { const r = A.detect(food("Test", { ingredients: t })); return r.contains.has(d) ? "contains" : r.may.has(d) ? "may" : "none"; };

test("gluten: wheat counts, so do barley, rye and malt; oats are a may; look-alikes aren't", () => {
  assert.equal(flagOf("Enriched flour, sugar", "gluten"), "contains", "wheat is gluten");
  for (const t of ["Barley, water", "Rye flour", "Sugar, malt extract", "Malted milk powder", "Soy sauce (water, wheat, soybeans)"]) assert.equal(flagOf(t, "gluten"), "contains", t);
  assert.equal(flagOf("Rolled oats, honey", "gluten"), "may", "oats are often cross-contaminated");
  assert.equal(flagOf("Gluten-free oats, honey", "gluten"), "none", "certified gluten-free oats");
  for (const t of ["Buckwheat, rice", "Maltodextrin, maltitol, maltose", "Corn, rice flour", "Tamari soy sauce powder"]) assert.equal(flagOf(t, "gluten"), "none", t);
  // Real labels (eval/allergen-eval.mjs): flours whose own list has no wheat, corn semolina, and wheatgrass.
  assert.equal(flagOf("Nut & Seed Flour Blend (almonds, sunflower seeds, flax seeds), Tapioca", "gluten"), "none");
  assert.equal(flagOf("Catalina Flour (pea protein, corn flour, tapioca starch)", "gluten"), "none");
  assert.equal(flagOf("Enriched Bleached Flour (Flour, Niacin, Reduced Iron)", "gluten"), "contains");
  assert.equal(flagOf("Enriched flour (niacin, reduced iron, thiamine mononitrate), sugar", "gluten"), "contains", "a vitamin list doesn't make flour wheat-free");
  assert.equal(flagOf("Whole oat flour, corn semolina", "gluten"), "may");
  assert.equal(flagOf("Organic wheatgrass powder, barley grass powder", "gluten"), "may", "the grass has no gluten, but cross-contact is common");
  assert.equal(flagOf("Organic wheatgrass powder", "wheat"), "contains", "for a wheat allergy it's still wheat");
});

test("vegetarian: meat, fish, gelatin; flavorings and rennet are a may; meatless look-alikes aren't", () => {
  for (const t of ["Chicken broth, salt", "Sugar, gelatin, citric acid", "Beef tallow", "Anchovies, olive oil", "Shrimp, rice", "Pork rinds"]) assert.equal(flagOf(t, "vegetarian"), "contains", t);
  for (const t of ["Noodles, artificial chicken flavour, salt", "Milk, cheese cultures, salt, enzymes (rennet)", "Sugar, carmine"]) assert.equal(flagOf(t, "vegetarian"), "may", t);
  for (const t of ["Plant-based chicken (pea protein)", "Chickpeas, tahini", "Meatless crumbles (soy)", "Water chestnuts, duck sauce", "Coconut meat", "Microbial rennet, milk"]) assert.equal(flagOf(t, "vegetarian"), "none", t);
  assert.equal(flagOf("Hot dog bun (wheat flour)", "vegetarian"), "none");
});

test("vegan: anything not vegetarian, plus milk, eggs, honey; plant milks and honeydew aren't", () => {
  for (const t of ["Whey protein", "Egg whites", "Honey, oats", "Shellac (confectioner's glaze)", "Chicken broth", "Sugar, gelatin"]) assert.equal(flagOf(t, "vegan"), "contains", t);
  assert.equal(flagOf("Water, vitamin D3", "vegan"), "may", "vitamin D3 is usually from lanolin");
  for (const t of ["Coconut milk, cocoa butter", "Almond milk (water, almonds)", "Honeydew melon", "Peanut butter (peanuts, salt)", "Oat milk, sunflower lecithin"]) assert.equal(flagOf(t, "vegan"), "none", t);
});

test("diets on built-in foods: names, typical recipes and derived flags", () => {
  const p = { diets: ["vegetarian"] }, v = { diets: ["vegan"] }, g = { diets: ["gluten"] };
  const st = (n, prof) => A.check(FOODS.find(f => f.n === n), prof).status;
  for (const n of ["Chicken breast, grilled", "Salmon", "Cheeseburger, fast food", "Gummy bears", "Caesar salad", "Pad thai", "Chicken broth"]) assert.equal(st(n, p), "contains", n);
  for (const n of ["Hummus", "Tofu, firm", "Veggie burger", "Apple", "Whole milk"]) assert.equal(st(n, p), "clear", n);
  for (const n of ["Whole milk", "Eggs", "Honey", "Butter", "Croissant"]) assert.equal(st(n, v), "contains", n);
  for (const n of ["Almond milk, unsweetened", "Oat milk", "Soy milk, unsweetened", "Tofu, firm", "Hummus", "Coconut milk, canned"]) assert.equal(st(n, v), "clear", n);
  for (const n of ["White bread", "Beer", "Barley, pearled", "Soy sauce", "Pasta"]) assert.equal(st(n, g), "contains", n);
  for (const n of ["White rice", "Corn tortillas", "Quinoa", "Potato, baked"]) assert.equal(st(n, g), "clear", n);
  assert.equal(st("Oatmeal, rolled oats", g), "may");
  const names = new Set(FOODS.map(f => f.n));
  assert.deepEqual(Object.keys(A.TYPICAL_DIET).filter(n => !names.has(n)), [], "every diet entry is a built-in food");
  // Every meat and seafood food is flagged not vegetarian.
  assert.deepEqual(FOODS.filter(f => ["meat", "seafood"].includes(f.c) && st(f.n, p) !== "contains").map(f => f.n), []);
});

test("diets: the flag's wording, Open Food Facts tags, and swaps leave them out", () => {
  const r = A.check(FOODS.find(f => f.n === "Chicken breast, grilled"), { diets: ["vegetarian"] });
  assert.equal(r.title, "Contains meat, fish or gelatin");
  assert.equal(r.short, "Not vegetarian");
  assert.equal(A.check(FOODS.find(f => f.n === "Apple"), { diets: ["vegan"] }).title, "Nothing your diet rules out found");
  assert.equal(A.check(FOODS.find(f => f.n === "Apple"), { diets: ["vegan"], allergies: ["milk"] }).title, "None of your allergens or diet flags found");
  assert.equal(A.check(food("Chips", { analysis: ["en:non-vegan", "en:vegetarian"] }), { diets: ["vegan"] }).status, "contains");
  assert.equal(A.check(food("Chips", { analysis: ["en:maybe-vegan"] }), { diets: ["vegan"] }).status, "may");
  assert.equal(A.check(food("Crackers", { allergens: ["en:gluten"] }), { diets: ["gluten"] }).status, "contains");
  const prof = { ...V.DEFAULT_PROFILE, diets: ["vegetarian"] };
  const R = M.roles(FOODS, prof);
  assert.ok(R.protein.length > 0 && !R.protein.some(f => ["meat", "seafood"].includes(f.c)), "meal ideas use only vegetarian proteins");
  for (const s of V.findSwaps(FOODS.find(f => f.n === "Bacon"), FOODS, prof, 10)) assert.ok(!["meat", "seafood"].includes(s.food.c), s.food.n);
});

test("real-label false flags found by the diet eval: a brand name, butter flavor", () => {
  assert.equal(A.detect(food("Cape Cod Kettle Cooked Potato Chips", { ingredients: "Potatoes, Vegetable Oils (Canola, Sunflower), Sea Salt." })).contains.has("fish"), false);
  assert.equal(A.detect(food("Cod fillets", { ingredients: "Cod" })).contains.has("fish"), true);
  const pop = A.fromText("Popcorn, coconut oil, salt, butter flavor.");
  assert.ok(!pop.contains.has("milk") && pop.may.has("milk"));
  assert.equal(flagOf("Popcorn, coconut oil, salt, butter flavor.", "vegan"), "may");
  assert.ok(A.fromText("Popcorn, butter (cream, salt)").contains.has("milk"), "real butter is still milk");
});

test("backups keep valid diets", () => {
  assert.deepEqual(B.KEYS.profile({ cal: 2000, diets: ["vegan", "keto", "vegan", "gluten"] }).diets, ["vegan", "gluten"]);
});
