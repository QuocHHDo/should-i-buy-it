// Reads a Costco product page for the browser extension. Costco's pages carry no Nutrition Facts as text, so the
// route is the barcode: the page's structured data (JSON-LD) gives the name, Costco's item number, brand, price and
// category path, and the item's own record in the embedded page data gives its UPC, department and size. The product is
// returned in the same shape as Walmart's (js/walmart.js), so the rest of the extension treats both alike.
// Checked against live costco.com pages (Oct 26, 2026): Cheerios, Kirkland Signature peanut butter, bananas, Kirkland
// paper towels and Kirkland vitamin D3.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./walmart.js"), require("./supplement.js"));
  else root.SelfCheckCostco = factory(root.SelfCheckWalmart, root.SelfCheckSupplement);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (W, SUP) {
  // "/p/-/general-mills-cheerios-cereal-2035-oz-2-count/100381496" and the older "….product.100381496.html".
  const productId = url => { const m = String(url).match(/\/p\/-\/[^/?#]+\/(\d{4,15})(?:[/?#]|$)|\.product\.(\d{4,15})\.html/); return m ? m[1] || m[2] : null; };

  // JSON-LD blocks from a document or from fetched HTML.
  function ldBlocks(src) {
    const texts = typeof src === "string"
      ? [...src.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
      : [...src.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent);
    return texts.map(t => { try { return JSON.parse(t); } catch { return null; } }).flat().filter(Boolean);
  }
  // The embedded page data (Next.js stream chunks with escaped quotes), flattened for searching.
  const inlineData = src => (typeof src === "string" ? src : [...src.querySelectorAll("script:not([src])")].map(s => s.textContent).join("\n")).replace(/\\"/g, '"');
  // The item's own record: { upc, dept, uom, factor } for Costco item number `sku`.
  function itemRecord(flat, sku) {
    if (!sku) return null;
    const i = flat.indexOf(`"id":"${sku}","clientId"`);
    if (i < 0) return null;
    const seg = flat.slice(i, i + 4000);
    const pick = k => { const m = seg.match(new RegExp(`"${k}":(?:"([^"]*)"|(null|[\\d.]+))`)); return m ? (m[1] != null ? m[1] : m[2] === "null" ? null : m[2]) : null; };
    return { upc: pick("upc"), dept: pick("as400DeptName"), deptNumber: pick("as400DeptNumber"), uom: pick("uom"), factor: Number(pick("factor")) || null };
  }

  // The product photos (Costco's image host, gdx-assets.costco.com): the structured data's image, then the gallery's
  // large images on the page itself. Icons and thumbnails under 400 px are left out.
  const IMG = /^https:\/\/gdx-assets\.costco\.com\//;
  function images(src, p) {
    const out = [].concat((p && p.image) || []).map(u => typeof u === "string" ? u : u && u.url).filter(u => typeof u === "string" && IMG.test(u));
    if (typeof src !== "string" && src.querySelectorAll) for (const im of src.querySelectorAll("img")) { const u = im.currentSrc || im.src; if (IMG.test(u) && (im.naturalWidth || 0) >= 400) out.push(u); }
    return [...new Set(out)].slice(0, 12);
  }

  // The parts of the page the extension uses, in Walmart's product shape.
  function product(src) {
    if (!src) return null;
    const ld = ldBlocks(src), p = ld.find(j => j["@type"] === "Product"), bc = ld.find(j => j["@type"] === "BreadcrumbList");
    if (!p || !p.name) return null;
    const sku = p.sku ? String(p.sku) : "";
    const rec = /** @type {any} */ (itemRecord(inlineData(src), sku) || {});
    const crumbs = bc && Array.isArray(bc.itemListElement) ? bc.itemListElement.map(x => x && (x.name || (x.item && x.item.name))).filter(Boolean) : [];
    const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    const now = offer && Number(offer.price);
    // Unit price from the item's size when it's in ounces (the page shows the same "$0.21/per ounce").
    const perOz = rec.uom === "OUNCE" && rec.factor > 0 && now > 0 ? Math.round(now / rec.factor * 1000) / 1000 : null;
    const upc = rec.upc && /^\d{8,14}$/.test(rec.upc) && !/^0+$/.test(rec.upc) ? rec.upc : "";
    return {
      id: sku || null, name: String(p.name).trim(), upc, brand: p.brand && typeof p.brand === "object" ? p.brand.name || "" : String(p.brand || ""),
      category: crumbs.filter(c => !/^home$/i.test(c)),
      ingredients: "", nutrition: null, labelRows: [],
      dept: rec.dept || null,
      price: now > 0 ? { now, perUnit: perOz, unit: perOz ? "oz" : null, text: perOz ? `$${perOz.toFixed(2)}/oz` : "" } : null,
      images: images(src, p),
    };
  }

  // Costco's department says what a product is better than its category path, which files paper towels under
  // "Grocery & Household Essentials". Food departments; anything else with a department is not food.
  const FOOD_DEPT = /food|produce|meat|deli|bakery|dairy|frozen|seafood|beverage|coffee|candy|snack|grocery/i;
  function plan(p) {
    if (!p) return { kind: "none", why: "Not a product page." };
    if (SUP && SUP.isSupplement({ category: p.category, name: p.name })) return { kind: "supplement", rows: [], serving: "" };
    if (p.dept && !FOOD_DEPT.test(p.dept)) return { kind: "none", why: "Not a food." };
    // Fresh produce: the app's typical values by name. Costco's produce codes (bananas carry "40000030669") are its own,
    // not barcodes a nutrition database knows.
    if (/^produce$/i.test(p.dept || "")) return { kind: "name", query: W.produceQuery(p.name), fallback: null };
    return W.plan(p);
  }

  return { productId, product, plan, itemRecord, ldBlocks, FOOD_DEPT };
});
