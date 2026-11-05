// Reads a Kroger product page for the browser extension. Kroger's product addresses end in the item's barcode:
// "/p/cheerios-…-cereal/0001600027528" is UPC 016000275287 without its check digit, padded to 13 digits. So the
// route is the barcode (Open Food Facts, then USDA Branded Foods), worked out from the address alone; the page is only
// asked for its name, category and price, from its structured data (JSON-LD) or its title when it has them.
// Produce and items weighed in the store carry sticker codes (PLUs) or price-embedded codes there, not barcodes, and
// are matched to the app's foods by name. The product is returned in Walmart's shape (js/walmart.js).
// Kroger's site refuses requests from servers, so its page markup hasn't been checked; the address format has.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./walmart.js"), require("./costco.js"), require("./supplement.js"));
  else root.SelfCheckKroger = factory(root.SelfCheckWalmart, root.SelfCheckCostco, root.SelfCheckSupplement);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (W, CO, SUP) {
  // "/p/cheerios-gluten-free-heart-healthy-cereal/0001600027528" → "0001600027528".
  const productId = url => { const m = String(url).match(/\/p\/[^/?#]+\/(\d{13})(?:[/?#]|$)/); return m ? m[1] : null; };

  // GS1 check digit for the digits given (rightmost weighted 3, then 1, alternating).
  const checkDigit = digits => { let sum = 0; for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return String((10 - (sum % 10)) % 10); };
  // Kroger's 13-digit item id → the barcode: a 12-digit UPC-A (or 13-digit EAN), with the check digit put back.
  // Sticker codes (core of 6 digits or fewer, "0000000004011" for bananas) are returned as they are, for W.isPlu.
  function upcOf(id) {
    const s = String(id || "");
    if (!/^\d{13}$/.test(s)) return "";
    const core = s.replace(/^0+/, "");
    if (!core || core.length <= 6) return s;
    const gtin = s + checkDigit(s); // 14 digits
    return gtin.startsWith("00") ? gtin.slice(2) : gtin.slice(1);
  }
  // Items weighed or priced in the store: a UPC-A that starts with 2 (price or weight in the code), not a product's.
  const isInStore = id => /^0{1,2}2\d{9,10}$/.test(String(id || "")) && String(id).replace(/^0+/, "").length === 11;

  const decode = s => String(s || "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&reg;/g, "®").replace(/&trade;/g, "™").replace(/&nbsp;/g, " ");
  // A meta tag, the page title or the main heading, from a document or from fetched HTML.
  function meta(src, prop) {
    if (!src) return "";
    if (typeof src === "string") { const m = src.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i")) || src.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, "i")); return m ? decode(m[1]) : ""; }
    const el = src.querySelector && src.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`); return el ? el.getAttribute("content") || "" : "";
  }
  function heading(src) {
    if (!src) return "";
    if (typeof src === "string") { const m = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); return m ? decode(m[1].replace(/<[^>]+>/g, "")).trim() : ""; }
    const h = src.querySelector && src.querySelector("h1"); return h ? String(h.textContent || "").trim() : "";
  }
  // "Kroger - Cheerios Gluten Free Heart Healthy Cereal, 18 oz" / "… | Kroger" → the product's own name.
  const cleanTitle = t => String(t || "").replace(/\s*[|–-]\s*(Kroger|Ralphs|Fred Meyer|King Soopers)\s*$/i, "").replace(/^(Kroger|Ralphs|Fred Meyer|King Soopers)\s*[|–-]\s*/i, "").replace(/\s+/g, " ").trim();
  // "cheerios-gluten-free-heart-healthy-cereal" → "Cheerios gluten free heart healthy cereal", when the page says nothing.
  const fromSlug = url => { const m = String(url || "").match(/\/p\/([^/?#]+)\/\d{13}/); if (!m) return ""; const t = decodeURIComponent(m[1]).replace(/-+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };

  // The parts of the page the extension uses, in Walmart's product shape. Needs the page's address for the barcode.
  function product(src, url) {
    const id = productId(url);
    if (!id) return null;
    const ld = src ? CO.ldBlocks(src) : [];
    const p = ld.find(j => j && j["@type"] === "Product") || {}, bc = ld.find(j => j && j["@type"] === "BreadcrumbList");
    const crumbs = bc && Array.isArray(bc.itemListElement) ? bc.itemListElement.map(x => x && (x.name || (x.item && x.item.name))).filter(Boolean).map(String) : [];
    const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    const now = offer && Number(offer.price);
    const gtin = String(p.gtin13 || p.gtin12 || p.gtin || "").replace(/\D/g, "");
    const name = cleanTitle(p.name || meta(src, "og:title") || heading(src) || (typeof src === "string" ? (src.match(/<title>([^<]*)<\/title>/i) || [])[1] : src && src.title)) || fromSlug(url);
    return {
      id, name: decode(name), upc: gtin.length >= 8 && !/^0+$/.test(gtin) ? gtin : upcOf(id), brand: p.brand && typeof p.brand === "object" ? p.brand.name || "" : String(p.brand || ""),
      category: crumbs.filter(c => !/^(home|kroger)$/i.test(c)).concat(p.category ? [String(p.category)] : []),
      ingredients: "", nutrition: null, labelRows: [],
      inStore: isInStore(id),
      price: Number.isFinite(now) && now > 0 && now < 10000 ? { now, perUnit: null, unit: null, text: "" } : null,
      images: [].concat(p.image || []).map(u => typeof u === "string" ? u : u && u.url).filter(u => typeof u === "string" && /^https:\/\/www\.kroger\.com\/product\/images\//.test(u)).slice(0, 12),
      src: "kroger",
    };
  }

  // Not food, when the page says what it is (its breadcrumbs); otherwise the barcode decides.
  const NOT_FOOD = /household|cleaning|paper|laundry|beauty|personal care|pet|baby care|health care|pharmacy|home|kitchen|electronics|toys|apparel|office|garden|automotive/i;
  const FOOD = /food|grocery|produce|meat|seafood|deli|bakery|dairy|frozen|beverage|snack|pantry|breakfast|cereal|candy|natural & organic/i;
  function plan(p) {
    if (!p) return { kind: "none", why: "Not a product page." };
    if (SUP && SUP.isSupplement({ category: p.category, name: p.name })) return { kind: "supplement", rows: [], serving: "" };
    if (p.category.length && p.category.some(c => NOT_FOOD.test(c)) && !p.category.some(c => FOOD.test(c))) return { kind: "none", why: "Not a food." };
    if (W.isPlu(p.upc) || p.inStore || p.category.some(c => /^produce$|fresh fruit|fresh vegetable/i.test(c))) {
      const q = W.produceQuery(p.name);
      return q ? { kind: "name", query: q, fallback: null } : { kind: "none", why: "No nutrition facts or barcode on this page." };
    }
    if (p.upc && p.upc.replace(/^0+/, "").length >= 7) return { kind: "barcode", code: p.upc };
    return { kind: "none", why: "No nutrition facts or barcode on this page." };
  }

  return { productId, upcOf, checkDigit, isInStore, product, plan, cleanTitle, fromSlug };
});
