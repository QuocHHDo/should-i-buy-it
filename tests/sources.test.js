// Conversions from USDA FoodData Central and Open Food Facts responses.
// The fixtures follow the documented response shapes; the live APIs are not called in tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/sources.js");
const V = require("../js/verdict.js");
const usda = require("./fixtures/usda-search.json");

test("USDA SR Legacy item maps nutrients per 100 g", () => {
  const f = S.fromUsda(usda.foods[0]);
  assert.equal(f.n, "Avocados, Raw, All Commercial Varieties");
  assert.equal(f.s, "100 g");
  assert.equal(f.src, "usda");
  assert.equal(f.fdcId, 171705);
  assert.deepEqual([f.cal, f.pro, f.fat, f.sat, f.carb, f.fib, f.sug, f.na, f.chol], [160, 2, 14.7, 2.1, 8.5, 6.7, 0.7, 7, 0]);
  assert.equal(f.add, 0);
});

test("USDA Foundation item falls back to Atwater energy and missing nutrients become 0", () => {
  const f = S.fromUsda(usda.foods[1]);
  assert.equal(f.cal, 107);
  assert.equal(f.pro, 22.5);
  assert.equal(f.fib, 0);
  assert.equal(V.assess(f, V.DEFAULT_PROFILE).word, "Get it");
});

test("cured meats from USDA are tagged as processed", () => {
  const f = S.fromUsda(usda.foods[2]);
  assert.ok(f.tags.includes("processed"));
  assert.equal(V.assess(f, V.DEFAULT_PROFILE).word, "Limit it");
});

test("USDA detail-endpoint shape (nested nutrient, amount) also maps", () => {
  const f = S.fromUsda({ fdcId: 1, description: "TEST FOOD", foodNutrients: [
    { nutrient: { id: 1008, unitName: "kcal" }, amount: 50 }, { nutrient: { id: 1003, unitName: "g" }, amount: 4 } ] });
  assert.equal(f.cal, 50); assert.equal(f.pro, 4);
});

test("Open Food Facts product uses per-serving values and converts grams of sodium to mg", () => {
  const f = S.fromOff("0123456789012", {
    product_name: "Plain Greek Yogurt", brands: "Fage,Fage Total", serving_size: "1 container (170 g)",
    nutriments: {
      "energy-kcal_serving": 100, "fat_serving": 0, "saturated-fat_serving": 0, "carbohydrates_serving": 6, "sugars_serving": 5,
      "added-sugars_serving": 0, "fiber_serving": 0, "proteins_serving": 18, "sodium_serving": 0.065, "cholesterol_serving": 0.01,
      "energy-kcal_100g": 59,
    },
  });
  assert.equal(f.n, "Fage Plain Greek Yogurt");
  assert.equal(f.s, "1 container (170 g)");
  assert.deepEqual([f.cal, f.pro, f.na, f.chol], [100, 18, 65, 10]);
  assert.equal(f.partial, false);
});

test("Open Food Facts falls back to per-100 g values and estimates sodium from salt", () => {
  const f = S.fromOff("4000000000000", { product_name: "Mystery Crackers", nutriments: { "energy-kcal_100g": 450, "fat_100g": 15, "carbohydrates_100g": 70, "proteins_100g": 9, "salt_100g": 2 } });
  assert.equal(f.s, "100 g (no serving size on file)");
  assert.equal(f.na, 800);
  assert.equal(f.partial, true);
});

test("makeFood leaves out numbers no label can have, and says why; rounding overshoots are clamped", () => {
  const f = S.makeFood("Odd food", "1 cup", { cal: 100, fat: 2, sat: 5, sug: 1, add: 3, pro: -4 });
  assert.ok(f.missing.includes("sat") && f.missing.includes("add") && f.sat === 0 && f.add === 0 && f.pro === 0);
  assert.ok(f.issues.some(t => /saturated fat 5 g, more than the 2 g of total fat/.test(t)) && f.issues.some(t => /added sugar 3 g/.test(t)));
  const g = S.makeFood("Rounded", "1 cup", { cal: 50, fat: 1, sat: 1.3, carb: 10, sug: 4, add: 4.3, pro: 1 });
  assert.equal(g.sat, 1); assert.equal(g.add, 4); assert.equal(g.issues, undefined);
});

test("a mistyped crowd-sourced record: Kirkland oat drink on Open Food Facts (Oct 31, 2026)", () => {
  // As the record stood: sodium entered as 240 g a serving, trans fat 12 g with 5 g of fat, cholesterol in an oat
  // drink, and carbs, fiber and sugars 2.4x the label's (40.8 g of carbs can't fit in 120 calories).
  const f = S.fromOff("0096619237432", { product_name: "Oat", brands: "Kirkland Signature", serving_size: "240g", serving_quantity: 240,
    categories_tags: ["en:beverages", "en:plant-based-foods-and-beverages", "en:dairy-substitutes"],
    nutriments: { "energy-kcal_serving": 120, fat_serving: 5, "saturated-fat_serving": 0.5, "trans-fat_serving": 12, cholesterol_serving: 0.0408, sodium_serving: 240, salt_serving: 600,
      carbohydrates_serving: 40.8, fiber_serving: 4.8, sugars_serving: 16.8, "added-sugars_serving": 0, proteins_serving: 3 } });
  assert.deepEqual([...f.missing].sort(), ["chol", "na", "trans"]);
  assert.ok(f.na === 0 && f.trans === 0 && f.chol === 0 && f.partial);
  assert.deepEqual(f.issues, ["sodium 240,000 mg in a 240 g serving", "trans fat 12 g, more than the 5 g of total fat", "cholesterol 41 mg in a plant-based drink",
    "fat, carbs and protein add up to about 211 calories, not the 120 listed"]);
  // Real labels pass untouched: the Nutella and peanut butter records the tests already use.
  const nutella = S.fromOff("3017620422003", require("./fixtures/off-nutella.json").product);
  assert.equal(nutella.issues, undefined);
});

test("API URLs are built correctly", () => {
  const u = new URL(S.usdaSearchUrl("greek yogurt", "abc"));
  assert.equal(u.hostname, "api.nal.usda.gov");
  assert.equal(u.searchParams.get("query"), "greek yogurt");
  assert.equal(u.searchParams.get("api_key"), "abc");
  assert.equal(new URL(S.usdaSearchUrl("x")).searchParams.get("api_key"), "DEMO_KEY");
  assert.match(S.offProductUrl("737628064502"), /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/737628064502\.json/);
});

test("16: USDA titles keep minor words lowercase", () => {
  assert.equal(S.titleCase("CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY, COOKED, ROASTED"), "Chicken, Broilers or Fryers, Breast, Meat Only, Cooked, Roasted");
  assert.equal(S.titleCase("BEANS, BLACK, MATURE SEEDS, CANNED, LOW SODIUM"), "Beans, Black, Mature Seeds, Canned, Low Sodium");
  assert.equal(S.titleCase("of the sea and land"), "Of the Sea and Land"); // first word is always capitalized
  assert.equal(S.titleCase("YOGURT, GREEK, PLAIN, WITH FRUIT"), "Yogurt, Greek, Plain, with Fruit");
});

test("16: looked-up foods get shareable ids that survive a fresh browser", () => {
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.equal(S.linkId({ n: "X", src: "usda", fdcId: 171705 }, slug), "usda-171705");
  assert.equal(S.linkId({ n: "X", src: "off", code: "3017620422003" }, slug), "off-3017620422003");
  assert.equal(S.linkId({ n: "Ground beef 80/20" }, slug), "ground-beef-80-20");
  assert.deepEqual(S.parseLinkId("#usda-171705"), { kind: "usda", id: 171705 });
  assert.deepEqual(S.parseLinkId("#off-3017620422003"), { kind: "off", code: "3017620422003" });
  assert.deepEqual(S.parseLinkId("#avocado"), { kind: "slug", slug: "avocado" });
  assert.equal(S.parseLinkId("#"), null);
  assert.match(S.usdaFoodUrl(171705, "k"), /\/fdc\/v1\/food\/171705\?api_key=k$/);
});
