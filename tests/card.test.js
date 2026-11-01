// The extension card's wording and choices, on built-in foods and on real Walmart page data.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../js/verdict.js");
const C = require("../js/card.js");
const W = require("../js/walmart.js");
const { FOODS } = require("../js/foods.js");
const PAGES = require("./fixtures/walmart-pages.json").pages;
const P = V.DEFAULT_PROFILE;
const food = n => FOODS.find(f => f.n === n);
const panel = k => W.fromPanel(W.product(PAGES[k].props.pageProps.initialData.data));

test("headline: the strongest plus and minus, in the verdict's own terms", () => {
  assert.equal(C.headline(panel("cheerios"), P), "A good fiber source, but 20% of your added-sugar limit.");
  assert.equal(C.headline(panel("milk"), P), "Decent protein, but 15% of your saturated-fat limit.");
  assert.equal(C.headline(panel("oikos"), P), "High protein for the calories.");
  assert.equal(C.headline(food("Banana"), P), "A good fiber source and whole fruit.");
});

test("headline: Limit it leads with what's wrong", () => {
  assert.equal(C.headline(food("Bacon"), P), "Processed meat and 16% of your saturated-fat limit, despite decent protein.");
  assert.match(C.headline(food("Soda"), P), /^78% of your added-sugar limit/);
});

test("headline: when something else decided it, the verdict's own line", () => {
  assert.equal(C.headline(food("Banana"), { ...P, skip: "banana" }), V.assess(food("Banana"), { ...P, skip: "banana" }).why);
  const partial = { ...food("Chicken breast, grilled"), missing: ["na"] };
  assert.equal(C.headline(partial, P), "Looks good on what's known, but key data is missing.");
  // "Fine" leads with its specific reason, not "No real impact either way."
  assert.match(C.headline(food("Coffee, black"), P), /calories and nothing to flag, so it barely affects your day\.$/);
});

test("limit bars use the verdict's cutoffs and points", () => {
  const bars = C.limitBars(panel("milk"), P);
  assert.deepEqual(bars.map(b => [b.k, b.value, b.tone]), [["sat", "3 g · 15%", "warn"], ["na", "130 mg · 6%", "ok"], ["add", "0 g · 0%", "ok"]]);
  for (const b of bars) assert.ok(b.marks.every(m => m > 0 && m < 1) && b.fill >= 0 && b.fill <= 1);
  const ramen = C.limitBars(food("Instant ramen"), P);
  assert.deepEqual(ramen.map(b => b.tone), ["bad", "bad", "ok"]);
  const missing = C.limitBars({ ...food("Banana"), missing: ["add"] }, P).find(b => b.k === "add");
  assert.equal(missing.known, false);
  assert.equal(missing.value, "not listed");
});

test("reasons: the two that decided it first, the rest folded", () => {
  const a = V.assess(food("Avocado"), P);
  const r = C.reasons(a, [{ name: "Red 3", code: "E127", flag: { t: "Revoked by the FDA." } }]);
  assert.equal(r.top.length, 2);
  assert.ok(r.top.every(x => x.d));
  assert.ok(r.rest.some(x => /Red 3 \(E127\)/.test(x.t)), "additive flags go under more");
  const capped = C.reasons(V.assess({ ...food("Chicken breast, grilled"), missing: ["na"] }, P));
  assert.ok(capped.top.some(x => /^Can't rate it "Get it"/.test(x.t)), "a reason that capped the verdict stays visible");
});

test("swap: same kind of food, better verdict, and a Walmart search", () => {
  assert.equal(C.swap(panel("cheerios"), FOODS, P).food.n, "Toasted oat cereal, plain");
  assert.equal(C.swap(panel("cheerios"), FOODS, P).query, "toasted oat cereal");
  assert.equal(C.swap(food("Bacon"), FOODS, P).query, "roasted turkey breast");
  assert.equal(C.searchName("Peanut butter, natural"), "natural peanut butter");
  assert.equal(C.walmartSearch("natural peanut butter"), "https://www.walmart.com/search?q=natural%20peanut%20butter");
});

test("per-dollar line follows the app's own rule (prices.js value)", () => {
  const PR = require("../js/prices.js");
  for (const f of FOODS) {
    const p = PR.price(f);
    if (!p) continue;
    const v = PR.value(f, p);
    assert.equal(C.perDollar(f, p.perServing), v ? v.text : null, f.n);
  }
  assert.equal(C.perDollar(panel("oikos"), 1.12), "21 g protein per $1");
});

test("per-dollar line: none without a cost or for foods that are neither protein nor fiber picks", () => {
  assert.equal(C.perDollar(panel("oikos"), 0), null);
  assert.equal(C.perDollar({ cal: 140, pro: 0, fib: 0 }, 0.65), null);
  assert.equal(C.money(1.121), "$1.12");
});

test("swaps stay within the same kind of food", () => {
  const W = require("../js/walmart.js"), { data } = require("./fixtures/walmart-compact.js");
  const P = V.DEFAULT_PROFILE;
  const sw = k => { const p = W.product(data(k)), pl = W.plan(p), f = pl.food || W.byName(pl.query, FOODS), s = C.swap(f, FOODS, P); return s ? s.food.n : null; };
  assert.equal(sw("frosted flakes"), "Toasted oat cereal, plain", "a cereal filed under 'Pantry meal essentials' still swaps with cereals");
  assert.equal(sw("great value orange juice"), "Orange", "juice: the whole fruit, not an energy drink");
  assert.equal(sw("great value salted butter"), "Extra virgin olive oil", "butter: an oil, not mayonnaise");
  assert.equal(sw("oscar mayer bacon"), "Turkey breast, roasted", "bacon borrows Bacon's hand-picked swaps, not chicken nuggets");
  assert.equal(sw("lays classic potato chips"), "Popcorn, air-popped");
  assert.equal(sw("great value white bread"), "Whole wheat bread");
  assert.equal(sw("great value large white eggs 12 count"), "Egg whites");
  const by = n => FOODS.find(f => f.n === n);
  const one = n => (V.findSwaps(by(n), FOODS, P, 1)[0] || { food: { n: null } }).food.n;
  assert.equal(one("Alfredo sauce, jarred"), "Marinara sauce");
  for (const n of ["Marinara sauce", "Jam", "Teriyaki sauce", "Brown gravy", "Sugar", "Queso dip"]) assert.notEqual(one(n), "Sriracha", n);
  // A creamy sauce never gets a hot sauce, whatever its name.
  const tartar = { n: "Louisiana Fish Fry Creamy Tartar Sauce with Relish & Lemon, 10.5 oz", c: "lookup", s: "2 Tbsp (28 g)", cal: 120, fat: 12, sat: 2, trans: 0, chol: 10, na: 230, carb: 3, fib: 0, sug: 2, add: 1, pro: 0,
    src: "walmart", dataType: "Branded", foodCategory: "Food > Pantry > Condiments > Tartar sauce", missing: [] };
  assert.equal(V.kindOf(tartar, "condiments"), "creamy");
  assert.ok(V.findSwaps(tartar, FOODS, P, 3).every(s => V.kindOf(s.food, "condiments") === "creamy"));
});

test("a lighter version of the same kind when nothing scores better, labeled as lighter", () => {
  const P = V.DEFAULT_PROFILE, by = n => FOODS.find(f => f.n === n);
  const first = n => V.findSwaps(by(n), FOODS, P, 1)[0];
  assert.equal(first("Marinara sauce").food.n, "Marinara sauce, reduced sodium");
  assert.equal(first("Marinara sauce").lighter, "92% less sodium");
  assert.equal(first("Jam").food.n, "Jam, reduced sugar");
  assert.equal(first("Teriyaki sauce").food.n, "Low-sodium teriyaki sauce", "the closer name wins among lighter versions");
  assert.equal(first("Thousand Island dressing").food.n, "Greek yogurt ranch dressing");
  assert.equal(first("Ranch dressing").lighter, null, "a better verdict (hand-picked salsa) beats a lighter version");
  assert.equal(first("Sugar"), undefined, "sugar doesn't swap to jam");
  assert.equal(first("Extra virgin olive oil"), undefined, "cooking oils aren't swapped for being lighter");
  const tartar = { n: "Louisiana Fish Fry Creamy Tartar Sauce with Relish & Lemon", c: "lookup", s: "2 Tbsp (28 g)", cal: 120, fat: 12, sat: 2, trans: 0, chol: 10, na: 230, carb: 3, fib: 0, sug: 2, add: 1, pro: 0,
    src: "walmart", dataType: "Branded", foodCategory: "Food > Pantry > Condiments > Tartar sauce", missing: [] };
  const s = C.swap(tartar, FOODS, P);
  assert.equal(s.food.n, "Tzatziki");
  assert.equal(s.lighter, "77% fewer calories by weight", "servings of different sizes are compared at the same weight");
});

test("ingredients that contradict the product's name are warned about, not listed", () => {
  const I = require("../js/ingredients.js");
  const r = I.analyze("Carbonated water, caramel color, aspartame, phosphoric acid, potassium benzoate, natural flavors, citric acid, caffeine.",
    "Coca-Cola Caffeine-Free Diet Coke Soda Pop, 12 fl oz Cans, 12 Pack");
  assert.match(r.conflict, /Caffeine in a caffeine-free product/);
  const caf = r.groups.find(g => g.key === "stim").items[0];
  assert.equal(caf.name, "Caffeine");
  assert.equal(caf.conflict, "The product name says caffeine-free. Check the package.", "kept in place, with the conflict marked next to it");
  assert.equal(I.analyze("Water, caffeine", "Diet Coke").conflict, null);
  assert.match(I.analyze("Water, sugar, citric acid", "Zero Sugar Lemonade").conflict, /Sugar in a sugar-free product/);
  assert.match(I.analyze("Oats, wheat flour", "Gluten-Free Oat Bars").conflict, /Wheat Flour/);
  assert.equal(I.analyze("Gluten-free oats, buckwheat flour", "Gluten-Free Oat Bars").conflict, null);
});

test("an exact 0 g of total sugars means 0 g added, even when the source leaves added sugar out", () => {
  const S = require("../js/sources.js");
  const f = S.fromOff("049000050110", { product_name: "Diet Coke caffeine free", serving_size: "355 ml", serving_quantity: 355,
    nutriments: { "energy-kcal_serving": 0, fat_serving: 0, "saturated-fat_serving": 0, sodium_serving: 0.04, carbohydrates_serving: 0, sugars_serving: 0, proteins_serving: 0 } });
  assert.equal(f.add, 0);
  assert.ok(!f.missing.includes("add"));
  assert.equal(C.limitBars(f, P).find(b => b.k === "add").known, true);
});

test("badge reasons fit in 40 characters and notes in 12 words", () => {
  for (const f of FOODS) {
    const a = V.assess(f, P), b = C.badgeReason(f, P, a);
    assert.ok(b.length <= 40 && b.length > 0, `${f.n}: "${b}"`);
    for (const r of a.reasons) { const n = C.shortNote(r, f, P); assert.ok(n.short.split(/\s+/).length <= 12, `${f.n}: "${n.short}"`); }
  }
  assert.equal(C.badgeReason(food("Coffee, black"), P), "nothing to flag");
  assert.equal(C.badgeReason(food("Bacon"), P), "processed meat");
  for (const t of Object.keys(C.TIERS)) assert.match(C.icon(t), /^<svg[^>]*aria-hidden="true"/);
  assert.notEqual(C.TIERS.good.shape, C.TIERS.bad.shape);
});

test("a missing number only counts as 'less certain' when it could change the verdict", () => {
  const S = require("../js/sources.js"), P = V.DEFAULT_PROFILE;
  // Cola without sodium: "Limit it" for its sugar, whatever the sodium.
  const cola = S.makeFood("Cola", "355 ml", { cal: 140, fat: 0, sat: 0, carb: 39, sug: 39, add: 39, pro: 0 }, { missing: ["na", "fib", "chol", "trans"] });
  assert.equal(C.uncertain(cola, P), false);
  // Plain oats without sodium: could be anything from fine to salty, so it matters.
  const oats = S.makeFood("Instant oats", "1 packet (40 g)", { cal: 150, fat: 3, sat: 0.5, carb: 27, fib: 4, sug: 1, add: 0, pro: 5 }, { missing: ["na"] });
  assert.equal(C.uncertain(oats, P), true);
  // Peanut butter without saturated fat: bounded by its 16 g of total fat, which could make it worse.
  const pb = S.makeFood("PB", "32 g", { cal: 190, fat: 16, carb: 7, fib: 2, sug: 3, add: 2, pro: 7, na: 150 }, { missing: ["sat"] });
  assert.equal(C.uncertain(pb, P), true);
  // Water with no fiber listed: nothing missing can move it.
  const water = S.makeFood("Sparkling water", "355 ml", { cal: 0, fat: 0, sat: 0, na: 0, carb: 0, sug: 0, add: 0, pro: 0 }, { missing: ["fib"] });
  assert.equal(C.uncertain(water, P), false);
  // Missing calories always matter.
  assert.equal(C.uncertain(S.makeFood("X", "1", { fat: 1, carb: 1, pro: 1 }, { missing: ["cal"] }), P), true);
});
