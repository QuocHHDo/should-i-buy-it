// Reads a Walmart product page for the browser extension: the page's own data (__NEXT_DATA__), its Nutrition Facts
// panel when it has one, and which source to use when it doesn't. Pure functions so the tests can run them on real
// page data. Walmart's panel comes in several shapes ("Saturated Fat" or "Sat. Fat", on its own line or nested under
// Total Fat), so nutrients are found by name anywhere in it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"), require("./sources.js"), require("./search.js"), require("./supplement.js"));
  else root.SelfCheckWalmart = factory(root.SelfCheckVerdict, root.SelfCheckSources, root.SelfCheckSearch, root.SelfCheckSupplement);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (V, S, Q, SUP) {
  // The stores the extension works on. Sam's Club runs on Walmart's platform: the same /ip/ product URLs, page data,
  // title and rating row, so one reader serves both; only names and search links differ.
  const STORES = {
    walmart: { id: "walmart", name: "Walmart", search: "https://www.walmart.com/search?q=" },
    sams: { id: "sams", name: "Sam's Club", search: "https://www.samsclub.com/search?q=" },
    costco: { id: "costco", name: "Costco", search: "https://www.costco.com/s?keyword=" },
    target: { id: "target", name: "Target", search: "https://www.target.com/s?searchTerm=" },
    kroger: { id: "kroger", name: "Kroger", search: "https://www.kroger.com/search?query=" },
  };
  /** @type {Array<[RegExp, string]>} */
  const HOSTS = [[/(^|\.)samsclub\.com$/i, "sams"], [/(^|\.)costco\.com$/i, "costco"], [/(^|\.)target\.com$/i, "target"], [/(^|\.)kroger\.com$/i, "kroger"]];
  const storeOf = host => { const hit = HOSTS.find(([re]) => re.test(String(host || ""))); return hit ? STORES[hit[1]] : STORES.walmart; };
  const storeSearch = (q, store) => (STORES[store] || STORES.walmart).search + encodeURIComponent(q);

  // Product id from a product URL: /ip/Some-Name/10315479 → "10315479".
  const productId = url => { const m = String(url).match(/\/ip\/(?:[^/?#]+\/)?(\d{4,15})(?:[/?#]|$)/); return m ? m[1] : null; };

  // The page data from a document or from fetched HTML.
  function nextData(src) {
    let text = null;
    if (typeof src === "string") { const m = src.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); text = m && m[1]; }
    else if (src && src.getElementById) { const el = src.getElementById("__NEXT_DATA__"); text = el && el.textContent; }
    if (!text) return null;
    try { const d = JSON.parse(text); return d && d.props && d.props.pageProps && d.props.pageProps.initialData && d.props.pageProps.initialData.data || null; } catch { return null; }
  }

  // The parts of the page data the extension uses.
  function product(data) {
    if (!data || !data.product) return null;
    const p = data.product, idml = data.idml || {};
    const ing = idml.ingredients && idml.ingredients.ingredients;
    return {
      id: p.usItemId ? String(p.usItemId) : null, name: p.name || "", upc: p.upc ? String(p.upc).replace(/\D/g, "") : "", brand: p.brand || "",
      category: ((p.category && p.category.path) || []).map(c => c && c.name).filter(Boolean),
      // Fresh produce pages sometimes hold a recipe or a seller's note here, not ingredients.
      ingredients: ing && typeof ing.value === "string" && !((p.category && p.category.path) || []).some(c => c && /fresh produce/i.test(c.name)) ? ing.value : "",
      nutrition: idml.nutritionFacts || null,
      labelRows: labelRows(idml),
      price: priceOf(p.priceInfo),
      // The product photos, for reading a label photo in the side panel (Walmart and Sam's Club serve them to any site).
      images: ((p.imageInfo && p.imageInfo.allImages) || []).map(i => i && i.url).filter(u => typeof u === "string" && /^https:\/\/i5\.(walmartimages|samsclubimages)\.com\//.test(u)).slice(0, 12),
    };
  }

  // Every "name + amount" line in the page's label data, wherever it sits. Supplement Facts come in shapes that differ
  // from Nutrition Facts, so this doesn't assume one: it collects lines from anything that isn't ingredients, warnings
  // or directions.
  const SKIP_KEYS = /^(?:ingredients|warnings?|directions|indications|instructions|productHighlights|specifications)$/i;
  function labelRows(idml) {
    const out = [], seen = new Set();
    const visit = (n, depth) => {
      if (!n || typeof n !== "object" || depth > 7) return;
      if (Array.isArray(n)) { n.forEach(x => visit(x, depth + 1)); return; }
      if (typeof n.name === "string" && (typeof n.amount === "string" || typeof n.amount === "number") && String(n.amount).trim() !== "") {
        const k = n.name.trim().toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push({ name: n.name.trim(), amount: String(n.amount).trim(), dvp: n.dvp != null ? String(n.dvp) : "" }); }
      }
      for (const [k, v] of Object.entries(n)) if (!SKIP_KEYS.test(k)) visit(v, depth + 1);
    };
    visit(idml, 0);
    return out;
  }

  // Walmart's price on the page: { now: $ for the item, perUnit: $ per unit, unit: "oz" | "fl oz" | "lb" | …, text }.
  // The unit price ("18.7 ¢/oz", "$4.99/lb") is what makes a per-serving cost work for multipacks and big jars.
  function priceOf(pi) {
    if (!pi || typeof pi !== "object") return null;
    const now = pi.currentPrice && Number(pi.currentPrice.price);
    const up = pi.unitPrice || {};
    const unit = (String(up.priceString || "").match(/\/\s*([a-z ]+?)\s*$/i) || [])[1];
    const perUnit = Number(up.price);
    const ok = x => Number.isFinite(x) && x > 0 && x < 10000;
    if (!ok(now) && !ok(perUnit)) return null;
    return { now: ok(now) ? now : null, perUnit: ok(perUnit) && unit ? perUnit : null, unit: unit ? unit.toLowerCase() : null, text: ok(perUnit) && unit ? String(up.priceString).trim() : "" };
  }
  // Cost of one serving from the unit price and the serving's grams or millilitres ("3/4 cup (170g)", "1 cup (240mL)").
  const PER = { oz: ["g", 28.3495], lb: ["g", 453.592], "fl oz": ["ml", 29.5735], kg: ["g", 1000], g: ["g", 1], l: ["ml", 1000], ml: ["ml", 1] };
  function servingCost(price, f) {
    if (!price || !price.perUnit || !price.unit || !PER[price.unit] || !f) return null;
    const m = [...String(f.s || "").matchAll(/(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)].pop();
    if (!m) return null;
    const amount = Number(m[1]) * (f.mult || 1), [, size] = PER[price.unit];
    // Liquids priced per fl oz with a serving in grams (or the reverse): close enough to count 1 g as 1 ml.
    const cost = price.perUnit * amount / size;
    return Number.isFinite(cost) && cost > 0 ? Math.round(cost * 1000) / 1000 : null;
  }

  // "1.5g" → { v: 1.5, u: "g" }; "<1g" and "less than 1g" → half the bound; "140" → { v: 140, u: "" }.
  function amount(s) {
    const t = String(s == null ? "" : s).trim().toLowerCase();
    const m = t.match(/^(<|less than)?\s*([\d.]+)\s*(mcg|mg|g|kcal)?$/);
    if (!m) return null;
    const v = Number(m[2]);
    if (!Number.isFinite(v)) return null;
    return { v: m[1] ? v / 2 : v, u: m[3] || "" };
  }
  // Nutrient names on Walmart's panel → the app's keys.
  /** @type {Array<[RegExp, string]>} */
  const NAMES = [[/^calories?$/, "cal"], [/^total fat$/, "fat"], [/^sat(urated)? fat$/, "sat"], [/^trans fat$/, "trans"], [/^cholest(erol)?$/, "chol"],
    [/^sodium$/, "na"], [/^(total )?carb(ohydrate)?s?$/, "carb"], [/^(dietary )?fiber$/, "fib"], [/^(total )?sugars?$/, "sug"],
    [/^(incl(udes|\.)? )?added sugars?$/, "add"], [/^protein$/, "pro"]];
  const keyOf = name => { const n = String(name || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim(); const hit = NAMES.find(([re]) => re.test(n)); return hit ? hit[1] : null; };

  // Every nutrient row in the panel, wherever it sits.
  function rows(nf) {
    const out = [];
    const visit = n => { if (!n || typeof n !== "object") return; if (n.name && n.amount != null) out.push(n); for (const c of n.childNutrients || []) visit(c); };
    if (nf && nf.calorieInfo) visit(nf.calorieInfo.mainNutrient);
    for (const v of (nf && nf.keyNutrients && nf.keyNutrients.values) || []) { visit(v.mainNutrient); for (const c of v.childNutrients || []) visit(c); }
    return out;
  }
  const servingOf = nf => { const s = ((nf && nf.servingInfo && nf.servingInfo.values) || []).find(x => /serving size/i.test(x.name || "")); return s && s.value ? String(s.value) : ""; };

  // The panel as an app food, or null when the page has no usable panel (no calories, protein, fat or carbs).
  function fromPanel(p) {
    if (!p || !p.nutrition) return null;
    const v = {}, found = new Set();
    for (const r of rows(p.nutrition)) {
      const k = keyOf(r.name);
      // A blank amount with a %DV ("Dietary Fiber | | 2%"): work it out from the FDA Daily Value.
      const dv = String(r.dvp || "").match(/^([\d.]+)%$/);
      const a = amount(r.amount) || (dv && V.FDA_DV[k] && (r.amount == null || String(r.amount).trim() === "") ? { v: Number(dv[1]) / 100 * V.FDA_DV[k], u: k === "na" || k === "chol" ? "mg" : "g" } : null);
      if (!k || !a || found.has(k)) continue;
      let x = a.v;
      if (k === "na" || k === "chol") x = a.u === "g" ? x * 1000 : a.u === "mcg" ? x / 1000 : x; // mg
      else if (k !== "cal") x = a.u === "mg" ? x / 1000 : a.u === "mcg" ? x / 1e6 : x; // g
      v[k] = x; found.add(k);
    }
    if (!["cal", "fat", "carb", "pro"].some(k => found.has(k))) return null;
    // Labels may leave out lines that follow from others: no fat means no saturated or trans fat; no carbohydrate
    // means no fiber or sugar (butter, oil, plain meat).
    const zero = k => { if (!found.has(k)) { v[k] = 0; found.add(k); } };
    if (found.has("fat") && v.fat === 0) { zero("sat"); zero("trans"); }
    if (found.has("carb") && v.carb === 0) { zero("fib"); zero("sug"); zero("add"); }
    const missing = V.NUM_KEYS.filter(k => !found.has(k));
    // Walmart's category path ("Food > Pantry > Peanut butter & spreads > Peanut butter") is read like USDA's branded
    // food category, so "Try instead" knows what kind of food this is. Target's panel comes through here too (src "target").
    const f = S.makeFood(shortName(p), servingOf(p.nutrition) || "1 serving", v, { src: p.src || "walmart", missing, upc: p.upc, ingredients: p.ingredients || undefined,
      foodCategory: p.category.slice(1).join(" > ") || undefined, dataType: p.category.length > 1 ? "Branded" : undefined });
    return S.settleAddedSugar(f, found.has("add"), false);
  }

  // Product names are long ("Cheerios, Heart Healthy Gluten Free Breakfast Cereal, Family Size, 18 oz"); keep the
  // first part that says what it is.
  function shortName(p) {
    const n = String(p.name || "").replace(/\s+/g, " ").trim();
    return n.length <= 60 ? n : n.slice(0, 57).replace(/[ ,]+\S*$/, "") + "…";
  }

  // Produce sticker codes (a 4–5 digit PLU, stored as zeros + PLU + check digit, e.g. 000000940115 for 94011) and
  // in-store weighed items (UPCs starting with 2) aren't real product barcodes: looking them up returns unrelated
  // products, so these are matched to built-in foods by name instead. Real barcodes have 7+ significant digits.
  const isPlu = upc => { const core = String(upc || "").replace(/^0+/, ""); return core.length > 0 && core.length <= 6; };
  const isWeighed = upc => /^0?2\d{10,11}$/.test(String(upc || "")) && String(upc).replace(/^0/, "").length <= 12;
  const FRESH = /fresh produce|fresh fruit|fresh vegetable|meat & seafood|fresh meat|fresh seafood|^produce$/i;
  // An empty nutrition block doesn't make a page food (non-food pages can carry one with every field null).
  const hasNutrition = n => !!(n && (n.calorieInfo || (n.keyNutrients && n.keyNutrients.values && n.keyNutrients.values.length)));
  const isFood = p => p && (SUP && SUP.isSupplement({ category: p.category, name: p.name, ingredients: p.ingredients }) ||p.category.some(c => /^food$|grocery|beverage|produce|dairy|meat|frozen|pantry|snack|protein/i.test(c)) || hasNutrition(p.nutrition));

  // How to get this product's nutrition: { kind: "panel" | "name" | "barcode" | "none", ... }.
  function plan(p) {
    if (!p) return { kind: "none", why: "Not a product page." };
    const f = fromPanel(p);
    // Supplements (a Supplement Facts label, or a supplement category or name) get their own view, not a food verdict.
    // A real Nutrition Facts panel with calories (protein powder, a meal shake) keeps it a food.
    if (SUP && SUP.isSupplement({ category: p.category, name: p.name, ingredients: p.ingredients, rows: p.labelRows || [], hasNutritionFacts: !!(f && f.cal >= 20) }))
      return { kind: "supplement", rows: p.labelRows || [], serving: servingOf(p.nutrition) || ((p.labelRows || []).find(r => /serving size/i.test(r.name)) || {}).amount || "" };
    if (f) return { kind: "panel", food: f };
    if (!isFood(p)) return { kind: "none", why: "Not a food." };
    const fresh = p.category.some(c => FRESH.test(c));
    // Fresh produce: the app's typical values by name first. Their barcodes, when they have one, rarely have
    // nutrition records, and sticker codes (PLUs) look up as unrelated products.
    if (fresh || isPlu(p.upc) || isWeighed(p.upc)) {
      const q = produceQuery(p.name);
      return { kind: "name", query: q, fallback: p.upc && !isPlu(p.upc) && !isWeighed(p.upc) && p.upc.replace(/^0+/, "").length >= 7 ? p.upc : null };
    }
    if (p.upc && p.upc.replace(/^0+/, "").length >= 7) return { kind: "barcode", code: p.upc };
    return fresh ? { kind: "name", query: produceQuery(p.name) } : { kind: "none", why: "No nutrition facts or barcode on this page." };
  }

  // "Marketside Fresh Organic Bananas, Bunch" → "Bananas"; Target's "Fresh Baby-Cut Carrots - Good & Gather™" → "Baby-Cut Carrots".
  const PRODUCE_NOISE = /\b(marketside|great value|freshness guaranteed|good & gather|good and gather|simple truth|fresh|organic|each|bunch|bag|bundle|package|pack|count|ct|lb|lbs|oz|whole|large|medium|small|premium|conventional)\b|\d+(\.\d+)?/gi;
  const produceQuery = name => String(name || "").split(/,| - /)[0].replace(/[™®]/g, "").replace(PRODUCE_NOISE, " ").replace(/\s+/g, " ").trim();

  // A built-in food for a name-matched product, or null when the match isn't confident.
  function byName(query, foods) {
    if (!query) return null;
    const r = Q.resolve(query, foods);
    return r.kind === "open" || r.kind === "closest" ? r.food : null;
  }

  return { priceOf, servingCost, productId, nextData, product, amount, keyOf, rows, fromPanel, plan, produceQuery, byName, isPlu, isWeighed, shortName, STORES, storeOf, storeSearch };
});
