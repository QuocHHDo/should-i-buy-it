// js/target.js: reading Target product pages (the product record in the page data, with its Nutrition Facts).
// The records are from live target.com pages (Nov 5, 2026), trimmed to what the reader uses.
const { test } = require("node:test");
const assert = require("node:assert");
const T = require("../js/target.js");
const W = require("../js/walmart.js");
const V = require("../js/verdict.js");
const { FOODS } = require("../js/foods.js");
const F = require("./fixtures/target-live.json").pages;

// The page as Target serves it: the record sits deep in the saved query results of __NEXT_DATA__, next to
// records of recommended products.
const other = { __typename: "Product", tcin: "99999999", item: { product_description: { title: "Something else" } } };
const html = id => `<!doctype html><html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: {}, dehydratedState: { queries: [{ state: { data: { recs: [other] } } }, { state: { data: { data: { data_source_modules: [{}, { module_data: { data: { product: F[id].product } } }] } } } }] } } })}</script></body></html>`;
const read = id => T.product(html(id), F[id].url);

test("product ids from Target's addresses; other pages have none", () => {
  assert.equal(T.productId("https://www.target.com/p/adams-peanut-butter-100-natural-crunchy-peanut-butter-26oz/-/A-47952194"), "47952194");
  assert.equal(T.productId("https://www.target.com/p/coca-cola-12pk-12-fl-oz-cans/-/A-12953464?preselect=12953464#lnk=sametab"), "12953464");
  assert.equal(T.productId("https://www.target.com/p/x/-/A-1002758810"), "1002758810");
  assert.equal(T.productId("https://www.target.com/s?searchTerm=cheerios"), null);
  assert.equal(T.productId("https://www.target.com/c/grocery/-/N-5xt1a"), null);
});

test("peanut butter: the product's own record (not a recommended one), entities decoded, panel read", () => {
  const p = read("47952194");
  assert.equal(p.id, "47952194");
  assert.equal(p.name, "Adam's 100% Natural Crunchy Peanut Butter - 26oz");
  assert.equal(p.upc, "051500710203");
  assert.equal(p.brand, "Adams Peanut Butter");
  assert.deepEqual(p.category, ["Grocery", "Pantry", "Spreads, Jams & Nut Butters", "Nut & Seed Butters", "Peanut Butter"]);
  assert.match(p.ingredients, /^PEANUTS/);
  assert.ok(p.images.length && p.images.every(u => u.startsWith("https://target.scene7.com/")));
  const pl = T.plan(p);
  assert.equal(pl.kind, "panel");
  const f = pl.food;
  assert.equal(f.src, "target");
  assert.equal(f.s, "2 Tbsp");
  assert.deepEqual([f.cal, f.fat, f.sat, f.na, f.carb, f.fib, f.sug, f.add, f.pro], [190, 16, 3, 95, 7, 3, 2, 0, 8]);
  assert.deepEqual(f.missing, []);
});

test("units spelled any way Target spells them (g or grm, Cal, kcal or calories), and grams from the description", () => {
  const chips = T.plan(read("14930839")).food;
  assert.equal(chips.s, "15 chips (28g)");
  assert.deepEqual([chips.cal, chips.fat, chips.sat, chips.na, chips.carb, chips.pro], [160, 10, 1.5, 140, 15, 2]);
  const whey = T.plan(read("1002758810")).food;
  assert.equal(whey.cal, 140);
  assert.equal(whey.pro, 25);
  assert.equal(T.plan(read("12953464")).food.s, "355 mL");
  assert.equal(T.plan(read("47994392")).food.s, "0.25 pizza (139g)");
});

test("every captured page takes the expected route, with the expected verdict for standard goals", () => {
  const want = {
    "47952194": ["panel", "good"], // peanut butter
    "94967407": ["panel", "good"], // Cheerios cup
    "79543780": ["panel", "good"], // 20 g protein yogurt drink
    "1002758810": ["panel", "good"], // whey protein: a Nutrition Facts panel keeps it a food, though it's filed under Health
    "12953464": ["panel", "bad"], // cola: 39 g added sugar
    "47994392": ["panel", "bad"], // frozen pizza: 1140 mg sodium, 8 g saturated fat
    "14930839": ["panel", "mid"], // potato chips
    "50281458": ["supplement"], // vitamin D3 softgels
    "94669568": ["name"], // baby carrots: no barcode, no panel
    "80818627": ["none"], // after-sun gel (it lists ingredients, but it isn't food)
  };
  for (const [id, [kind, tier]] of Object.entries(want)) {
    const pl = T.plan(read(id));
    assert.equal(pl.kind, kind, `${id} route`);
    if (tier) assert.equal(V.assess(pl.food, V.DEFAULT_PROFILE).tier, tier, `${id} verdict`);
  }
});

test("produce: Target's \"Name - Brand™\" titles match the app's typical values by name", () => {
  const pl = T.plan(read("94669568"));
  assert.equal(pl.query, "Baby-Cut Carrots");
  assert.equal(W.byName(pl.query, FOODS).n, "Carrots");
});

test("non-food pages keep no ingredients and get no verdict", () => {
  const p = read("80818627");
  assert.equal(p.ingredients, "");
  assert.deepEqual(T.plan(p), { kind: "none", why: "Not a food." });
});

test("the store: Target's name, search link and host", () => {
  assert.equal(W.storeOf("www.target.com").id, "target");
  assert.equal(W.storeSearch("oat milk", "target"), "https://www.target.com/s?searchTerm=oat%20milk");
});

test("Target's price, read from the page: the item and its unit price", () => {
  const box = { textContent: "$4.79 ($0.18/ounce) When purchased online" };
  const priceEl = { textContent: "$4.79", closest: () => box, parentElement: box };
  const doc = { querySelector: s => s === '[data-test="product-price"]' ? priceEl : null };
  assert.deepEqual(T.priceOf(doc), { now: 4.79, perUnit: 0.18, unit: "oz", text: "$0.18/oz" });
  assert.equal(T.priceOf({ querySelector: () => null }), null);
  // From fetched HTML (a page changed without reloading) there's no price: it loads after the page.
  assert.equal(read("47952194").price, null);
});
