// The allergen eval's scorer (eval/allergen-score.js): reading a label's own allergen statement, and the gate on
// collected real labels (eval/allergen-labels.json, when it's been collected).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../eval/allergen-score.js");

const ids = st => [...st.ids].sort();

test("reads a label's own allergen statement", () => {
  assert.deepEqual(ids(S.statement("Sugar, cocoa butter. CONTAINS: MILK, SOY AND WHEAT INGREDIENTS.")), ["milk", "soy", "wheat"]);
  assert.deepEqual(ids(S.statement("Peanuts, salt. Allergens: peanuts, tree nuts (almonds).")), ["peanut", "treenut"]);
  assert.deepEqual(ids(S.statement("Shrimp, flour. Contains: Crustacean Shellfish (Shrimp), Wheat")), ["shellfish", "wheat"]);
  assert.deepEqual(ids(S.statement("Water, sugar, contains 2% or less of: salt, milk")), [], "a minor-ingredients marker isn't a statement");
  assert.deepEqual(ids(S.statement("Apple juice. Contains 10% juice.")), []);
  assert.deepEqual(ids(S.statement("Coconut, sugar. Contains: Tree Nuts (Coconut).")), [], "coconut isn't counted as a tree nut");
  assert.doesNotMatch(S.statement("Wheat flour, eggs. Contains: wheat, egg.").rest, /contains/i, "the statement is hidden from the detector");
  // Found on real labels: a sub-ingredient's own "(Contains: Soy)" ends at its bracket; cross-contact isn't a statement.
  const ramen = S.statement("Tocopherol powder (Contains: Soy), Green tea extract, Soy sauce, Sugar");
  assert.deepEqual(ids(ramen), ["soy"]);
  assert.match(ramen.rest, /Soy sauce/, "the rest of the list stays for the detector");
  assert.deepEqual(ids(S.statement("Flavoring (contains alcohol), salt, may contain traces of egg, soy, milk.")), []);
  assert.deepEqual(ids(S.statement("Yogurt. Contains gluten and is manufactured in a line that may contain almonds.")), []);
  assert.deepEqual(ids(S.statement("Milk fat. Contains vegetable fats in addition to cocoa butter.")), []);
});

test("scoring: a hidden statement must be found from the ingredients", () => {
  const s = S.score([
    { source: "t", id: "1", name: "Cookies", ingredients: "Enriched flour (wheat flour, niacin), butter, eggs, soy lecithin. Contains: wheat, milk, egg, soy." },
    { source: "t", id: "2", name: "Mystery bar", ingredients: "Sugar, natural flavor, color. Contains: peanuts." },
  ]);
  assert.equal(s.withStatement, 2);
  assert.equal(s.truth, 5);
  assert.equal(s.found, 4);
  assert.deepEqual(s.misses.map(m => [m.ref, m.id]), [["2", "peanut"]]);
  assert.equal(s.full.length, 0, "with the statement left in, nothing is missed");
});

// Collected with `node eval/allergen-eval.mjs --fetch 800` (or the Allergen eval workflow).
// Labels whose ingredient text can't reveal the allergen, so no detector could find it with the statement hidden.
// The app still flags them: it reads the label's statement too. Each needs a reason.
const UNFINDABLE = {
  "0041570052785:milk": "Blue Diamond Nut Thins: milk is inside \"natural flavors\"; only the statement says so",
  "0021908120232:wheat": "Cascadian Farm cereal: Open Food Facts' ingredient text is incomplete (no wheat or almonds listed)",
  "0021908120232:treenut": "Cascadian Farm cereal: same incomplete ingredient text",
};
const DATA = path.join(__dirname, "..", "eval/allergen-labels.json");
test("real labels: every allergen a label names is flagged, and with the statement hidden only known-unfindable ones are missed", { skip: !fs.existsSync(DATA) && "no eval/allergen-labels.json yet" }, () => {
  const s = S.score(JSON.parse(fs.readFileSync(DATA, "utf8")).labels);
  assert.deepEqual(s.full.map(m => `${m.name}: ${m.id}`), [], "the whole label, statement included, must flag what it names");
  const unexpected = s.misses.filter(m => !UNFINDABLE[`${m.ref}:${m.id}`]).map(m => `${m.name} (${m.ref}): ${m.id}`);
  assert.deepEqual(unexpected, [], "a new miss: fix the detector, or add it to UNFINDABLE with the reason");
  assert.ok(s.warnedRate >= 0.9, `warned ${(s.warnedRate * 100).toFixed(1)}%`);
});

// Diets against Open Food Facts' own reading of the same labels (their gluten tag and vegan/vegetarian analysis).
// Every disagreement left when this was written was read: their errors, non-English text, or a mismatched record.
test("real labels: diets agree with Open Food Facts' analysis at least 95% of the time", { skip: !fs.existsSync(DATA) && "no eval/allergen-labels.json yet" }, () => {
  const s = S.score(JSON.parse(fs.readFileSync(DATA, "utf8")).labels);
  for (const [d, o] of Object.entries(s.diets)) {
    assert.ok(o.compared >= 100, `${d}: only ${o.compared} labels compared`);
    const rate = (o.agree + o.warnedOnly) / o.compared;
    assert.ok(rate >= 0.95, `${d}: ${(rate * 100).toFixed(1)}%; not flagged: ${o.missed.slice(0, 5).map(m => m.name).join("; ")}; false flags: ${o.falseFlags.slice(0, 5).map(m => m.name).join("; ")}`);
  }
});
