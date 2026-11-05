// Reads a Target product page for the browser extension. Target's pages are Next.js: the product's record sits in the
// page data (__NEXT_DATA__, in its saved query results) with the UPC, the category path, the ingredients, the label
// photos and the Nutrition Facts panel as a list of nutrients. The panel is turned into Walmart's shape, so the same
// code (js/walmart.js) parses it and decides between the panel, a name match for produce, the barcode, or the
// supplement view. The price isn't in the page data (the page loads it after), so it's read from the page itself.
// Checked against live target.com pages (Nov 5, 2026): peanut butter, cereal, cola, chips, frozen pizza, a yogurt
// drink, baby carrots, protein powder, vitamin D3 and an after-sun gel (tests/fixtures/target-live.json).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./walmart.js"));
  else root.SelfCheckTarget = factory(root.SelfCheckWalmart);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (W) {
  // "/p/adams-peanut-butter-…-26oz/-/A-47952194" (and "?preselect=…" for a variant) → "47952194".
  const productId = url => { const m = String(url).match(/\/-\/A-(\d{5,12})(?:[/?#]|$)/); return m ? m[1] : null; };

  // The page data from a document or from fetched HTML.
  function nextData(src) {
    let text = null;
    if (typeof src === "string") { const m = src.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); text = m && m[1]; }
    else if (src && src.getElementById) { const el = src.getElementById("__NEXT_DATA__"); text = el && el.textContent; }
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  // The product record anywhere in the page data (it moves between page layouts): { __typename: "Product", tcin, item }.
  // With `tcin`, only that product's record (a page also carries records of recommended products).
  function findProduct(data, tcin) {
    const seen = new Set(), stack = [data];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== "object" || seen.has(n)) continue;
      seen.add(n);
      if (!Array.isArray(n) && n.__typename === "Product" && n.item && n.item.product_description && n.tcin && (!tcin || String(n.tcin) === String(tcin))) return n;
      for (const v of Array.isArray(n) ? n : Object.values(n)) if (v && typeof v === "object") stack.push(v);
    }
    return null;
  }

  // Target's titles carry HTML entities: "Adam&#39;s", "Good &#38; Gather&#8482;".
  const ENT = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", trade: "™", reg: "®" };
  const decode = s => String(s || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] || m);

  // Serving size: "2 Tbsp", "355 mL", "15 chips (28g)" (the grams, when Target has them, are in the description).
  function serving(v) {
    if (!v) return "";
    const n = Number(v.serving_size), size = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v.serving_size || "").trim();
    const s = [size, String(v.serving_size_unit_of_measurement || "").trim()].filter(Boolean).join(" ");
    const g = String(v.description || "").match(/\((\d+(?:\.\d+)?\s*(?:g|ml))\)/i);
    return g && !/\b(g|ml)\b/i.test(s) ? `${s} (${g[1].replace(/\s+/g, "")})` : s;
  }
  const UNITS = { cal: "", kcal: "", calorie: "", calories: "", grm: "g", gram: "g", grams: "g", gr: "g", milligram: "mg", milligrams: "mg", mgm: "mg",
    microgram: "mcg", micrograms: "mcg", "µg": "mcg", mcg: "mcg" };
  // Target's nutrient list ({ name, quantity, unit_of_measurement, percentage }) as Walmart's panel, for W.fromPanel.
  function panel(nf) {
    const v = nf && Array.isArray(nf.value_prepared_list) ? nf.value_prepared_list[0] : null;
    const list = (v && Array.isArray(v.nutrients) ? v.nutrients : []).filter(n => n && typeof n.name === "string" && n.quantity != null && Number.isFinite(Number(n.quantity)));
    if (!list.length) return { nutrition: null, rows: [], serving: serving(v) };
    // Units come spelled several ways on the same site: "g" or "grm", "Cal", "kcal" or "calories".
    const unit = n => { const u = String(n.unit_of_measurement || "").trim().toLowerCase(); return UNITS[u] != null ? UNITS[u] : u; };
    const row = n => ({ name: n.name.trim(), amount: `${Number(n.quantity)}${unit(n)}`, dvp: n.percentage != null ? `${n.percentage}%` : "" });
    const cal = list.find(n => /^calories?$/i.test(n.name.trim()));
    const nutrition = {
      servingInfo: { values: [{ name: "Serving size", value: serving(v) }] },
      calorieInfo: cal ? { mainNutrient: row(cal) } : null,
      keyNutrients: { values: list.filter(n => n !== cal).map(n => ({ mainNutrient: row(n) })) },
    };
    return { nutrition, rows: list.map(row), serving: serving(v) };
  }

  // Target's own price, from the page (it isn't in the page data): "$4.79" and "($0.18/ounce)".
  const UNIT = { ounce: "oz", "fluid ounce": "fl oz", pound: "lb", gram: "g", kilogram: "kg", liter: "l", milliliter: "ml" };
  function priceOf(doc) {
    if (!doc || typeof doc.querySelector !== "function") return null;
    const el = doc.querySelector('[data-test="product-price"]');
    const now = el && Number((String(el.textContent).match(/\$\s*(\d+(?:\.\d\d)?)/) || [])[1]);
    const box = el && (el.closest('[data-module-type], [data-test="module-product-detail-price-v2"]') || el.parentElement);
    const um = box && String(box.textContent).match(/\(\s*\$\s*(\d+(?:\.\d+)?)\s*\/\s*(fluid ounce|ounce|pound|gram|kilogram|liter|milliliter)s?\s*\)/i);
    const ok = x => Number.isFinite(x) && x > 0 && x < 10000;
    if (!ok(now)) return null;
    const perUnit = um && ok(Number(um[1])) ? Number(um[1]) : null, unit = perUnit ? UNIT[um[2].toLowerCase()] : null;
    return { now, perUnit: unit ? perUnit : null, unit, text: unit ? `$${perUnit.toFixed(2)}/${unit}` : "" };
  }

  // The product photos (Target's image host): the label photos first, since those are what the side panel reads.
  const IMG = /^https:\/\/target\.scene7\.com\//;
  function images(item) {
    const ii = (item.enrichment && item.enrichment.image_info) || {};
    const urls = [...(ii.content_labels || []).map(x => x && x.image_url), ii.primary_image && ii.primary_image.url, ...(ii.alternate_images || []).map(x => x && x.url)];
    return [...new Set(urls.filter(u => typeof u === "string" && IMG.test(u)))].slice(0, 12);
  }

  // The parts of the page the extension uses, in Walmart's product shape. `url` picks the product when given.
  function product(src, url) {
    const data = nextData(src);
    const rec = data && findProduct(data, url ? productId(url) : null);
    if (!rec) return null;
    const item = rec.item, nf = item.enrichment && item.enrichment.nutrition_facts;
    const crumbs = ((rec.category && rec.category.breadcrumbs) || []).map(b => b && decode(b.name)).filter(c => c && !/^target$/i.test(c));
    const pn = panel(nf);
    const upc = String(item.primary_barcode || "").replace(/\D/g, "");
    return {
      id: String(rec.tcin), name: decode(item.product_description.title).replace(/\s+/g, " ").trim(), upc, brand: decode(item.primary_brand && item.primary_brand.name),
      category: crumbs,
      // Products with no nutrition panel can still list ingredients (lotions, sunscreen): only food ingredients count.
      ingredients: pn.nutrition && nf && typeof nf.ingredients === "string" ? nf.ingredients.trim() : "",
      nutrition: pn.nutrition, labelRows: pn.rows,
      dept: (item.merchandise_classification && item.merchandise_classification.department_name) || null,
      kind: (item.product_classification && item.product_classification.product_type_name) || null,
      price: typeof src === "string" ? null : priceOf(src),
      images: images(item),
      src: "target",
    };
  }

  // Target files beauty, household and pet products by top category; Grocery, and Health for vitamins and protein.
  const NOT_FOOD = /^(beauty|household essentials|personal care|pets|home|baby|clothing|toys|electronics|kitchen & dining)$/i;
  function plan(p) {
    if (!p) return { kind: "none", why: "Not a product page." };
    if (!p.nutrition && p.category[0] && NOT_FOOD.test(p.category[0])) return { kind: "none", why: "Not a food." };
    return W.plan(p);
  }

  return { productId, nextData, findProduct, product, plan, panel, serving, priceOf, decode, images };
});
