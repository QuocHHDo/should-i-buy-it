// Typical price per serving and value-for-money, from js/prices-data.js, with the user's own prices on top.
// Prices never affect the verdict: cheap isn't the same as healthy.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./prices-data.js"));
  else root.SelfCheckPrices = factory(root.SelfCheckPricesData);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (DATA) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = ym => ym ? `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : "";
  const money = v => v == null ? "" : v < 0.995 ? `$${v.toFixed(2)}` : `$${v.toFixed(2)}`;

  // own: { [food name]: { unit: number } }  — what the user pays per unit (lb, dozen, gal…), or
  //      { serving: number } for foods with no typical price.
  // Returns null when there's no price at all.
  // Your prices are kept by barcode for scanned products ("upc:96619237432"), so two products with the same name don't
  // share one; built-in foods and anything without a barcode go by name. Prices saved by name before still count.
  const keyOf = f => { const c = String((f && (f.code || f.gtin)) || "").replace(/\D/g, "").replace(/^0+/, ""); return c.length >= 6 ? "upc:" + c : f ? f.n : ""; };
  // A scanned product falls back to a price saved by its name only when no built-in food has that name.
  const mineOf = (f, own) => { const k = keyOf(f); return own[k] || (k !== f.n && DATA.foods[f.n] ? undefined : own[f.n]); };
  function price(f, own = {}) {
    if (!f) return null;
    const d = DATA.foods[f.n], mine = mineOf(f, own);
    const mult = f.mult || 1;
    if (mine && mine.serving > 0) return { cost: mine.serving * mult, perServing: mine.serving, mine: true, unitLabel: "serving", unitPrice: mine.serving, typical: d ? d[0] : null };
    if (!d) return null;
    const [cost, unitPrice, unitLabel, src, region, ym, note, per] = d;
    const one = mine && mine.unit > 0 ? mine.unit * (per || cost / unitPrice) : cost;
    return {
      cost: one * mult, perServing: one, typical: cost, unitPrice: mine && mine.unit > 0 ? mine.unit : unitPrice, unitLabel,
      mine: !!(mine && mine.unit > 0), src, region, month: monthLabel(ym), note,
      source: src === "bls" ? `BLS average price, ${region === "South" ? "South region" : "U.S. average"}, ${monthLabel(ym)}`
        : `USDA ERS 2023 price, adjusted to ${monthLabel(ym)} with the CPI`,
    };
  }

  // What a dollar buys: protein when the food is a real protein source (the verdict's "decent protein" bar: at least
  // 5 g and 20% of calories, so pasta and bread don't top a protein-per-dollar list), else fiber when it's a good
  // fiber source.
  function value(f, p) {
    if (!p || !(p.perServing > 0)) return null;
    const per = k => (f[k] || 0) / p.perServing;
    if ((f.pro || 0) >= 5 && f.cal > 0 && f.pro * 4 / f.cal >= 0.2) return { k: "pro", v: per("pro"), text: `${Math.round(per("pro"))} g protein per $1` };
    if ((f.fib || 0) >= 2.8) return { k: "fib", v: per("fib"), text: `${Math.round(per("fib") * 10) / 10} g fiber per $1` };
    return null;
  }

  // Total for a plate: the sum of items that have a price, and how many don't.
  function plateCost(items, own = {}) {
    let total = 0, priced = 0;
    for (const { food, mult } of items || []) {
      const p = price({ ...food, mult: mult || 1 }, own);
      if (p) { total += p.cost; priced++; }
    }
    return { total, priced, missing: (items || []).length - priced };
  }

  // A shelf price for a packaged product: "$3.99" for "64 fl oz" (or "2 x 64 fl oz", "1.89 L", "1/2 gal", "12 servings")
  // and the label's serving ("1 cup (240 mL)", "240g") → the cost of one serving. Liquids priced by volume with a serving
  // in grams (or the reverse) count 1 g as 1 ml, close enough for milk and juice. null when the size or the serving
  // can't be read.
  const SIZE = { g: ["m", 1], kg: ["m", 1000], oz: ["m", 28.3495], lb: ["m", 453.592], ml: ["v", 1], l: ["v", 1000], "fl oz": ["v", 29.5735],
    gal: ["v", 3785.41], qt: ["v", 946.353], pt: ["v", 473.176] };
  const amountOf = t => {
    const s = String(t || "").toLowerCase().replace(/fluid ounces?|fl\.? ?oz\.?/g, "fl oz").replace(/ounces?/g, "oz").replace(/pounds?|lbs?\b/g, "lb")
      .replace(/gallons?/g, "gal").replace(/quarts?/g, "qt").replace(/pints?/g, "pt").replace(/liters?|litres?/g, "l").replace(/grams?/g, "g").replace(/half/g, "1/2");
    const n = x => { const m = String(x).match(/^(\d+)\/(\d+)$/); return m ? Number(m[1]) / Number(m[2]) : Number(x); };
    const m = s.match(/(?:(\d+)\s*[x×]\s*)?(\d+\/\d+|\d*\.?\d+)\s*(fl oz|kg|g|oz|lb|ml|l|gal|qt|pt)\b/);
    if (!m) { const c = s.match(/(\d*\.?\d+)\s*servings?/); return c ? { servings: Number(c[1]) } : null; }
    const [kind, f] = SIZE[m[3]]; const v = n(m[2]) * f * (m[1] ? Number(m[1]) : 1);
    return Number.isFinite(v) && v > 0 ? { kind, v } : null;
  };
  function shelfCost(priceText, sizeText, servingText) {
    const price = Number(String(priceText || "").replace(/[$,\s]/g, ""));
    if (!(price > 0) || price > 10000) return null;
    const size = amountOf(sizeText);
    if (!size) return null;
    if (size.servings) return size.servings > 0 ? { perServing: price / size.servings, servings: size.servings } : null;
    // The serving's weight or volume: the amount in parentheses on US labels, else the first one given.
    let sv = [...String(servingText || "").matchAll(/(\d*\.?\d+)\s*(g|ml|mL|oz|fl oz)\b/gi)].map(m => amountOf(m[0])).filter(Boolean).pop();
    // "1 cup" with no weight on file: the label's household measures.
    if (!sv) { const h = String(servingText || "").toLowerCase().match(/(\d+\/\d+|\d*\.?\d+)\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?)\b/);
      if (h) { const q = /\//.test(h[1]) ? Number(h[1].split("/")[0]) / Number(h[1].split("/")[1]) : Number(h[1]); sv = { kind: "v", v: q * (/^c/.test(h[2]) ? 240 : /^(tbsp|table)/.test(h[2]) ? 15 : 5) }; } }
    if (!sv || !(sv.v > 0)) return null;
    const servings = size.v / sv.v;
    return servings >= 0.5 && servings < 5000 ? { perServing: price / servings, servings } : null;
  }

  return { price, value, plateCost, money, shelfCost, keyOf, mineOf, meta: DATA.meta, has: n => !!DATA.foods[n] };
});
