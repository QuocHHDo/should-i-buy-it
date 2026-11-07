// "Better in this aisle": for a scanned product, other packaged products in the same Open Food Facts category that
// score better for your goals. Pure: the page fetches the category and hands the parsed foods here.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"), require("./sources.js"));
  else root.SelfCheckAlternatives = factory(root.SelfCheckVerdict, root.SelfCheckSources);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (V, S) {
  "use strict";

  // Categories too broad to compare within: cookies and soda are both "snacks" or "beverages".
  const TOO_BROAD = new Set(["en:snacks", "en:sweet-snacks", "en:salty-snacks", "en:beverages", "en:plant-based-foods-and-beverages", "en:plant-based-foods",
    "en:dairies", "en:groceries", "en:foods", "en:meals", "en:desserts", "en:frozen-foods", "en:breakfasts", "en:condiments", "en:sauces", "en:fermented-foods",
    "en:fermented-milk-products", "en:cereals-and-potatoes", "en:cereals-and-their-products", "en:fruits-and-vegetables-based-foods", "en:meats-and-their-products",
    "en:beverages-and-beverages-preparations", "en:non-alcoholic-beverages", "en:sweeteners", "en:spreads", "en:biscuits-and-cakes", "en:confectioneries", "en:canned-foods"]);
  // The most specific category Open Food Facts gives (its list runs general to specific), skipping broad ones.
  function category(f) {
    const tags = (f && Array.isArray(f.categories) ? f.categories : []).filter(t => /^en:[a-z0-9-]{2,60}$/.test(t) && !TOO_BROAD.has(t));
    return tags.length ? tags[tags.length - 1] : null;
  }
  const categoryName = tag => tag ? tag.replace(/^en:/, "").replace(/-/g, " ") : "";

  // The 40 most-scanned US products in a category. /cgi/search.pl answers browser requests (see sources.js).
  const FIELDS = "code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,categories_tags,additives_tags,nova_group,ingredients_text,ingredients_text_en,allergens_tags,traces_tags,ingredients_analysis_tags";
  const categoryUrl = (tag, size = 40) => "https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({ action: "process", json: "1", page_size: String(size), sort_by: "unique_scans_n",
    tagtype_0: "countries", tag_contains_0: "contains", tag_0: "united-states", tagtype_1: "categories", tag_contains_1: "contains", tag_1: tag, fields: FIELDS });

  // Search results as foods: ones with no nutrition, numbers that can't be right, or the same product twice are left out.
  function parse(data) {
    const out = [], seen = new Set();
    for (const p of data && Array.isArray(data.products) ? data.products : []) {
      if (!p || !p.code || !p.product_name || !p.nutriments) continue;
      const f = S.check(S.fromOff(String(p.code), p), p.categories_tags);
      if (["cal", "fat", "carb", "pro"].some(k => f.missing.includes(k)) || (f.issueKeys && f.issueKeys.length)) continue;
      const key = f.n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); out.push(f);
    }
    return out;
  }

  const RANK = { good: 3, fine: 2, mid: 1, bad: 0, skip: -1 };
  // The clearest reason this one is better: the nutrient with the biggest meaningful improvement for your goals.
  const WHY = [["add", "less added sugar", " g", "less"], ["sat", "less saturated fat", " g", "less"], ["na", "less sodium", " mg", "less"],
    ["fib", "more fiber", " g", "more"], ["pro", "more protein", " g", "more"], ["sug", "less sugar", " g", "less"], ["cal", "fewer calories", "", "less"]];
  function reason(cur, alt, p) {
    const goal = { add: p.add, sat: p.sat, na: p.na, fib: p.fib, pro: p.pro, sug: 50, cal: p.cal };
    let best = null;
    const known = (f, k) => !V.isMissing(f, k) && !V.isLowerBound(f, k);
    const net = p.carb > 0 ? [V.netCarb(cur), V.netCarb(alt)] : null;
    // Net carbs matter against your own limit: a gap of 10% of it counts (2.5 g on a 25 g keto limit).
    if (net && net[0] != null && net[1] != null && net[0] - net[1] >= Math.max(1, 0.1 * p.carb) && net[0] - net[1] >= 0.1 * net[0]) best = { gain: (net[0] - net[1]) / p.carb, t: `fewer net carbs: ${V.fmt(net[1])} g vs ${V.fmt(net[0])} g` };
    for (const [k, words, unit, dir] of WHY) {
      if (!known(cur, k) || !known(alt, k) || !V.meaningfulDiff(k, cur[k], alt[k])) continue;
      const d = dir === "less" ? cur[k] - alt[k] : alt[k] - cur[k];
      if (d <= 0) continue;
      const gain = d / (goal[k] || 1) * (k === "cal" || k === "sug" ? 0.5 : 1); // calories and total sugar count for less than the limits
      const n = x => k === "na" ? Math.round(x).toLocaleString("en-US") : V.fmt(x);
      if (!best || gain > best.gain) best = { gain, t: `${words}: ${n(alt[k])}${unit} vs ${n(cur[k])}${unit}` };
    }
    return best ? best.t : null;
  }

  // Up to `max` products that are clearly better: a higher verdict, or the same verdict with at least 2 more points.
  // Products your allergies or diet rule out (blocked(f) true) are skipped. Best verdict first, then score, then
  // how often people scan it (the order Open Food Facts gave).
  function better(cur, foods, p, { blocked = /** @type {(f: any) => boolean} */ (() => false), max = 3 } = {}) {
    const a = V.assess(cur, p), mine = RANK[a.tier] ?? 0;
    const sameName = String(cur.n || "").toLowerCase();
    const picks = [];
    foods.forEach((f, i) => {
      if (f.code === cur.code || f.n.toLowerCase() === sameName || blocked(f)) return;
      const b = V.assess(f, p), r = RANK[b.tier] ?? 0;
      if (!(r > mine || (r === mine && b.score >= a.score + 2))) return;
      // Serving sizes differ between brands (15 g vs 32 g), so the reason compares the same calories.
      const c100 = V.per100kcal(cur), f100 = V.per100kcal(f);
      const why = c100 && f100 ? reason(c100, f100, p) : reason(cur, f, p);
      if (!why) return;
      picks.push({ food: f, verdict: b, why, basis: c100 && f100 ? "per 100 calories" : "per serving", i, r });
    });
    return picks.sort((x, y) => y.r - x.r || y.verdict.score - x.verdict.score || x.i - y.i).slice(0, max);
  }

  return { category, categoryName, categoryUrl, parse, better, reason, TOO_BROAD };
});
