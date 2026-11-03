// Converts USDA FoodData Central and Open Food Facts records into the app's food shape.
// Pure functions so the tests can check them against sample API responses.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"));
  else root.SelfCheckSources = factory(root.SelfCheckVerdict);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (V) {
  const PROCESSED = /bacon|sausage|salami|pepperoni|\bham\b|hot dog|frankfurter|bologna|jerky|deli|cured|smoked|corned/i;
  const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

  // Values a source didn't report are listed in `missing` (and stored as 0 only as a placeholder):
  // the label shows them as "—" and the verdict leaves them out.
  // Added sugar counts as known only when the source reports it, and never when total sugars are unknown;
  // otherwise it's shown as "—" and left out of the verdict. A raw food, or one with under 1 g of total sugar, can't be
  // hiding added sugar, so for those the unknown value doesn't block a "Get it" (addLikelyZero).
  function settleAddedSugar(f, reported, raw) {
    // Added sugar can't exceed total sugars: an exact 0 g of sugar means 0 g added, even if the source left it out.
    const zeroSugar = !f.missing.includes("sug") && f.sug === 0 && !V.isLowerBound(f, "sug");
    if (zeroSugar) { f.add = 0; f.missing = f.missing.filter(k => k !== "add"); }
    else if (!reported || f.missing.includes("sug")) { if (!f.missing.includes("add")) f.missing.push("add"); f.add = 0; }
    f.addLikelyZero = f.missing.includes("add") && (!!raw || (!f.missing.includes("sug") && f.sug < 1));
    f.partial = f.missing.some(k => k !== "trans" && k !== "chol");
    return f;
  }

  // Values no real label can have: crowd-sourced records get typed in wrong (Kirkland's oat drink on Open Food Facts,
  // Oct 2026: sodium entered as 240 g a serving, trans fat 12 g in a drink with 5 g of fat, cholesterol in an oat drink).
  // Each one found is left out (shown as "—", not scored) and described in f.issues. Small overshoots are rounding.
  const NO_CHOLESTEROL = /^en:(dairy-substitutes|plant-based-milk-alternatives|plant-milks|plant-based-beverages|oat-based-drinks|soy-milks|almond-milks|non-dairy-milk)/;
  function impossible(f, categories) {
    const known = k => !f.missing.includes(k);
    const grams = (String(f.s).match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/i) || [])[1];
    const out = [];
    const bad = (k, text) => { if (known(k) && !out.some(x => x.k === k)) out.push({ k, text }); };
    const fmt = x => Math.round(x).toLocaleString("en-US");
    // Pure salt is 39% sodium, so a serving can't hold more sodium than 40% of its weight; nor, in practice, 8 g.
    if (known("na") && (f.na > 8000 || (grams && f.na / 1000 > Number(grams) * 0.4))) bad("na", `sodium ${fmt(f.na)} mg${grams ? ` in a ${grams} g serving` : " a serving"}`);
    if (known("fat")) {
      if (f.trans > f.fat + 0.5) bad("trans", `trans fat ${V.fmt(f.trans)} g, more than the ${V.fmt(f.fat)} g of total fat`);
      if (f.sat > f.fat + 0.5) bad("sat", `saturated fat ${V.fmt(f.sat)} g, more than the ${V.fmt(f.fat)} g of total fat`);
    }
    if (known("carb")) {
      if (f.fib > f.carb + 0.5) bad("fib", `fiber ${V.fmt(f.fib)} g, more than the ${V.fmt(f.carb)} g of carbohydrate`);
      if (f.sug > f.carb + 0.5) bad("sug", `sugars ${V.fmt(f.sug)} g, more than the ${V.fmt(f.carb)} g of carbohydrate`);
    }
    if (known("sug") && f.add > f.sug + 0.5) bad("add", `added sugar ${V.fmt(f.add)} g, more than the ${V.fmt(f.sug)} g of total sugars`);
    // Cholesterol only comes from animal foods.
    if (known("chol") && f.chol > 0 && (categories || []).some(c => NO_CHOLESTEROL.test(String(c)))) bad("chol", `cholesterol ${fmt(f.chol)} mg in a plant-based drink`);
    return out;
  }
  // Fat, carbohydrate and protein must roughly add up to the calories (fiber counted at 2 kcal/g). When they don't,
  // some number was entered wrong, but not which one, so nothing is left out: it's described for checking.
  // Alcohol has calories of its own (7 kcal/g) that no label line shows, so drinks with it are left alone.
  const ALCOHOL = /\b(beer|ale|lager|ipa|stout|wine|champagne|prosecco|sake|cider|vodka|whiske?y|bourbon|rum|gin|tequila|liquor|liqueur|brandy|cognac|seltzer|margarita|cocktail|sangria|mead|soju)\b/i;
  function energyGap(f) {
    if (["cal", "fat", "carb", "pro"].some(k => f.missing.includes(k)) || f.cal <= 0) return null;
    if (ALCOHOL.test(f.n) || (f.categories || []).some(c => /alcoholic/.test(String(c)) && !/non-alcoholic/.test(String(c)))) return null;
    const fib = f.missing.includes("fib") ? 0 : Math.min(f.fib, f.carb);
    const est = 9 * f.fat + 4 * (f.carb - fib) + 2 * fib + 4 * f.pro;
    return Math.abs(est - f.cal) > Math.max(50, 0.35 * Math.max(f.cal, est)) ? `fat, carbs and protein add up to about ${Math.round(est)} calories, not the ${Math.round(f.cal)} listed` : null;
  }

  // Leaves out impossible values and notes them in f.issues (also run on lookups saved before these checks existed).
  function check(f, categories) {
    if (!Array.isArray(f.missing)) f.missing = [];
    const issues = impossible(f, categories);
    for (const { k } of issues) { f[k] = 0; f.missing.push(k); }
    if (issues.length) f.issueKeys = [...new Set([...(f.issueKeys || []), ...issues.map(x => x.k)])];
    const gap = energyGap(f);
    const all = [...new Set([...(f.issues || []), ...issues.map(x => x.text), ...(gap ? [gap] : [])])];
    if (all.length) f.issues = all;
    f.checked = 1;
    f.partial = f.missing.some(k => k !== "trans" && k !== "chol");
    return f;
  }

  // The one-line version of f.issues: "Some numbers look wrong (sodium, trans fat, cholesterol), so they aren't counted."
  const ISSUE_NAMES = { na: "sodium", trans: "trans fat", sat: "saturated fat", chol: "cholesterol", fib: "fiber", sug: "sugars", add: "added sugar" };
  function issueSummary(f) {
    if (!f.issues || !f.issues.length) return null;
    const names = (f.issueKeys || []).map(k => ISSUE_NAMES[k]).filter(Boolean);
    if (names.length) return `Some numbers look wrong (${names.join(", ")}), so they aren't counted. Check the package.`;
    return "The calories don't match the other numbers. Check the package.";
  }

  function makeFood(name, serving, v, extra = {}) {
    const f = { n: String(name).slice(0, 70), a: [], s: String(serving || "1 serving").slice(0, 50), c: "lookup", tags: [] };
    for (const k of V.NUM_KEYS) f[k] = Math.round(num(v[k]) * 10) / 10;
    if (PROCESSED.test(f.n)) f.tags.push("processed");
    Object.assign(f, extra);
    f.missing = [...new Set(extra.missing || [])];
    check(f, extra.categories);
    f.sat = Math.min(f.sat, f.fat);
    f.add = Math.min(f.add, f.sug);
    if (f.missing.includes("add") && !f.missing.includes("sug") && f.sug === 0 && !V.isLowerBound(f, "sug")) { f.add = 0; f.missing = f.missing.filter(k => k !== "add"); }
    // Trans fat and cholesterol are routinely absent from non-US labels: shown as "—" but not worth a partial-data warning.
    f.partial = f.missing.some(k => k !== "trans" && k !== "chol");
    return f;
  }

  // USDA nutrient ids. Energy has three ids depending on data type; sugars has two.
  // Foundation records use some newer ids: total fat 1085 (NLEA), carbs by summation 1050.
  const USDA_IDS = { cal: [1008, 2048, 2047], pro: [1003], fat: [1004, 1085], carb: [1005, 1050], fib: [1079], sug: [2000, 1063], add: [1235], sat: [1258], trans: [1257], chol: [1253], na: [1093] };
  // USDA descriptions are often ALL CAPS. Capitalize words, but keep minor words ("or", "with") lowercase unless first.
  const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with", "without"]);
  const titleCase = s => s.toLowerCase().replace(/(^|[ ,(/-])([a-z][a-z']*)/g, (m, a, w, i) => a + (i > 0 && MINOR_WORDS.has(w) ? w : w[0].toUpperCase() + w.slice(1)));

  // One item from /fdc/v1/foods/search (Foundation, SR Legacy, Survey): values are per 100 g.
  function fromUsda(item) {
    const byId = {};
    for (const n of item.foodNutrients || []) {
      const id = n.nutrientId ?? (n.nutrient && n.nutrient.id);
      const value = n.value ?? n.amount;
      const unit = String(n.unitName || (n.nutrient && n.nutrient.unitName) || "").toUpperCase();
      if (id == null || value == null) continue;
      if (byId[id] != null && unit === "KJ") continue; // keep kcal when both units are listed
      byId[id] = unit === "KJ" ? value / 4.184 : value;
    }
    const v = {}, missing = [];
    for (const [k, ids] of Object.entries(USDA_IDS)) {
      const id = ids.find(i => byId[i] != null);
      if (id != null) v[k] = byId[id]; else { v[k] = 0; if (k !== "add" && k !== "trans") missing.push(k); }
    }
    const desc = String(item.description || "");
    // No energy value but the macros are there: estimate calories with 4/4/9.
    let calEstimated = false;
    if (missing.includes("cal") && !missing.includes("pro") && !missing.includes("fat") && !missing.includes("carb")) {
      v.cal = 4 * v.pro + 4 * v.carb + 9 * v.fat; missing.splice(missing.indexOf("cal"), 1); calEstimated = true;
    }
    const catRaw = item.foodCategory || item.brandedFoodCategory;
    const cat = catRaw && typeof catRaw === "object" ? catRaw.description : catRaw;
    let name = titleCase(String(item.description || "USDA food")), serving = "100 g";
    const extra = { src: "usda", fdcId: item.fdcId, dataType: item.dataType, missing, calEstimated, foodCategory: cat ? String(cat) : undefined };
    if (item.dataType === "Branded") {
      // Branded Foods: the brand's own label, stored per 100 g (or 100 ml). Scale back to the label's serving.
      const size = Number(item.servingSize), unit = String(item.servingSizeUnit || "").toLowerCase();
      const metric = /^(g|grm|gm)$/.test(unit) ? "g" : /^(ml|mlt)$/.test(unit) ? "ml" : null;
      if (metric && size > 0) {
        for (const k of Object.keys(v)) v[k] = v[k] * size / 100;
        const amt = `${Math.round(size * 10) / 10} ${metric}`;
        // Household measures use GDSN unit codes: "1 ONZ" (ounce), "8 OZA" (fluid ounce).
        const house = String(item.householdServingFullText || "").toLowerCase().replace(/\bonz\b/g, "oz").replace(/\boza\b/g, "fl oz").trim();
        serving = house && !/^\d+(\.\d+)?\s*(g|ml|grm|mlt)$/.test(house) ? `${house} (${amt})` : amt;
      }
      // "DORITOS, TORTILLA CHIPS, NACHO CHEESE, NACHO CHEESE" → drop the repeated part.
      name = name.split(/,\s*/).reduce((acc, part) => acc.length && acc.join(", ").toLowerCase().includes(part.toLowerCase()) ? acc : [...acc, part], []).join(", ");
      const brand = titleCase(String(item.brandName || "").trim());
      if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = `${brand} ${name}`;
      const ing = String(item.ingredients || "").trim();
      Object.assign(extra, { gtin: item.gtinUpc ? String(item.gtinUpc) : undefined, brandOwner: item.brandOwner || undefined,
        published: item.publishedDate || item.publicationDate || undefined, perServing: !!(metric && size > 0),
        // Labels are often ALL CAPS; sentence case reads better.
        ingredients: ing ? (ing === ing.toUpperCase() ? ing.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()) : ing).slice(0, 1500) : undefined });
    }
    const f = makeFood(name, serving, v, extra);
    // SR Legacy, Foundation and Survey records almost never report added sugar (nutrient 1235).
    return settleAddedSugar(f, byId[1235] != null, /\braw\b/i.test(desc));
  }

  // One product from Open Food Facts /api/v2/product/{barcode}.json, per the package's serving:
  //  1. the label's own per-serving values (*_serving) when present;
  //  2. else per-100 g values scaled to serving_quantity (grams) when the serving size is known;
  //  3. else per 100 g, labeled "100 g (no serving size on file)".
  // Open Food Facts stores sodium and cholesterol in grams.
  function servingQuantity(p) {
    const q = Number(p.serving_quantity);
    if (Number.isFinite(q) && q > 0) return q; // grams, or ml for drinks (treated as grams)
    const m = String(p.serving_size || "").match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
    return m ? Number(m[1].replace(",", ".")) : null;
  }
  const offTags = t => Array.isArray(t) && t.length ? t.slice(0, 30).map(x => String(x).toLowerCase()).filter(x => /^[a-z]{2}:[a-z0-9-]{1,60}$/.test(x)) : undefined;
  function fromOff(code, p) {
    const n = p.nutriments || {};
    const hasServing = n["energy-kcal_serving"] != null || n["energy_serving"] != null;
    const qty = hasServing ? null : servingQuantity(p);
    const factor = hasServing ? 1 : qty ? qty / 100 : 1;
    const per = hasServing ? "_serving" : "_100g";
    const val = k => (n[k] != null && n[k] !== "" && Number.isFinite(Number(n[k])) ? Number(n[k]) : undefined);
    // Per-serving value; when only that line is missing on a per-serving label, scale its per-100 g value.
    const g = k => val(k + per) != null ? val(k + per) * factor
      : hasServing && val(k + "_100g") != null && servingQuantity(p) ? val(k + "_100g") * servingQuantity(p) / 100 : undefined;
    const kcal = g("energy-kcal") ?? (g("energy") != null ? g("energy") / 4.184 : undefined);
    const sodiumG = g("sodium") ?? (g("salt") != null ? g("salt") / 2.5 : undefined);
    const v = {
      cal: kcal, fat: g("fat"), sat: g("saturated-fat"), trans: g("trans-fat"),
      chol: g("cholesterol") != null ? g("cholesterol") * 1000 : undefined,
      na: sodiumG != null ? sodiumG * 1000 : undefined,
      carb: g("carbohydrates"), fib: g("fiber"), sug: g("sugars"), add: g("added-sugars"), pro: g("proteins"),
    };
    // Open Food Facts leaves out whatever the package label doesn't list (EU labels skip fiber, cholesterol, trans fat, added sugar).
    const missing = V.NUM_KEYS.filter(k => v[k] == null || !Number.isFinite(Number(v[k])));
    const brand = String(p.brands || "").split(",")[0].trim();
    const product = p.product_name || p.generic_name || `Product ${code}`;
    const name = brand && !product.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${product}` : product;
    const serving = hasServing ? (p.serving_size || "1 serving") : qty ? (p.serving_size && /\d/.test(p.serving_size) ? p.serving_size : `${qty} g`) : "100 g (no serving size on file)";
    const ingredients = String(p.ingredients_text_en || p.ingredients_text || "").trim().slice(0, 1500);
    const f = makeFood(name, serving, v, { src: "off", code: String(code), missing, per100: !hasServing && !qty, categories: (p.categories_tags || []).slice(0, 30),
      // Additives and processing level, when Open Food Facts has analyzed the ingredient list.
      additives: Array.isArray(p.additives_tags) ? p.additives_tags.slice(0, 40).map(String) : undefined,
      nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : undefined,
      // Open Food Facts' own allergen and "traces" (may contain) lists, read by js/allergens.js.
      allergens: offTags(p.allergens_tags), traces: offTags(p.traces_tags),
      // Their vegan / vegetarian reading of the ingredient list ("en:non-vegan", "en:maybe-vegetarian").
      analysis: offTags((p.ingredients_analysis_tags || []).filter(t => /veg/.test(String(t)))),
      ingredients: ingredients || undefined });
    return settleAddedSugar(f, v.add != null, false);
  }

  // kind "generic": USDA's lab-measured foods (per 100 g). kind "branded": packaged products by name, from the
  // labels brands submit ("great value whole milk").
  function usdaSearchUrl(query, key, kind = "generic") {
    return "https://api.nal.usda.gov/fdc/v1/foods/search?" + new URLSearchParams({ query, dataType: kind === "branded" ? "Branded" : "Foundation,SR Legacy,Survey (FNDDS)", pageSize: kind === "branded" ? "12" : "8", api_key: key || "DEMO_KEY" });
  }
  const usdaFoodUrl = (id, key) => `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(id)}?` + new URLSearchParams({ api_key: key || "DEMO_KEY" });
  // Shareable link ids: looked-up foods link by their source id so the link works on a device that never saw them.
  const linkId = (f, slug) => f.src === "usda" && f.fdcId ? `usda-${f.fdcId}` : f.src === "off" && f.code ? `off-${f.code}` : slug(f.n);
  function parseLinkId(h) {
    const id = decodeURIComponent(String(h || "").replace(/^#/, ""));
    let m;
    if ((m = id.match(/^usda-(\d{1,10})$/))) return { kind: "usda", id: Number(m[1]) };
    if ((m = id.match(/^off-(\d{8,14})$/))) return { kind: "off", code: m[1] };
    return id ? { kind: "slug", slug: id } : null;
  }
  // ---- Packaged products by name (USDA Branded Foods) ----
  // FoodData Central's default search matches ANY word and ranks loosely ("great value peanut butter" returns Great
  // Value lemonade); requireAllWords only checks the description, which usually omits the brand. Joining the words
  // with AND searches every field and keeps only products that match them all. Its brandOwner filter is ignored, so
  // the Walmart filter runs here. Probed on GitHub Actions (eval/probe-branded.mjs).
  const STORE_BRANDS = { walmart: ["great value", "marketside", "equate", "sam's choice", "sams choice", "freshness guaranteed", "bettergoods", "parent's choice", "member's mark"],
    other: ["kirkland", "kirkland signature", "365", "whole foods market", "good & gather", "market pantry", "kroger", "simple truth", "private selection", "trader joe's", "o organics", "signature select", "h-e-b", "heb", "publix", "aldi", "clancy's"] };
  const SEARCH_STOP = new Set(["the", "and", "with", "of", "a", "an", "for", "in", "oz", "ounce", "pack", "count", "ct", "lb"]);
  const nameWords = t => String(t || "").toLowerCase().replace(/[^a-z0-9'& ]+/g, " ").split(/\s+/).filter(w => w && !SEARCH_STOP.has(w));
  // The store brand a query starts with, if any ("great value whole milk" → "great value").
  function storeBrand(text) {
    const q = " " + String(text || "").toLowerCase().replace(/\s+/g, " ").trim() + " ";
    for (const [group, list] of Object.entries(STORE_BRANDS)) for (const b of list) if (q.startsWith(" " + b + " ")) return { brand: b, walmart: group === "walmart" };
    return null;
  }
  const isWalmart = f => /wal-?mart/i.test(f.brandOwner || "") || STORE_BRANDS.walmart.includes(String(f.brandName || "").toLowerCase());
  function brandedSearchUrl(text, key, { all = true, size = 100 } = {}) {
    const words = nameWords(text).map(w => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
    const query = all && words.length > 1 ? words.join(" AND ") : words.join(" ");
    return "https://api.nal.usda.gov/fdc/v1/foods/search?" + new URLSearchParams({ query, dataType: "Branded", pageSize: String(size), api_key: key || "DEMO_KEY" });
  }
  // Re-rank search results: products whose own name has the words you typed (not just their ingredients), with
  // a short name ("PEANUT BUTTER, CREAMY" before "PEANUT BUTTER WAFER BARS"), from the brand you named, newest
  // first among equals. Duplicate listings of the same product keep the newest.
  function rankBranded(foods, text, { walmartOnly = false } = {}) {
    const sb = storeBrand(text);
    const brandWords = new Set(sb ? nameWords(sb.brand) : []);
    const want = nameWords(text).filter(w => !brandWords.has(w));
    const seen = new Map();
    for (const f of foods || []) {
      if (walmartOnly && !isWalmart(f)) continue;
      const key = `${String(f.description || "").toLowerCase()}|${String(f.brandName || f.brandOwner || "").toLowerCase()}`;
      const prev = seen.get(key);
      if (!prev || String(f.publishedDate || "") > String(prev.publishedDate || "")) seen.set(key, f);
    }
    const scored = [...seen.values()].map(f => {
      const desc = String(f.description || "").toLowerCase();
      const brandText = `${f.brandName || ""} ${f.brandOwner || ""}`.toLowerCase();
      // The product's own name, without a leading brand: "GREAT VALUE, LEMONADE" → "lemonade".
      const parts = desc.split(/,\s*/).filter(p => !(sb && p.trim() === sb.brand) && !brandText.includes(p.trim()) || !p.trim());
      const head = nameWords(parts[0] || desc);
      const all = new Set(nameWords(desc));
      const hit = want.filter(w => all.has(w) || all.has(w.replace(/s$/, "")) || all.has(w + "s")).length;
      const headHit = want.filter(w => head.includes(w) || head.includes(w.replace(/s$/, "")) || head.includes(w + "s")).length;
      let score = want.length ? 10 * hit / want.length + 4 * headHit / want.length : 0;
      score -= 0.6 * Math.max(0, head.length - want.length); // extra words: a more specific (different) product
      if (sb && (brandText.includes(sb.brand) || desc.startsWith(sb.brand))) score += 3;
      score += 0.05 * (Number(String(f.publishedDate || "").slice(0, 4)) - 2019 || 0);
      return { f, score, hit };
    });
    const anyHit = scored.some(x => x.hit > 0);
    return scored.filter(x => !anyHit || x.hit > 0).sort((a, b) => b.score - a.score).map(x => x.f);
  }

  // Barcode lookups in USDA Branded Foods. FoodData Central only finds a UPC in the exact form it was stored:
  // usually 12 digits (078742378213), sometimes 14 (00016000275287), 13, or an 8-digit UPC-E (04963406).
  // A scanner reads the same code as 12 or 13 digits, so try the likely forms in turn.
  const upcCore = code => String(code || "").replace(/\D/g, "").replace(/^0+/, "");
  function usdaUpcQueries(code) {
    const raw = String(code || "").replace(/\D/g, ""), core = upcCore(raw);
    if (!core) return [];
    const forms = [core.length <= 12 ? core.padStart(12, "0") : null, core.padStart(14, "0"), core.length <= 13 ? core.padStart(13, "0") : null, raw];
    if (raw.length === 8) forms.unshift(raw); // UPC-E, as printed on small packages
    return [...new Set(forms.filter(Boolean))];
  }
  const usdaUpcUrl = (q, key) => "https://api.nal.usda.gov/fdc/v1/foods/search?" + new URLSearchParams({ query: q, dataType: "Branded", pageSize: "5", api_key: key || "DEMO_KEY" });
  // The record whose UPC is this barcode (search can also return products that merely mention the number).
  // A record "holds together" when no number in it is impossible (f.issueKeys) and its calories add up (f.issues).
  const trouble = f => (f && ((f.issueKeys || []).length * 10 + (f.issues || []).length)) || 0;
  // Open Food Facts' record has trouble and USDA's (the brand's own filing) doesn't: use USDA's, and say why.
  function secondOpinion(off, usda) {
    if (!off || !trouble(off) || !usda || trouble(usda) >= trouble(off)) return off;
    return { ...usda, replacedOff: true };
  }
  // Same product, whatever the zeros in front: "0096619237432" and "96619237432".
  const sameCode = (a, b) => !!a && !!b && upcCore(a) === upcCore(b);
  const matchUpc = (foods, code) => (foods || []).find(f => f.gtinUpc && upcCore(f.gtinUpc) === upcCore(code)) || null;
  const offProductUrl = code => `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,generic_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,categories_tags,additives_tags,nova_group,ingredients_text,ingredients_text_en,allergens_tags,traces_tags,ingredients_analysis_tags`;


  // The exact prompt the Claude version uses to look up a food; the Claude-vs-USDA eval sends the same text.
  function claudePrompt(text) {
    return `Give typical nutrition facts for one common US serving of the food "${text}" as bought at a grocery store.
Reply with only a JSON object in this shape:
{"found":true,"name":"Title Case food name","serving":"1 cup (240 g)","cal":0,"fat":0,"sat":0,"trans":0,"chol":0,"na":0,"carb":0,"fib":0,"sug":0,"add":0,"pro":0,"spicy":false,"processedMeat":false}
Units: cal in kcal; chol and na in milligrams; every other number in grams. Use typical USDA FoodData Central values; for a branded or variable product, use a typical mid-range version. "add" is added sugars only. "spicy" is true only if the food is inherently hot. "processedMeat" is true for cured, smoked or deli meats.
If "${text}" is not a food, reply {"found":false}.`;
  }

  // Pull the JSON object out of a model reply that may have text or a code fence around it.
  function parseJsonReply(reply) {
    const s = String(reply || "");
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1] : s;
    const i = body.indexOf("{"), j = body.lastIndexOf("}");
    if (i < 0 || j <= i) throw new Error("no JSON object in reply");
    return JSON.parse(body.slice(i, j + 1));
  }

  // A Claude lookup reply (the JSON shape asked for in claudePrompt) as an app food.
  function fromClaude(d, query) {
    if (!d || d.found === false || !d.name) return null;
    const f = makeFood(d.name, d.serving, d, { src: "claude", a: query ? [String(query).toLowerCase()] : [] });
    f.tags = [...(d.spicy ? ["spicy"] : []), ...(d.processedMeat ? ["processed"] : [])];
    return f;
  }

  return { PROCESSED, makeFood, check, issueSummary, settleAddedSugar, fromUsda, fromOff, usdaSearchUrl, usdaFoodUrl, usdaUpcQueries, usdaUpcUrl, matchUpc, trouble, secondOpinion, sameCode, brandedSearchUrl, rankBranded, storeBrand, isWalmart, STORE_BRANDS, linkId, parseLinkId, titleCase, offProductUrl, claudePrompt, parseJsonReply, fromClaude };
});
