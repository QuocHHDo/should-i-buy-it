// js/kroger.js: Kroger product pages. Kroger's addresses end in the item's barcode without its check digit; the
// barcodes here are real ones (read from Target's pages for the same products), so the conversion is checked
// against products, not against itself.
const { test } = require("node:test");
const assert = require("node:assert");
const K = require("../js/kroger.js");
const W = require("../js/walmart.js");
const { FOODS } = require("../js/foods.js");

test("product ids from Kroger's addresses; other pages have none", () => {
  assert.equal(K.productId("https://www.kroger.com/p/cheerios-gluten-free-heart-healthy-cereal/0001600027528"), "0001600027528");
  assert.equal(K.productId("https://www.kroger.com/p/cheerios-gluten-free-heart-healthy-cereal/0001600027528?fulfillment=PICKUP"), "0001600027528");
  assert.equal(K.productId("https://www.kroger.com/search?query=cheerios"), null);
  assert.equal(K.productId("https://www.kroger.com/pl/cereal/12345"), null);
});

test("the address's 13 digits become the product's barcode, check digit included", () => {
  for (const upc of ["016000275287", "049000028904", "028400770088", "016000141599", "051500710203", "689076130677", "818290017710", "085239186756"]) {
    const id = ("0" + upc.slice(0, 11)).padStart(13, "0");
    assert.equal(K.upcOf(id), upc, id);
  }
  // An EAN-13 (a 13-digit barcode): Nutella 400 g, 3017620422003.
  assert.equal(K.upcOf("0301762042200"), "3017620422003");
  // Produce sticker codes stay as they are, so they're matched by name and never looked up.
  assert.equal(K.upcOf("0000000004011"), "0000000004011");
});

test("a product with nothing but its address: the barcode route, and a name from the address", () => {
  const p = K.product("", "https://www.kroger.com/p/cheerios-gluten-free-heart-healthy-cereal/0001600027528");
  assert.equal(p.name, "Cheerios gluten free heart healthy cereal");
  assert.equal(p.upc, "016000275287");
  assert.deepEqual(K.plan(p), { kind: "barcode", code: "016000275287" });
});

test("the page's name, category and price, from its structured data or its title", () => {
  const ld = { "@type": "Product", name: "Cheerios Gluten Free Heart Healthy Cereal", gtin13: "0016000275287", brand: { "@type": "Brand", name: "Cheerios" }, offers: { "@type": "Offer", price: "4.99" } };
  const bc = { "@type": "BreadcrumbList", itemListElement: [{ name: "Home" }, { name: "Breakfast" }, { name: "Cereal" }] };
  const html = `<html><head><title>x</title><script type="application/ld+json">${JSON.stringify(ld)}</script><script type="application/ld+json">${JSON.stringify(bc)}</script></head></html>`;
  const p = K.product(html, "https://www.kroger.com/p/cheerios/0001600027528");
  assert.equal(p.name, "Cheerios Gluten Free Heart Healthy Cereal");
  assert.equal(p.brand, "Cheerios");
  assert.deepEqual(p.category, ["Breakfast", "Cereal"]);
  assert.equal(p.price.now, 4.99);
  assert.equal(p.upc, "0016000275287");
  assert.equal(K.plan(p).kind, "barcode");
  const t = K.product("<html><head><title>Kroger - Coca-Cola Soda 12 Cans, 12 fl oz</title></head></html>", "https://www.kroger.com/p/coca-cola/0004900002890");
  assert.equal(t.name, "Coca-Cola Soda 12 Cans, 12 fl oz");
  assert.equal(t.upc, "049000028904");
});

test("produce and in-store items are matched by name; non-food pages get no verdict", () => {
  const ban = K.product("<title>Banana - Each - Kroger</title>", "https://www.kroger.com/p/banana/0000000004011");
  const pl = K.plan(ban);
  assert.equal(pl.kind, "name");
  assert.equal(W.byName(pl.query, FOODS).n, "Banana");
  // A weighed or priced-in-store item (its code starts with 2) has no barcode a database knows.
  const deli = K.product("", "https://www.kroger.com/p/rotisserie-chicken/0020000000000");
  assert.equal(deli.inStore, true);
  assert.equal(K.plan(deli).kind, "name");
  const bc = { "@type": "BreadcrumbList", itemListElement: [{ name: "Home" }, { name: "Cleaning & Household" }, { name: "Paper Towels" }] };
  const towels = K.product(`<script type="application/ld+json">${JSON.stringify(bc)}</script>`, "https://www.kroger.com/p/bounty/0003700074776");
  assert.deepEqual(K.plan(towels), { kind: "none", why: "Not a food." });
  const d3 = K.product(`<title>Nature Made Vitamin D3 2000 IU Softgels - Kroger</title>`, "https://www.kroger.com/p/nature-made-d3/0003160402316");
  assert.equal(K.plan(d3).kind, "supplement");
});

test("the store: Kroger's name, search link and host", () => {
  assert.equal(W.storeOf("www.kroger.com").id, "kroger");
  assert.equal(W.storeSearch("oat milk", "kroger"), "https://www.kroger.com/search?query=oat%20milk");
});
