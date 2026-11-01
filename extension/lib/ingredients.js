// Reads a label's ingredient list and sorts each ingredient into plain groups (foods, added sugars, oils and fats,
// additives by job, flavorings, ...) with a short note on each group. It describes; it doesn't score. The verdict
// already counts what matters by amount (added sugar, saturated fat, sodium), and an ingredient's effect depends on
// how much is in the food, which the list doesn't say beyond its order. US labels list ingredients from most to
// least by weight, so the position is shown for sugars and fats near the top.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./additives.js"));
  else root.SelfCheckIngredients = factory(root.SelfCheckAdditives);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (A) {
  const ALLERGEN = "milk|eggs?|wheat|soy|soybeans?|peanuts?|tree nuts?|almonds?|cashews?|pecans?|walnuts?|hazelnuts?|pistachios?|macadamia(?: nuts?)?|brazil nuts?|coconut|fish|anchov(?:y|ies)|tuna|salmon|cod|pollock|tilapia|shellfish|crustacean shellfish|shrimp|crab|lobster|sesame";
  const ALLERGEN_RUN = new RegExp(`\\b(?:contains|allergens?)\\s*:?\\s*((?:${ALLERGEN})(?:\\s*(?:,|and|&|\\/)\\s*(?:${ALLERGEN}))*)\\b\\.?`, "i");
  const MAY = /\b(?:may contain|made (?:in|on) (?:a )?(?:facility|shared equipment|equipment)|processed in a facility)[^.]*\.?/gi;
  const MINOR = /(?:contains\s+)?(?:less than\s+)?2\s*%\s+or\s+less\s+(?:of\s*)?(?:the following\s*)?:?|contains\s+less\s+than\s+2\s*%\s+of\s*:?/gi;

  // Split on commas and semicolons outside parentheses/brackets.
  function splitTop(s) {
    const out = []; let depth = 0, cur = "";
    for (const ch of s) {
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      if ((ch === "," || ch === ";") && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
  }
  const tidy = s => s.replace(/^(?:ingredients?\s*:?\s*)/i, "").replace(/^(?:and\/or|and|or|&)\s+/i, "").replace(/^(?:cured|made|prepared|packed|seasoned) (?:with|in)\s*:?\s+/i, "").replace(/^[a-z][a-z &-]{1,30}:\s+(?=\S)/i, "").replace(/^[\s:.*†‡-]+|[\s.*†‡]+$/g, "").replace(/\s+/g, " ").trim();
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  // Title case, keeping acronyms (EDTA, BHT) unless the whole label is in capitals.
  const ACRONYM = /\b(Bha|Bht|Tbhq|Edta|Datem|Msg|Hfcs|Dha|Epa|Mct|Fd&c|Usda|Ph)\b/g;
  const SMALL = /(?!^)\b(And|Or|Of|To|For|With|In|A|An|The|From)\b/g;
  const titleAll = s => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const title = s => (s === s.toUpperCase() ? titleAll(s) : s.split(/(\s+)/).map(w => /[A-Z]{2}/.test(w) && w === w.toUpperCase() ? w : titleAll(w)).join(""))
    .replace(SMALL, w => w.toLowerCase()).replace(ACRONYM, w => w.toUpperCase()).replace(/^./, c => c.toUpperCase());
  // "(Preservative <0.1%)", "(For Color)", "(Corn)": a role or a source, not sub-ingredients.
  const ROLE_NOTE = /^(?:an? )?(?:preservatives?|to (?:preserve|protect|maintain|retain|promote)[^)]*|for (?:color|freshness|flavor)[^)]*|added (?:to|for|as)[^)]*|color|colour|emulsifiers?|stabilizers?|thickeners?|antioxidants?|leavening|leavening agents?|acidulants?|vitamin [a-z]\d*|[^,]{0,25}?<\s*\d[^)]*|\d[^)]*%[^)]*)$/i;

  // "Calcium Disodium EDTA Added to Protect Flavor", "Citric Acid (to preserve freshness)": the job, not the name.
  const PURPOSE = /\s+(?:(?:is |was )?added\s+)?(?:to|for)\s+(?:help\s+)?(?:protect|preserve|maintain|retain|promote|prevent|keep|improve|enhance|color|freshness)\b.*$|\s+(?:used\s+)?as\s+an?\s+(?:preservative|emulsifier|thickener|stabilizer)\b.*$/i;
  function entry(raw, minor) {
    let name = tidy(raw), sub = [], note = "";
    const pm = name.match(/^(.*?)\s*[([{](.*)[)\]}]\s*$/);
    if (pm) {
      const inner = pm[2].trim();
      name = tidy(pm[1]);
      if (/,|;/.test(inner) && !ROLE_NOTE.test(inner)) sub = splitTop(inner).map(x => entry(x, minor)).filter(Boolean);
      else note = inner;
    }
    const pu = name.match(PURPOSE);
    if (pu && name.length - pu[0].length >= 3) { note = note || tidy(pu[0]); name = tidy(name.slice(0, -pu[0].length)); }
    if (!name || name.length > 120) return null;
    return { name, sub, note, minor };
  }

  // Parse a label. Returns null for empty text.
  function parse(text) {
    if (!text || typeof text !== "string") return null;
    let s = " " + text.replace(/\s+/g, " ") + " ";
    let contains = null;
    const m = s.match(ALLERGEN_RUN);
    if (m) { contains = m[1].replace(/\s*(?:,|&|\/)\s*|\s+and\s+/gi, ", ").split(", ").map(x => cap(x.trim().toLowerCase())).filter(Boolean).join(", "); s = s.replace(m[0], " "); }
    const may = (s.match(MAY) || []).map(x => tidy(x)).filter(Boolean);
    s = s.replace(MAY, " ");
    // Everything after a "2% or less of" marker is a minor ingredient.
    const parts = s.split(MINOR);
    const items = [];
    parts.forEach((part, pi) => {
      // Periods end a list only when a new sentence starts ("... Flavor. Contains" was removed above).
      const raws = splitTop(part.replace(/\.\s+(?=[A-Z])/g, ", "));
      // "Pepperoni Made with Pork, Chicken, and Beef (Pork, ...)": one ingredient whose name has commas.
      for (let i = 0; i < raws.length; i++) {
        if (/\bmade (?:with|from)\b/i.test(raws[i]) && !/[(\[]/.test(raws[i])) {
          const j = raws.findIndex((r, k) => k > i && k <= i + 4 && /^\s*and\s/i.test(r));
          if (j > 0) raws.splice(i, j - i + 1, raws.slice(i, j + 1).join(", "));
        }
      }
      // Footnotes and label statements aren't ingredients: "*to preserve quality", "Contains 0% fruit juice".
      for (const raw of raws.filter(r => !/^\W*(?:to|for)\s+(?:preserve|protect|maintain|retain|promote|prevent|keep)\b/i.test(r) && !/^\W*contains\s+(?:less than\s+)?\d+(?:\.\d+)?\s*%\s+(?:fruit\s+)?juice\b/i.test(r))) {
        const e = entry(raw, pi > 0);
        if (e) items.push(e);
      }
    });
    // "Potassium Sorbate and Sodium Benzoate (Preservatives)": two additives in one entry.
    const out = [];
    for (const it of items) {
      const halves = it.name.split(/\s+(?:and|&)\s+/i);
      if (halves.length === 2 && halves.every(h => A && A.findInText(h).length === 1 && A.findInText(it.name).length === 2)) halves.forEach(h => out.push({ ...it, name: h.trim() }));
      else out.push(it);
    }
    return { items: out, contains, may };
  }

  const SUGAR = /\b(?:sugars?|cane juice|corn syrup|high[- ]fructose|hfcs|syrup|dextrose|fructose|glucose|sucrose|maltose|lactose added|honey|molasses|agave|nectar|caramel(?! color)|invert|treacle|panela|jaggery|turbinado|demerara|muscovado|brown rice syrup|malt syrup|barley malt|fruit juice concentrate|juice concentrate|coconut sugar|date sugar|evaporated cane)\b/i;
  const NOT_SUGAR = /\b(?:sugar alcohol|sugar[- ]free|no sugar|sugar snap|maltodextrin)\b/i;
  const OIL = /\b(?:oils?|butter(?!milk)|ghee|lard|tallow|shortening|margarine|fat|cream(?! of tartar)|suet)\b/i;
  const NOT_OIL = /\b(?:peanut butter|almond butter|nut butter|cashew butter|cocoa butter|apple butter|butter ?milk|oil of|essential oil|fat[- ]free|nonfat|non-fat|low[- ]fat|reduced fat|milkfat)\b/i;
  const SAT_FAT = /\b(?:palm|palm kernel|coconut|butter|ghee|lard|tallow|cream|shortening|fully hydrogenated|hydrogenated|beef fat|pork fat|chicken fat|cocoa butter)\b/i;
  const UNSAT = /\b(?:olive|canola|rapeseed|soybean|soy|sunflower|safflower|corn|peanut|avocado|sesame|grapeseed|cottonseed|rice bran|flaxseed|walnut|almond|vegetable|high oleic)\b/i;
  const SALT = /^(?:sea |kosher |iodized |pink |himalayan |rock )?salt$|^salt and pepper$/i;
  const BASIC = /^(?:water|filtered water|carbonated water|ice|distilled (?:white )?vinegar|vinegar|white vinegar|cider vinegar|apple cider vinegar)$/i;
  const FLAVOR = /\b(?:flavou?rs?|flavou?ring|spices?|seasonings?|extracts?|smoke|natural flavou?r|artificial flavou?r)\b/i;
  const REFINED = /\b(?:modified (?:food |corn |tapioca |potato )?starch|(?:corn|potato|tapioca|wheat|rice) starch|starch|maltodextrin|enriched|bleached|unbleached (?:enriched )?(?:wheat )?flour|wheat flour|white flour|all[- ]purpose flour|rice flour|degermed|semolina|dextrin)\b/i;
  const WHOLE_GRAIN = /\b(?<!malted )(?:whole (?:wheat|grain|oat|corn|rye|spelt)|rolled oats|oats|oatmeal|brown rice|wild rice|quinoa|(?<!malted )barley(?! malt)|bulgur|millet|buckwheat|whole wheat flour|popcorn)\b/i;
  const NUTRIENT = /\b(?:vitamins?|niacin(?:amide)?|thiamin(?:e)?(?: mononitrate| hydrochloride)?|riboflavin|folic acid|folate|reduced iron|iron|zinc (?:oxide|sulfate)|ferrous|pyridoxine|cyanocobalamin|biotin|pantothen|calcium carbonate|tricalcium phosphate|potassium iodide|cholecalciferol|ergocalciferol|ascorbic acid|tocopheryl acetate|retinyl palmitate|beta[- ]carotene|choline|magnesium oxide)\b/i;
  const ISOLATE = /\b(?:protein isolate|protein concentrate|isolated (?:soy|pea|whey) protein|hydrolyzed|textured vegetable protein|vital wheat gluten|whey protein|milk protein|caseinate|collagen|gelatin)\b/i;
  const SWEETENER = /\b(?:sucralose|aspartame|acesulfame|saccharin|stevia|rebaudioside|reb m|steviol|monk fruit|luo han guo|erythritol|xylitol|sorbitol|maltitol|allulose|isomalt|neotame|advantame)\b/i;

  // Common US label names the additive list doesn't match by itself (it skips short names like BHA and everyday words).
  /** @type {Array<[RegExp, string]>} */
  const ALIAS = [
    [/^(?:soy|soya|sunflower|canola)? ?lecithin$/, "e322"], [/^(?:baking soda|sodium bicarbonate)$/, "e500"],
    [/^(?:distilled )?(?:mono ?-?(?:and|&) ?di-?glycerides|monoglycerides|diglycerides|mono and diglycerides)$/, "e471"],
    [/^(?:monocalcium|dicalcium|mono-calcium) phosphate$/, "e341"], [/^sodium acid pyrophosphate$/, "e450"], [/^sodium aluminum phosphate$/, "e541"],
    [/^(?:tri)?sodium citrate$/, "e331"], [/^potassium citrate$/, "e332"], [/^(?:mono|di)?potassium phosphate$/, "e340"],
    [/^(?:di|tri)?sodium phosphates?$/, "e339"], [/^glycerol ester of (?:wood )?rosin$/, "e445"], [/^polydextrose$/, "e1200"],
    [/^fumaric acid$/, "e297"], [/^malic acid$/, "e296"], [/^bha$/, "e320"], [/^bht$/, "e321"], [/^tbhq$/, "e319"],
    [/^sodium erythorbate$/, "e316"], [/^annatto(?: extract| color)?$/, "e160b"], [/^(?:oleoresin of paprika|paprika (?:extract|oleoresin)|extractives of paprika)$/, "e160c"],
    [/^sodium stearoyl lactylate$/, "e481"], [/^calcium stearoyl lactylate$/, "e482"], [/^agar(?:[- ]agar)?$/, "e406"], [/^azodicarbonamide$/, "e927a"], [/^cellulose gum$/, "e466"], [/^(?:microcrystalline |powdered )?cellulose$/, "e460"],
    [/^gellan gum$/, "e418"], [/^locust bean gum$/, "e410"], [/^pectin$/, "e440"], [/^silicon dioxide$/, "e551"], [/^calcium sulfate$/, "e516"],
  ];
  // Entries that name a job, not a substance ("Leavening", "Artificial Color").
  /** @type {Array<[RegExp, string, string]>} */
  const GENERIC = [
    [/^leavening(?: agents?)?$/, "Leavening", "Makes dough rise; the label doesn't say which ones."],
    [/^(?:artificial colou?rs?|colou?r added|colou?rs?|colou?ring|artificial colou?ring)$/, "Coloring", "Added color; the label doesn't say which."],
    [/^enzymes?$/, "Enzymes", "Proteins that help process the food; mostly inactive by the time you eat it."],
    [/^anti-?caking (?:blend|agents?)$/, "Anti-caking agent", "Keeps shredded or powdered food from clumping, often a starch or cellulose."],
    [/^(?:dough conditioners?|yeast nutrients?)$/, "Dough conditioner", "Helps bread dough rise and stay soft."],
    [/^ticaloid\b.*$/, "Gum blend (Ticaloid)", "A blend of food gums that thickens drinks and powders."],
    [/^carbon monoxide$/, "Carbon monoxide", "A packaging treatment that keeps fish and meat looking red; it doesn't stop spoilage, so go by the date and smell."],
  ];
  const STIM = /\b(?:caffeine|taurine|guarana|ginseng|l-?carnitine|carnitine|creatine|glucuronolactone|yerba mate extract|green tea extract|green coffee extract|theanine|inositol)\b/i;

  // Group order on screen, with a plain-language note for each.
  const GROUPS = {
    food: { label: "Foods", tone: "good", note: "Recognizable foods: what you'd cook with at home." },
    grain: { label: "Whole grains", tone: "good", note: "Keep the bran and germ, with their fiber." },
    basic: { label: "Water, salt and vinegar", tone: "plain", note: "Kitchen basics. Sodium is counted in the bars above." },
    sugar: { label: "Added sugars", tone: "warn", note: "Count toward your added-sugar limit, whatever the name." },
    fat: { label: "Oils and fats", tone: "plain", note: "" },
    refined: { label: "Refined starches and flours", tone: "plain", note: "Processed carbohydrates with most of the fiber removed. Often used as thickeners in small amounts." },
    sweetener: { label: "Low- and no-calorie sweeteners", tone: "plain", note: "Sweet without sugar's calories; the WHO advises against relying on them for weight control." },
    isolate: { label: "Processed protein ingredients", tone: "plain", note: "Protein separated out of a food. A sign of an industrially made product, not harmful in itself." },
    flavor: { label: "Flavorings", tone: "plain", note: "Concentrated flavor compounds. “Natural” ones must come from a plant or animal source and “artificial” ones don't; both are approved for food, and the label doesn't say which compounds." },
    stim: { label: "Caffeine and energy ingredients", tone: "plain", note: "The label doesn't always give the caffeine amount; the FDA cites 400 mg a day as an amount not generally linked to negative effects in healthy adults." },
    nutrient: { label: "Added vitamins and minerals", tone: "good", note: "Added back (enrichment) or added on top (fortification)." },
    additive: { label: "Additives", tone: "plain", note: "" },
  };
  const ORDER = Object.keys(GROUPS);
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

  function classify(name) {
    const n = name.toLowerCase();
    if (/partially[ -]hydrogenated/i.test(n)) return { group: "fat", kind: "pho" };
    if (SWEETENER.test(n)) return { group: "sweetener" };
    if (STIM.test(n)) return { group: "stim" };
    const bare = n.replace(/[*†.]/g, "").trim();
    for (const [re, code] of ALIAS) if (re.test(bare) && A) return { group: "additive", additive: A.lookup("en:" + code) };
    for (const [re, label, role] of GENERIC) if (re.test(bare)) return { group: "additive", additive: { name: label, code: "", base: "generic:" + label, role, what: "", status: "generic", statusLabel: "", statusHint: "", note: "", src: "" } };
    if (NUTRIENT.test(n) && !/\bsalt\b/.test(n)) return { group: "nutrient" };
    const codes = A ? A.findInText(name) : [];
    // An additive by name, unless it's only part of a food's name ("citric acid" in "lemon juice with citric acid" stays a food).
    if (codes.length && !SUGAR.test(n)) {
      const a = A.lookup(codes[0]);
      const plain = n.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const isMain = (A.findInText(plain).length >= 1) && plain.split(" ").length <= a.name.split(" ").length + 3;
      if (isMain) return { group: "additive", additive: a };
    }
    if (SALT.test(n) || BASIC.test(n)) return { group: "basic" };
    if (SUGAR.test(n) && !NOT_SUGAR.test(n)) return { group: "sugar" };
    if (OIL.test(n) && !NOT_OIL.test(n)) return { group: "fat", kind: SAT_FAT.test(n) && !/olive|canola|sunflower|safflower|soybean|avocado/.test(n) ? "sat" : UNSAT.test(n) ? "unsat" : "fat" };
    if (WHOLE_GRAIN.test(n)) return { group: "grain" };
    if (REFINED.test(n)) return { group: "refined" };
    if (ISOLATE.test(n)) return { group: "isolate" };
    if (FLAVOR.test(n) && !/\b(?:garlic|onion|pepper|herbs?|basil|oregano|cinnamon|vanilla bean)\b/.test(n.replace(/natural|artificial|flavou?rs?/g, ""))) return { group: "flavor" };
    return { group: "food" };
  }

  // Claims in the product's name that an ingredient list can contradict. Crowd-sourced records sometimes carry
  // another variety's ingredients (caffeine in a caffeine-free soda), so a contradiction is shown as a warning,
  // not listed as fact.
  const CLAIMS = [
    { claim: "caffeine-free", name: /caffeine[- ]free|\bdecaf(?:feinated)?\b|no caffeine|zero caffeine|0 ?mg caffeine/i, hit: n => /\bcaffeine\b/i.test(n) && !/decaf/i.test(n) },
    { claim: "sugar-free", name: /sugar[- ]free|zero sugar|\bno sugar\b|sugarless|no (?:sugar added|added sugars?)/i, hit: (n, c) => c.group === "sugar" },
    { claim: "gluten-free", name: /gluten[- ]free/i, hit: n => /\b(?:wheat|barley|rye|malt|spelt|triticale|semolina|durum|farina|kamut|seitan)\b/i.test(n) && !/gluten[- ]free|buckwheat|deglutenized/i.test(n) },
  ];

  // Everything the card and the app show. null when there's no ingredient text. `name` is the product's name (or
  // several, joined), checked against the list for contradictions.
  function analyze(text, name = "") {
    const p = parse(text);
    if (!p || !p.items.length) return null;
    const groups = {}, seen = new Set(), conflicts = [];
    const claims = CLAIMS.filter(c => c.name.test(name || ""));
    let pos = 0;
    const add = (it, sub) => {
      const key = it.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!sub) pos++;
      const c = classify(it.name);
      const claim = claims.find(x => x.hit(it.name, c));
      if (claim) {
        const k = claim.claim, prev = conflicts.find(x => x.claim === k);
        if (prev) { if (!prev.items.includes(title(it.name))) prev.items.push(title(it.name)); } else conflicts.push({ claim: k, items: [title(it.name)] });
      }
      const dupKey = c.additive ? c.additive.base : key;
      if (seen.has(dupKey)) return;
      seen.add(dupKey);
      const g = groups[c.group] || (groups[c.group] = { key: c.group, ...GROUPS[c.group], items: [] });
      g.items.push({ name: title(it.name), pos: sub ? it.headed || null : pos, inside: it.headed ? null : sub || null, minor: it.minor, note: it.note && !ROLE_NOTE.test(it.note) ? it.note : "", kind: c.kind || null, additive: c.additive || null,
        // Listed, but marked: the product's name says otherwise, so the list (or the name) is likely wrong.
        conflict: claim ? `The product name says ${claim.claim}. Check the package.` : null });
    };
    // A heading like "Preservatives (Calcium Propionate, Sorbic Acid)" or "Leavening (Baking Soda, …)" isn't an
    // ingredient of its own: what's inside is listed instead (still counted in the label's order).
    const heading = it => it.sub.length && /^(?:preservatives?|leavening(?: agents?)?|emulsifiers?|stabilizers?|thickeners?|colou?rs?|colou?rings?|dough conditioners?|vitamins and minerals|spices?)$/i.test(it.name);
    for (const it of p.items) { if (heading(it)) { pos++; it.sub.forEach(x => { x.headed = pos; }); continue; } add(it); }
    // Sub-ingredients ("Dill Relish (Cucumber, Vinegar, Salt, Xanthan Gum ...)"): only the additives, sugars and fats inside
    // are worth listing separately; the rest is what the named food is made of. Top-level entries go first, so an
    // ingredient listed both ways keeps its place in the list.
    const subs = (it, parent) => { for (const s of it.sub) { const c = classify(s.name);
      if (["additive", "sugar", "fat", "sweetener", "refined", "stim"].includes(c.group)) add(s, parent); subs(s, parent); } };
    for (const it of p.items) subs(it, title(it.name));
    // Notes that depend on what's there.
    const out = ORDER.filter(k => groups[k]).map(k => groups[k]);
    // Label order inside each group; ingredients only found inside another one go last.
    for (const g of out) g.items.sort((x, y) => (x.pos || 999) - (y.pos || 999));
    for (const g of out) {
      if (g.key === "sugar") {
        const first = g.items.find(i => i.pos);
        g.detail = g.items.length > 1 ? `${g.items.length} kinds of added sugar.` : "";
        if (first && first.pos <= 3) g.detail = `${g.detail} ${cap(first.name)} is the ${ordinal(first.pos)} ingredient, so there's a lot of it.`.trim();
      }
      if (g.key === "fat") {
        const kinds = new Set(g.items.map(i => i.kind));
        g.note = kinds.has("pho") ? "Partially hydrogenated oil is the main source of artificial trans fat; the FDA ruled it unsafe in 2015."
          : kinds.has("sat") && !kinds.has("unsat") ? "Mostly saturated fats (palm, coconut, butter and the like). Saturated fat is counted in the bars above."
          : kinds.has("sat") ? "A mix: some mostly unsaturated oils and some saturated fats. Saturated fat is counted in the bars above."
          : "Mostly unsaturated oils, the kind that's better for cholesterol than butter or palm oil. They're still calorie-dense.";
        g.tone = kinds.has("pho") ? "bad" : kinds.has("sat") ? "warn" : "plain";
        const first = g.items.find(i => i.pos);
        if (first && first.pos <= 2) g.detail = `${cap(first.name)} is the ${ordinal(first.pos)} ingredient.`;
      }
      if (g.key === "additive") {
        const st = s => g.items.filter(i => i.additive.status === s).length;
        const bad = st("removed"), mixed = st("mixed");
        g.tone = bad ? "bad" : mixed ? "warn" : "plain";
        g.note = bad ? "At least one has been removed from food by a regulator; see below."
          : mixed ? `${mixed === 1 ? "One is" : `${mixed} are`} approved but with mixed evidence; the rest are considered safe or not reviewed here.`
          : "Approved for food. Those reviewed here are considered safe at normal amounts; each one's job is listed.";
      }
    }
    const count = p.items.length;
    const additives = groups.additive ? groups.additive.items.length : 0;
    const sugars = groups.sugar ? groups.sugar.items.length : 0;
    const concern = groups.additive ? groups.additive.items.filter(i => ["mixed", "removed"].includes(i.additive.status)).length : 0;
    const summary = [`${count} ingredient${count === 1 ? "" : "s"}`,
      additives ? `${additives} additive${additives === 1 ? "" : "s"}${concern ? ` (${concern} to know about)` : ""}` : "no additives found",
      sugars ? `${sugars} added sugar${sugars === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
    // A short line for a tooltip; the details sit next to each marked ingredient.
    const conflict = conflicts.length ? `Ingredient list conflicts with the name (${conflicts.map(c => `${c.items.join(", ")} in a ${c.claim} product`).join("; ")})` : null;
    return { groups: out, count, additives, sugars, concern, contains: p.contains, may: p.may, summary, conflicts, conflict };
  }

  return { parse, classify, analyze, GROUPS };
});
