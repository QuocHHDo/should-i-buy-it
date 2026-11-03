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

// Collected with `node eval/allergen-eval.mjs --fetch 300` (or the Allergen eval workflow). Until then, skipped.
const DATA = path.join(__dirname, "..", "eval/allergen-labels.json");
test("real labels: every allergen a label names is flagged, and recall from ingredients stays high", { skip: !fs.existsSync(DATA) && "no eval/allergen-labels.json yet" }, () => {
  const s = S.score(JSON.parse(fs.readFileSync(DATA, "utf8")).labels);
  assert.deepEqual(s.full.map(m => `${m.name}: ${m.id}`), [], "the whole label, statement included, must flag what it names");
  assert.ok(s.recall >= 0.95, `recall ${(s.recall * 100).toFixed(1)}%; misses: ${s.misses.slice(0, 10).map(m => `${m.name}: ${m.id}`).join("; ")}`);
});
