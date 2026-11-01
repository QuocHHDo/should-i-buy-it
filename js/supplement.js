// Dietary supplements (pre-workouts, vitamins, capsules): they carry a Supplement Facts label, not Nutrition Facts, and
// aren't scored like food. What the app shows instead: caffeine per serving against the 400 mg a day the FDA cites for
// healthy adults, sodium and sugar if any, the sweeteners and other active ingredients as listed, and a plain note that
// the app doesn't judge whether a supplement works. Pure functions, shared by the extension and the app.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ingredients.js"));
  else root.SelfCheckSupplement = factory(root.SelfCheckIngredients);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (ING) {
  const CAFFEINE_DAY = 400; // mg: FDA, "Spilling the Beans: How Much Caffeine is Too Much?"
  const CAFFEINE_SRC = "https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much";
  const SUPP_CATEGORY = /supplement|vitamins?\b|sports nutrition|pre-?workout|nutrition & fitness|herbal|minerals?\b|probiotics?/i;
  const SUPP_NAME = /pre[- ]?workout|\bsupplement|\bcapsules?\b|softgels?|\btablets?\b|caplets?|multivitamin|\bcreatine\b|\bbcaa\b|amino energy|fat burner|thermogenic|probiotic|\bcollagen peptides\b|electrolyte (?:powder|capsules)|vitamin [a-k]\d*\b(?!.*(?:water|cereal|juice))/i;
  // Standard nutrients: everything else on a Supplement Facts label is an "active" ingredient as far as the app shows.
  const STANDARD = /^(?:calories?|total fat|sat(?:urated)?\.? fat|trans fat|cholest(?:erol)?|sodium|(?:total )?carb(?:ohydrate)?s?|(?:dietary )?fiber|(?:total |incl\.? |includes )?(?:added )?sugars?|protein|servings? per container|serving size)/i;

  // Is this product a supplement? From the label type when known, else its category, name, ingredient list or the
  // Open Food Facts categories. Products with a real Nutrition Facts panel (protein powder with 120 calories) stay food.
  function isSupplement({ category = [], name = "", ingredients = "", offTags = [], rows = [], hasNutritionFacts = false } = {}) {
    if (hasNutritionFacts) return false;
    if (category.some(c => SUPP_CATEGORY.test(c))) return true;
    if (offTags.some(t => /dietary-supplements|food-supplements|sports-supplements|vitamins/.test(t))) return true;
    if (SUPP_NAME.test(name)) return true;
    if (/^\s*other ingredients\s*:/i.test(ingredients)) return true; // the Supplement Facts label's wording
    return rows.length > 0 && rows.some(r => /caffeine|vitamin|beta-alanine|citrulline|creatine/i.test(r.name)) && !rows.some(r => /^calories?$/i.test(r.name) && Number.parseFloat(r.amount) >= 20);
  }

  // "200mg", "5 mcg", "3.2g", "1 g" → { v, u }.
  const amt = s => { const m = String(s == null ? "" : s).toLowerCase().replace(/,/g, "").match(/([\d.]+)\s*(mcg|µg|mg|g|iu|kcal|cal)?\b/); return m ? { v: Number(m[1]), u: (m[2] || "").replace("µg", "mcg") } : null; };
  const mg = a => !a ? null : a.u === "g" ? a.v * 1000 : a.u === "mcg" ? a.v / 1000 : a.u === "mg" || !a.u ? a.v : null;

  // Caffeine per serving: from the label's row, else from the product name ("200mg Caffeine"), else unknown.
  function caffeine(rows, name, ingredients) {
    const row = rows.find(r => /caffeine/i.test(r.name));
    if (row) { const v = mg(amt(row.amount)); if (v != null) return { mg: Math.round(v), from: "label" }; }
    const m = String(name || "").match(/(\d{2,4})\s*mg\s*(?:of\s+)?(?:natural\s+)?caffeine|caffeine[^\d]{0,15}(\d{2,4})\s*mg/i);
    if (m) return { mg: Number(m[1] || m[2]), from: "name" };
    if (row || /\bcaffeine\b/i.test(ingredients || "") || /\bcaffeine\b(?!.?free)/i.test(name || "")) return { mg: null, from: "listed" };
    return null;
  }

  // Everything the views show. `rows` are the Supplement Facts lines ({ name, amount, dvp }), possibly empty when the
  // page only has a photo of the label.
  function analyze({ name = "", rows = [], ingredients = "", serving = "" } = {}) {
    const fromLabel = rows.length > 0;
    const pick = re => rows.find(r => re.test(r.name));
    // On a Supplement Facts label, nutrients left off are present in amounts that round to zero (FDA 21 CFR 101.36).
    const naRow = pick(/^sodium/i), sugRow = pick(/^(?:total )?sugars?$/i), addRow = pick(/added sugars?/i), calRow = pick(/^calories?$/i);
    const sodium = naRow ? mg(amt(naRow.amount)) : fromLabel ? 0 : null;
    const sugar = sugRow ? (amt(sugRow.amount) || {}).v : fromLabel ? 0 : null;
    const added = addRow ? (amt(addRow.amount) || {}).v : sugar === 0 ? 0 : null;
    const calories = calRow ? (amt(calRow.amount) || {}).v : fromLabel ? 0 : null;
    const caf = caffeine(rows, name, ingredients);
    const actives = rows.filter(r => !STANDARD.test(String(r.name).trim()) && !/caffeine/i.test(r.name)).map(r => ({ name: tidy(r.name), amount: String(r.amount || "").trim(), dvp: String(r.dvp || "").trim() }));
    const ingr = ING && ingredients ? ING.analyze(ingredients, name) : null;
    const sweet = ingr ? ingr.groups.filter(g => g.key === "sweetener" || g.key === "sugar").flatMap(g => g.items.map(i => i.name)) : [];
    return {
      fromLabel, serving, calories, sodium, sugar, added, actives, sweeteners: sweet, ingredients: ingr,
      caffeine: caf ? { ...caf, share: caf.mg != null ? caf.mg / CAFFEINE_DAY : null } : null,
      reason: caf && caf.mg != null ? `${caf.mg} mg caffeine` : caf ? "contains caffeine" : "not scored like food",
    };
  }
  // "Caffeine (as Green Coffee (Coffea spp.) (Bean) Extract)" → "Caffeine"; "Vitamin B12 (as Methylcobalamin)" stays.
  const tidy = n => String(n).replace(/\s+/g, " ").trim().replace(/^(\w[\w -]{1,30}?) \((?:from|as) [^)]*(?:\([^)]*\)[^)]*)*\)$/i, (m, a) => /vitamin|folate|niacin/i.test(a) ? m : a);

  // Notes for the view, at most 12 words each, with the longer explanation behind "more".
  function notes(s) {
    const out = [];
    if (s.caffeine && s.caffeine.mg != null) {
      const pct = Math.round(s.caffeine.share * 100);
      out.push({ k: s.caffeine.mg >= 200 ? "warn" : "note", short: `${s.caffeine.mg} mg caffeine: ${pct}% of the FDA's 400 mg daily figure`,
        full: `The FDA cites 400 mg a day as an amount not generally linked to negative effects in healthy adults. Coffee, tea, soda and energy drinks count toward it too. The figure isn't for pregnancy, teens or people sensitive to caffeine.${s.caffeine.from === "name" ? " This amount comes from the product's name; check the label." : ""}`, src: CAFFEINE_SRC });
    } else if (s.caffeine) out.push({ k: "note", short: "Contains caffeine; the amount isn't listed here", full: "Check the label for the amount. The FDA cites 400 mg a day for healthy adults, from all sources together." });
    if (s.sweeteners.length) out.push({ k: "note", short: `Sweetened with ${s.sweeteners.slice(0, 3).join(", ").toLowerCase()}`, full: "Sugars count toward your added-sugar limit; low- and no-calorie sweeteners don't, though the WHO advises against relying on them for weight control." });
    out.push({ k: "note", short: "The app doesn't judge whether a supplement works", full: "Supplements aren't approved by the FDA for safety or effectiveness before they're sold. Third-party testing seals (NSF, Informed Sport, USP) show what's in the tub, not whether it helps." });
    return out;
  }

  return { isSupplement, analyze, notes, caffeine, CAFFEINE_DAY, CAFFEINE_SRC };
});
