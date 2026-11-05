// Search: typo tolerance (item 12) and never silently substituting a different food (item 13).
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../js/search.js");
const { FOODS } = require("../js/foods.js");

test("12: typos still find the food, offered as 'Did you mean'", () => {
  const r = Q.resolve("chiken brest", FOODS);
  assert.equal(r.kind, "choose");
  assert.equal(r.typo, true);
  assert.equal(r.near[0].n, "Chicken breast, grilled");
  for (const [typed, want] of [["avacado", "Avocado"], ["bananna", "Banana"], ["strawbery", "Strawberries"], ["salmn", "Salmon"], ["grek yogurt", "Greek yogurt, plain nonfat"]]) {
    const near = Q.resolve(typed, FOODS).near.map(f => f.n);
    assert.ok(near.includes(want), `${typed} → ${near.join(", ")}`);
  }
});

test("12: typo matching doesn't invent matches for short or unrelated words", () => {
  assert.deepEqual(Q.resolve("xyz", FOODS).near, []);
  assert.deepEqual(Q.resolve("durian", FOODS).near, []);
  assert.equal(Q.editDistance("chiken", "chicken"), 1);
  assert.equal(Q.editDistance("brest", "breast"), 1);
  assert.equal(Q.editDistance("form", "from"), 1); // adjacent swap counts as one edit
});

test("12: exact names, aliases and single strong matches still open directly", () => {
  for (const [typed, want] of [["Avocado", "Avocado"], ["chicken breast", "Chicken breast, grilled"], ["80/20", "Ground beef 80/20"], ["oatmeal", "Oatmeal, rolled oats"]]) {
    const r = Q.resolve(typed, FOODS);
    assert.equal(r.kind, "open", typed); assert.equal(r.food.n, want, typed);
  }
});

test("13: a query that only contains a food's name is a labeled closest match, not a silent swap", () => {
  const r = Q.resolve("kirkland protein bar", FOODS);
  assert.equal(r.kind, "closest");
  assert.equal(r.food.n, "Protein bar");
  assert.equal(Q.resolve("organic baby spinach", FOODS).kind, "closest");
  // Every built-in name and alias still opens itself.
  for (const f of FOODS) {
    const r2 = Q.resolve(f.n, FOODS);
    assert.ok(r2.kind === "open" && r2.food.n === f.n, `${f.n} → ${r2.kind} ${r2.food && r2.food.n}`);
  }
});

// Titles copied from store websites (Walmart, Target, Amazon, Costco, Kroger): sizes and packaging words are left out,
// and the closest built-in food is the most specific name the title holds.
test("pasted store titles are cleaned and find the right built-in food", () => {
  assert.equal(Q.cleanTitle("Great Value Whole Vitamin D Milk, Gallon, 128 fl oz"), "Great Value Whole Vitamin D Milk");
  assert.equal(Q.cleanTitle("Tyson All Natural Boneless Skinless Chicken Breasts, 3 lb Bag (Frozen)"), "Tyson All Natural Boneless Skinless Chicken Breasts");
  assert.equal(Q.cleanTitle("Coca-Cola Soda Pop, 12 fl oz, 12 Pack Cans"), "Coca-Cola Soda Pop");
  assert.equal(Q.cleanTitle("Good & Gather Baby Spinach - 5oz"), "Good & Gather Baby Spinach");
  assert.equal(Q.cleanTitle("Pack of 6 - Starbucks Frappuccino Mocha 13.7 fl oz"), "Starbucks Frappuccino Mocha");
  assert.equal(Q.cleanTitle("Amazon Fresh, Large Grade A Eggs, 12 Ct"), "Amazon Fresh, Large Grade A Eggs", "\"eggs\" stays: it's the food");
  for (const [title, want] of [
    ["Chobani Non-Fat Greek Yogurt, Plain 32 oz Tub", "Greek yogurt, plain nonfat"],
    ["Lay's Classic Potato Chips, Party Size, 13 oz Bag", "Potato chips"],
    ["Kirkland Signature Organic Peanut Butter, 28 oz, 2-count", "Peanut butter"],
    ["OREO Chocolate Sandwich Cookies, Family Size, 18.12 oz", "Sandwich cookies"],
    ["Nature Valley Crunchy Granola Bars, Oats 'n Honey, 12 ct", "Granola bar, chewy"],
    ["Simply Orange Pulp Free Orange Juice, 52 fl oz", "Orange juice"],
    ["Philadelphia Original Cream Cheese Spread, 8 oz Tub", "Cream cheese"],
    ["Tyson All Natural Boneless Skinless Chicken Breasts, 3 lb Bag (Frozen)", "Chicken breast, grilled"],
    ["Quest Nutrition Chocolate Chip Cookie Dough Protein Bar, 12 Count", "Protein bar"],
    ["Avocados, Each", "Avocado"],
  ]) {
    const r = Q.resolve(title, FOODS);
    assert.ok(r.food, `${title} → ${r.kind} ${(r.near || []).map(f => f.n).join(", ")}`);
    assert.equal(r.food.n, want, title);
  }
});

test("only titles that look pasted go to the product search; typed searches don't", () => {
  for (const t of ["Lay's Classic Potato Chips, Party Size, 13 oz Bag", "Simply Orange Pulp Free Orange Juice, 52 fl oz", "Hass Avocados, 4 ct Bag", "Ben & Jerry's Chocolate Fudge Brownie Ice Cream Pint", "Dave's Killer Bread 21 Whole Grains and Seeds Organic Bread"])
    assert.ok(Q.looksLikeProduct(t), t);
  for (const t of ["chicken breast", "2% milk", "80/20", "greek yogurt", "kirkland protein bar", "chiken brest", "salmon"])
    assert.ok(!Q.looksLikeProduct(t), t);
  assert.equal(Q.resolve("80/20", FOODS).food.n, "Ground beef 80/20", "a query that cleans to nothing is searched as typed");
});
