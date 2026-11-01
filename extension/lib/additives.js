// Additives and processing level for scanned products (Open Food Facts additives_tags, nova_group, ingredients).
// Every additive is listed with what it does. Only a short list is flagged, each for a documented reason:
// regulators that have removed it from food, or the processed-meat cancer link for nitrites. Most additives are
// judged safe at normal intakes by the FDA and EFSA, so the rest are shown without a rating.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./additives-data.js"), require("./additive-notes.js"));
  else root.SelfCheckAdditives = factory(root.SelfCheckAdditivesData, root.SelfCheckAdditiveNotes);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (DATA, NOTES_DATA) {
  const { FUNCTION = {}, NOTES = {}, STATUS = {} } = NOTES_DATA || {};
  const SRC = {
    tio2: "https://fas.usda.gov/data/european-union-titanium-dioxide-banned-food-additive-eu",
    red3: "https://mcguirewoods.com/client-resources/alerts/2025/1/fda-bans-red-dye-no-3-food-drugs-sets-deadlines-manufacturers-reformulate",
    bvo: "https://www.fda.gov/food/hfp-constituent-updates/fda-revokes-regulation-allowing-use-brominated-vegetable-oil-bvo-food",
    pho: "https://www.packaginglaw.com/index.php/news/fda-announces-final-determination-partially-hydrogenated-oils-are-not-gras",
  };
  // removed: a regulator has taken it out of food, so a product with it can't be a top pick.
  const NITRITE = { t: "A curing salt in bacon, ham and hot dogs. The WHO's cancer agency classifies processed meat as a cause of colorectal cancer, and nitrites are thought to be part of why." };
  const FLAGS = {
    e171: { t: "Banned as a food additive in the EU since 2022. Still allowed in the US.", src: SRC.tio2, removed: true },
    e127: { t: "The FDA revoked its approval in January 2025; foods must drop it by January 15, 2027.", src: SRC.red3, removed: true },
    e443: { t: "The FDA revoked its approval in 2024; it's no longer allowed in US food from August 2025.", src: SRC.bvo, removed: true },
    e249: NITRITE, e250: NITRITE, e251: NITRITE, e252: NITRITE,
  };
  // Ingredients that have no E-number, found in the ingredient text.
  const TEXT_FLAGS = [
    { code: "pho", re: /partially[ -]hydrogenated/i, name: "Partially hydrogenated oil", fn: "fat", what: "Vegetable oil partly hydrogenated to make it solid.",
      t: "The main source of artificial trans fat. The FDA ruled in 2015 that it isn't safe (not GRAS) and gave food makers until 2018 to remove it.", src: SRC.pho, removed: true },
  ];
  const NOVA = {
    1: ["Unprocessed or minimally processed", "Whole foods, or foods only dried, frozen, ground or pasteurized."],
    2: ["Processed culinary ingredient", "Oils, butter, sugar, salt: ingredients for cooking rather than foods on their own."],
    3: ["Processed food", "A whole food with salt, sugar or oil added, like canned vegetables, cheese or fresh bread."],
    4: ["Ultra-processed", "Made mostly from industrial ingredients (isolates, modified starches, additives) rather than whole foods."],
  };
  // US spelling for the function names in the Open Food Facts taxonomy.
  const US = s => s.replace(/colour/g, "color").replace(/flavour/g, "flavor").replace(/stabiliser/g, "stabilizer");

  // en:e322i → { code: "E322i", name: "Lecithins", fn: "antioxidant, emulsifier" }. Unknown sub-variants fall back
  // to the base number (e322i → e322).
  function lookup(tag) {
    const code = String(tag).replace(/^[a-z]{2}:/, "").toLowerCase();
    const d = DATA[code] || DATA[code.replace(/[a-z]+$/, "")];
    const base = code.match(/^e\d+/) ? code.match(/^e\d+/)[0] : code;
    const flag = FLAGS[code] || FLAGS[base] || null;
    const fn = d ? US(d[1]) : "";
    return describe({ code: code.toUpperCase().replace(/^E(\d+)([A-Z]*)$/, (m, n, v) => "E" + n + v.toLowerCase()), key: code, base,
      name: d ? d[0] : code.toUpperCase(), fn, efsaHigh: !!(d && d[2]), flag }, NOTES[code] || NOTES[code.replace(/(iv|v?i{1,3}|v)$/, "")]);
  }
  // Adds what it is, what it does, and a status: removed (a regulator took it out of food), mixed, safe, or
  // unreviewed. A flag's reason and source take precedence for flagged additives.
  const PRIMARY = ["sweetener", "color", "preservative", "raising agent", "flavor enhancer", "acid", "emulsifying salts", "gelling agent", "thickener",
    "emulsifier", "acidity regulator", "stabilizer", "humectant", "firming agent", "glazing agent", "anti-caking agent", "antioxidant", "sequestrant"];
  const rank = c => { const i = PRIMARY.indexOf(c); return i < 0 ? PRIMARY.length : i; };
  function describe(a, note) {
    // Taxonomy functions are alphabetical; describe the usual main job (lecithin: emulsifier, not antioxidant).
    const fns = a.fn.split(", ").filter(c => FUNCTION[c]).sort((x, y) => rank(x) - rank(y));
    // A reviewed note's own role wins; the taxonomy's function list is a fallback (it calls citric acid an antioxidant).
    const role = note && note.role ? note.role : note && note.what ? "" : fns.length ? FUNCTION[fns[0]] : "";
    const status = a.flag && a.flag.removed ? "removed" : note ? note.status : a.flag ? "mixed" : "unreviewed";
    return { ...a, what: note ? note.what : "", role, status, statusLabel: (STATUS[status] || {}).label || "", statusHint: (STATUS[status] || {}).hint || "",
      note: a.flag ? a.flag.t : note && note.note || "", src: a.flag && a.flag.src || note && note.src || "" };
  }

  // Additive names in a plain ingredient list (USDA Branded gives text, not E-number tags): "Red 40", "xanthan gum",
  // "mono and diglycerides". Longest names are tried first, and only whole words count.
  let TERMS = null;
  function findInText(text) {
    if (!text) return [];
    if (!TERMS) {
      TERMS = [];
      for (const [code, d] of Object.entries(DATA)) {
        // d[3] holds the matchable names (the build script leaves out ones that are also everyday words).
        const names = (d[3] ? d[3].split("|") : []).filter(t => t.length >= 4);
        for (const t of new Set(names)) TERMS.push([t, code]);
      }
      TERMS.sort((a, b) => b[0].length - a[0].length);
    }
    let low = " " + String(text).toLowerCase().replace(/[^a-z0-9.%-]+/g, " ") + " ";
    const found = [];
    for (const [t, code] of TERMS) {
      const needle = " " + t.replace(/[^a-z0-9.%-]+/g, " ").trim() + " ";
      if (needle.trim().length < 4 || !low.includes(needle)) continue;
      if (!found.includes(code)) found.push(code);
      low = low.split(needle).join(" ~ "); // a longer match ("sodium benzoate") hides its parts ("benzoate")
    }
    return found.map(c => "en:" + c);
  }

  // Everything the app shows about a product's additives. null when the source has no additive data at all
  // (built-in foods, USDA results, products scanned before this was added).
  function analyze(f) {
    if (!f || (!Array.isArray(f.additives) && !f.nova && !f.ingredients)) return null;
    // Open Food Facts tags its additives; for other sources, find them in the ingredient text.
    const fromText = !Array.isArray(f.additives) && !!f.ingredients;
    const tags = fromText ? findInText(f.ingredients) : f.additives || [];
    const seen = new Set(), items = [];
    for (const tag of tags) {
      const a = lookup(tag);
      if (seen.has(a.base)) continue; // e322 and e322i are the same additive on a label
      seen.add(a.base); items.push(a);
    }
    for (const x of TEXT_FLAGS) if (x.re.test(f.ingredients || "") && !seen.has(x.code)) items.push(describe({ code: "", key: x.code, base: x.code, name: x.name, fn: x.fn, efsaHigh: false, flag: x }, { what: x.what }));
    const nova = [1, 2, 3, 4].includes(Number(f.nova)) ? Number(f.nova) : null;
    return { items, flagged: items.filter(a => a.flag), removed: items.some(a => a.flag && a.flag.removed), nova, novaInfo: nova ? NOVA[nova] : null, known: Array.isArray(f.additives) || fromText, fromText };
  }

  // Does skip-list term `t` (already lowercased) name one of this product's additives? "sucralose", "e955" or "955".
  function skipAdditive(f, t) {
    const info = analyze(f);
    if (!info) return null;
    const term = t.replace(/\s+/g, " ").trim();
    return info.items.find(a => a.key === term || a.base === term || "e" + term === a.base ||
      (` ${a.name.toLowerCase()} `).includes(` ${term} `)) || null;
  }

  return { lookup, analyze, skipAdditive, findInText, FLAGS, TEXT_FLAGS, NOVA, SRC };
});
