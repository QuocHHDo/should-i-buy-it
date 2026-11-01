// Comparing two foods: which nutrients differ meaningfully, the price rows, and the one-line answer. Pure (no DOM), so
// the rules are tested on their own (tests/compare.test.js); js/app.js draws the table.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"));
  else root.SelfCheckCompare = factory(root.SelfCheckVerdict);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (V) {
  // [label, key, unit, which way is better (null: shown, never marked)]
  /** @type {Array<[string, string, string, "more" | "less" | null]>} */
  const ROWS = [
    ["Calories", "cal", "", null], ["Protein", "pro", " g", "more"], ["Fiber", "fib", " g", "more"],
    ["Saturated fat", "sat", " g", "less"], ["Sodium", "na", " mg", "less"], ["Added sugar", "add", " g", "less"],
    ["Total sugars", "sug", " g", null], ["Total carbs", "carb", " g", null], ["Total fat", "fat", " g", null], ["Cholesterol", "chol", " mg", null],
  ];

  // Nutrient rows for a and b (already scaled to the basis being compared). win: 0 (a), 1 (b) or -1 (no meaningful
  // difference: at least 10% apart and at least 5% of the Daily Value, and both known).
  function rows(a, b) {
    return ROWS.map(([label, k, unit, dir]) => {
      const unknown = V.isMissing(a, k) || V.isMissing(b, k) || V.isLowerBound(a, k) || V.isLowerBound(b, k);
      const win = !unknown && dir && V.meaningfulDiff(k, a[k], b[k]) ? ((dir === "more") === (a[k] > b[k]) ? 0 : 1) : -1;
      return { label, k, unit, dir, win, unknown };
    });
  }

  // Price rows from each side's price ({ cost, perServing, mine }, js/prices.js) and protein-per-dollar values
  // ({ k, v }, PR.value): the cheaper serving when at least 10% and 5¢ apart; more protein per dollar when 10% apart.
  function priceRows(pa, pb, va, vb, perKcal) {
    if (!pa || !pb) return [];
    const x = perKcal ? perKcal[0] : pa.cost, y = perKcal ? perKcal[1] : pb.cost;
    const out = [{ label: pa.mine && pb.mine ? "Price" : "Typical price", kind: "money", values: [x, y], win: Math.abs(x - y) >= Math.max(0.05, 0.1 * Math.max(x, y)) ? (x < y ? 0 : 1) : -1 }];
    if (va && vb && va.k === "pro" && vb.k === "pro")
      out.push({ label: "Protein per $1", kind: "grams", values: [va.v, vb.v], win: Math.abs(va.v - vb.v) >= 0.1 * Math.max(va.v, vb.v) ? (va.v > vb.v ? 0 : 1) : -1 });
    return out;
  }

  // "Reduced fat 2% milk has less saturated fat." then the verdicts ("Both: In moderation.").
  const list = xs => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
  function summary(nameA, nameB, nutrientRows, wordA, wordB) {
    const better = [[], []];
    for (const r of nutrientRows) if (r.win >= 0) better[r.win].push(`${r.dir === "more" ? "more" : "less"} ${r.label.toLowerCase()}`);
    const lines = [[nameA, better[0]], [nameB, better[1]]].filter(([, xs]) => xs.length).map(([n, xs]) => `${n} has ${list(xs)}`);
    return { lead: lines.length ? lines.join("; ") + "." : "No meaningful difference in the nutrients that count.",
      verdicts: wordA === wordB ? `Both: ${wordA}.` : `${nameA}: ${wordA}. ${nameB}: ${wordB}.` };
  }

  return { ROWS, rows, priceRows, summary };
});
