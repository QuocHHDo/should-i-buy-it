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

  // The shortlist: several products side by side. cols: [{ food (already scaled to the basis), verdict, price, value }].
  // Each row marks the best column when it's meaningfully better than the worst (same rule as two-way compare), and
  // only when every product reports that nutrient. carbLimit adds a net-carb row (less is better).
  const TIER_RANK = { good: 3, fine: 2, mid: 1, bad: 0, skip: -1 };
  function table(cols, { carbLimit = 0, perKcal = null } = {}) {
    const pick = (vals, dir, k) => {
      if (!dir || vals.some(v => v == null) || vals.length < 2) return -1;
      const best = dir === "more" ? Math.max(...vals) : Math.min(...vals), worst = dir === "more" ? Math.min(...vals) : Math.max(...vals);
      if (!(k ? V.meaningfulDiff(k, best, worst) : best !== worst)) return -1;
      const i = vals.indexOf(best);
      return vals.indexOf(best, i + 1) === -1 ? i : -1; // a tie for best marks nobody
    };
    const out = [];
    const ranks = cols.map(c => TIER_RANK[c.verdict.tier] ?? 0);
    const top = Math.max(...ranks);
    out.push({ label: "Verdict", kind: "verdict", values: cols.map(c => c.verdict), best: ranks.filter(r => r === top).length === 1 ? ranks.indexOf(top) : -1 });
    const prices = cols.map((c, i) => c.price ? (perKcal ? perKcal[i] : c.price.cost) : null);
    if (prices.some(v => v != null)) {
      const known = prices.every(v => v != null), lo = known ? Math.min(...prices) : 0, hi = known ? Math.max(...prices) : 0;
      out.push({ label: cols.every(c => !c.price || c.price.mine) ? "Price" : "Typical price", kind: "money", values: prices,
        best: known && hi - lo >= Math.max(0.05, 0.1 * hi) ? pick(prices, "less", null) : -1 });
    }
    const vals = cols.map(c => c.value && c.value.k === "pro" ? c.value.v : null);
    if (vals.filter(v => v != null).length >= 2) out.push({ label: "Protein per $1", kind: "grams", values: vals,
      best: vals.every(v => v != null) && Math.max(...vals) - Math.min(...vals) >= 0.1 * Math.max(...vals) ? pick(vals, "more", null) : -1 });
    const unknownIn = (f, k) => V.isMissing(f, k) || V.isLowerBound(f, k);
    for (const [label, k, unit, dir] of ROWS) {
      const values = cols.map(c => unknownIn(c.food, k) ? null : c.food[k]);
      out.push({ label, k, unit, dir, kind: "nutrient", values, best: pick(values, dir, k) });
      if (k === "carb" && carbLimit > 0) {
        const net = cols.map(c => V.netCarb(c.food));
        out.push({ label: "Net carbs", k: "net", unit: " g", dir: "less", kind: "nutrient", values: net, best: pick(net, "less", "carb") });
      }
    }
    return out;
  }

  return { ROWS, rows, priceRows, summary, table };
});
