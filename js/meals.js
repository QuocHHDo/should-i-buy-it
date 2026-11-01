// Cheap meal ideas: a protein food, a fruit or vegetable, and optionally a grain, built from the app's own foods.
// An idea must be rated "Get it" as a meal (the same assessMeal verdict as the plate), reach a protein target and fit
// a budget at typical prices. Only foods with a typical price are used, so every idea has a cost.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"), require("./prices.js"));
  else root.SelfCheckMeals = factory(root.SelfCheckVerdict, root.SelfCheckPrices);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (V, PR) {
  const PROTEIN_CATS = new Set(["meat", "seafood", "plant", "dairy", "protein"]);
  // Not a meal's main protein: drinks, spreads and toppings.
  const NOT_MAIN = /milk|cheese|butter|ice cream|yogurt, flavored|cream/i;
  const STARCH = /rice|pasta|bread|potato|tortilla|oat|quinoa/i;
  // Vegetables that work as a side; condiments and canned purée don't.
  const NOT_SIDE = /sauerkraut|pickle|olive|salsa|kimchi|pumpkin|paste|juice|dried|chips/i;
  const MULTS = [1, 1.5, 2];
  const EGG_MULTS = [2, 3]; // priced per egg

  // Foods split into roles. Exported for tests.
  function roles(foods, p, own = {}) {
    const ok = f => PR.price(f, own) && V.assess(f, p).tier !== "skip" && !(p.mild && (f.tags || []).includes("spicy"));
    const usable = foods.filter(f => !f.src && ok(f));
    return {
      protein: usable.filter(f => PROTEIN_CATS.has(f.c) && !NOT_MAIN.test(f.n) && (f.pro || 0) >= 5),
      produce: usable.filter(f => f.c === "veg" && !STARCH.test(f.n) && !NOT_SIDE.test(f.n)),
      starch: usable.filter(f => f.c === "grains" || (f.c === "veg" && STARCH.test(f.n))),
    };
  }

  // opts: { budget ($ per meal), protein (g per meal), own (the user's prices), max (ideas returned) }
  function ideas(foods, p, opts = {}) {
    const budget = opts.budget ?? 3, protein = opts.protein ?? Math.round(p.pro / 3), max = opts.max ?? 6, own = opts.own || {};
    const R = roles(foods, p, own);
    const minCal = p.cal * V.MEAL_SHARE * 0.5;
    const cost = (f, m) => PR.price({ ...f, mult: m }, own).cost;
    const found = [];
    for (const pf of R.protein) {
      const mults = /^eggs?$/i.test(pf.n) || pf.n === "Eggs" ? EGG_MULTS : MULTS;
      for (const pm of mults) {
        const pc = cost(pf, pm);
        if (pc >= budget) continue;
        for (const vf of R.produce) {
          const vc = pc + cost(vf, 1);
          if (vc > budget) continue;
          for (const sf of [null, ...R.starch]) {
            const c = sf ? vc + cost(sf, 1) : vc;
            if (c > budget) continue;
            const items = [{ food: pf, mult: pm }, { food: vf, mult: 1 }, ...(sf ? [{ food: sf, mult: 1 }] : [])];
            const plate = V.combine(items, "Meal idea");
            // Enough food to be a meal: not under half of a meal's calories (what the plate verdict calls "a light meal").
            if (plate.pro < protein || plate.cal < minCal) continue;
            const a = V.assessMeal(plate, p);
            if (a.tier !== "good") continue;
            found.push({ items, cost: c, plate, verdict: a, score: a.score });
          }
        }
      }
    }
    // Cheapest first, then higher score. For variety: one idea per protein food, each vegetable once, each grain twice.
    found.sort((x, y) => x.cost - y.cost || y.score - x.score || y.plate.pro - x.plate.pro);
    const out = [], usedP = new Set(), usedV = new Set(), usedS = {};
    for (const i of found) {
      const pn = i.items[0].food.n, vn = i.items[1].food.n, sn = i.items[2] ? i.items[2].food.n : "";
      if (usedP.has(pn) || usedV.has(vn) || (sn && (usedS[sn] || 0) >= 2)) continue;
      usedP.add(pn); usedV.add(vn); if (sn) usedS[sn] = (usedS[sn] || 0) + 1;
      out.push(i);
      if (out.length >= max) break;
    }
    return out;
  }

  return { ideas, roles };
});
