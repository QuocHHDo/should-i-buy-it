// Scoring rules, label-line explanations, serving scaling and swap suggestions.
// Pure functions: no DOM, so the same file runs in the browser and in Node tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./additives.js"), require("./allergens.js"));
  else root.SelfCheckVerdict = factory(root.SelfCheckAdditives, root.SelfCheckAllergens);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (ADD, AL) {
  const fmt = n => (Math.round(n * 10) / 10).toString();
  const NUM_KEYS = ["cal", "fat", "sat", "trans", "chol", "na", "carb", "fib", "sug", "add", "pro"];
  const RANK = { bad: 0, mid: 1, fine: 1.5, good: 2 };
  // Below this, a food with nothing to flag barely affects the day: the neutral "Fine" verdict.
  const NEGLIGIBLE_KCAL = 25;

  // A small, deliberately short list of foods whose benefits are well established by research but invisible on
  // the label (polyphenols, omega-3 types, long-term outcome trials). Each gets +1 and says why. Keep this list
  // short and evidence-based so the scoring stays label-driven and predictable.
  const FISH = "Strong research beyond the label: fatty fish supply the omega-3 fats EPA and DHA, and heart health groups recommend about two servings a week.";
  const NUTS = "Strong research beyond the label: people who eat nuts regularly have lower rates of heart disease in large studies, and nuts were a key food in the PREDIMED trial.";
  const EVIDENCE = {
    "Extra virgin olive oil": "Strong research beyond the label: extra virgin olive oil keeps polyphenols that refining removes, and in large trials like PREDIMED it was linked to fewer heart attacks and strokes. That puts it ahead of other oils.",
    "Salmon": FISH, "Salmon, canned": FISH, "Sardines, canned": FISH, "Trout": FISH,
    "Almonds": NUTS, "Walnuts": NUTS, "Pistachios": NUTS, "Mixed nuts": NUTS,
  };

  // Notes that don't change the score: context the label can't show.
  const ERYTHRITOL = "Most of these products are largely erythritol. A 2023 study linked high blood levels of erythritol to more heart attacks and strokes; it was observational and needs confirming, but it's a reason not to rely on large amounts.";
  const NOTES = {
    "Monk fruit sweetener": "Pure monk fruit extract is very sweet, so most packaged versions are mostly erythritol; check the ingredients. " + ERYTHRITOL.replace("Most of these products are largely erythritol. ", ""),
    "Stevia sweetener": "Packet stevia (like Truvia) is mostly erythritol. " + ERYTHRITOL.replace("Most of these products are largely erythritol. ", ""),
    "Erythritol": ERYTHRITOL.replace("Most of these products are largely erythritol. ", ""),
    "Allulose": "Allulose is a rare sugar that barely affects blood sugar; the FDA lets labels leave it out of sugar and added-sugar counts.",
    "Coconut sugar": "Coconut sugar is still sugar: it counts as added sugar the same as table sugar.",
    "Table salt": "Most sodium in a typical diet comes from packaged and restaurant food, not the salt shaker.",
  };

  // ---- missing data ----
  // A food from USDA or Open Food Facts can leave nutrients out (listed in f.missing). Those are unknown, not zero:
  // rules that need them don't fire, and the label shows "—". On a plate, a nutrient some items don't report is a
  // lower bound (listed in f.atLeast).
  const NUTRIENT_WORD = { cal: "calories", fat: "total fat", sat: "saturated fat", trans: "trans fat", chol: "cholesterol", na: "sodium",
    carb: "carbs", fib: "fiber", sug: "total sugars", add: "added sugar", pro: "protein" };
  const KEY_LIMITS = ["sat", "na", "add"];
  const isMissing = (f, k) => (f.missing || []).includes(k);
  const isLowerBound = (f, k) => (f.atLeast || []).includes(k);
  const known = (f, k) => !isMissing(f, k);
  // A daily-limit nutrient whose amount we can't vouch for. Unknown added sugar on a raw or nearly sugar-free food
  // doesn't count: there's no room for much of it.
  // An unknown limit blocks "Get it" unless it can't matter. Added sugar can't when total sugars are known and below
  // the point where added sugar starts to cost a point (15% of the daily limit for a serving; for a meal, 70% of
  // its third): even if every gram were added, the verdict would be the same.
  const unknownLimit = (f, k, p, meal) => {
    if (!(isMissing(f, k) || isLowerBound(f, k))) return false;
    if (k !== "add") return true;
    if (f.addLikelyZero) return false;
    const cut = p && p.add > 0 ? p.add * (meal ? MEAL_CUT.limit[0] * MEAL_SHARE : CUT.add[0]) : 0;
    return !(cut > 0 && known(f, "sug") && !isLowerBound(f, "sug") && f.sug < cut);
  };
  const SOURCE_WORD = { usda: "USDA", off: "Open Food Facts", claude: "the lookup", walmart: "Walmart's nutrition panel" };
  const listWords = ks => { const w = ks.map(k => NUTRIENT_WORD[k]); return w.length <= 1 ? w.join("") : w.slice(0, -1).join(", ") + " or " + w.at(-1); };
  // "Partial data: USDA didn't report saturated fat or total sugars." (null when nothing is missing)
  function missingNote(f) {
    const order = k => NUM_KEYS.indexOf(k);
    const miss = (f.missing || []).filter(k => k !== "trans" && k !== "chol").sort((x, y) => order(x) - order(y)), low = [...(f.atLeast || [])].sort((x, y) => order(x) - order(y));
    if (miss.length && f.c === "plate") return `Partial data: no item on this plate reports ${listWords(miss)}.`;
    if (miss.length) return `Partial data: ${SOURCE_WORD[f.src] || "the source"} didn't report ${listWords(miss)}.`;
    if (low.length) return `Some items on this plate don't report ${listWords(low)}, so those totals are minimums ("at least").`;
    return null;
  }

  // ---- reason scoping ----
  // Foods whose fat is genuinely the healthy, mostly-unsaturated kind: nuts and seeds, fatty fish, avocado, olives and
  // liquid oils. Fried or breaded foods, desserts and dressings don't qualify even when their frying oil is unsaturated.
  const HEALTHY_FAT_NAME = /\b(avocados?|guacamole|olives?|almonds?|walnuts?|pecans?|cashews?|pistachios?|peanuts?|hazelnuts?|macadamias?|nuts|seeds?|tahini|flaxseed|chia|hemp|salmon|sardines?|trout|mackerel|herring|anchov(y|ies))\b/i;
  const NOT_HEALTHY_FAT = /fried|breaded|nugget|stick|chips?|crackers?|cookies?|candy|cups?|spread|sauce|dressing|bar\b|muffin|pastry|pie\b/i;
  const OIL_NAME = /\boil\b|cooking spray/i;
  function healthyFatSource(f) {
    if (!(f.fat > 0) || (f.tags || []).includes("processed") || NOT_HEALTHY_FAT.test(f.n)) return false;
    if (isMissing(f, "sat") || f.sat / f.fat > 0.25) return false;
    return OIL_NAME.test(f.n) || f.c === "nuts" || HEALTHY_FAT_NAME.test(f.n);
  }
  // ---- calibration (whole foods, density, treats) ----
  // Whole fruit and vegetables: their sugar comes with water, fiber and nutrients. Processed forms don't count.
  const NOT_WHOLE = /dried|raisin|juice|smoothie|salad|mashed|fries|tots|hash|chips|slaw|sweetened|syrup|sauce|salsa|guacamole|pickle|kimchi|sauerkraut|fruit cup|applesauce/i;
  const wholeProduce = f => (f.c === "fruit" || f.c === "veg") && !NOT_WHOLE.test(f.n) && !(f.tags || []).includes("treat")
    && !isMissing(f, "add") && f.add < 1 && !isMissing(f, "na") && f.na < 140;
  // Whole grains (name-based; built-in grains only).
  const WHOLE_GRAIN = /whole wheat|whole grain|brown rice|wild rice|\boats?\b|oatmeal|quinoa|barley|bulgur|farro|sprouted|shredded wheat|bran\b|popcorn, air/i;
  const wholeGrain = f => (f.c === "grains" || /popcorn, air/i.test(f.n)) && WHOLE_GRAIN.test(f.n) && !/instant oatmeal, flavored|granola|frosted/i.test(f.n);
  // Liquid or dried sugar (juice, smoothies, dried fruit) is where natural sugar adds up fast.
  const CONCENTRATED_SUGAR = /juice|smoothie|dried|raisin|lemonade|kombucha/i;

  // Grams in a serving string like "1 cup (240 g)" or "100 g", for energy density.
  function servingGrams(s) {
    const all = [...String(s || "").matchAll(/(\d+(?:\.\d+)?)\s*(g|ml)\b/g)];
    return all.length ? Number(all[all.length - 1][1]) : null;
  }

  // Net carbs: total carbohydrate minus fiber (US labels count fiber inside total carbs). Unknown fiber counts as zero,
  // so the number is never lower than it should be. null when carbs aren't reported.
  const netCarb = f => isMissing(f, "carb") ? null : Math.max(0, Math.round((f.carb - (isMissing(f, "fib") ? 0 : f.fib || 0)) * 10) / 10);
  // The daily-limit nutrients that block "Get it" when unknown: the carb limit joins them only when one is set.
  const limitsFor = p => p && p.carb > 0 ? [...KEY_LIMITS, "carb"] : KEY_LIMITS;

  // Generic starting goals (roughly FDA Daily Values on a 2,000-calorie diet).
  const DEFAULT_PROFILE = { cal: 2000, pro: 100, sat: 20, na: 2300, add: 50, fib: 28, carb: 0, skip: "", mild: false, allergies: [], allergyOther: "", diets: [] };

  // Skip-list matching on whole words with simple plurals: "egg" matches "Eggs" and "Breakfast sandwich, sausage and egg",
  // not "Eggplant" or "Veggie burger". Multi-word terms ("ground beef") must appear as that word sequence.
  const stemWord = w => w.replace(/'s$/, "").replace(/ies$/, "y").replace(/(s|x|z|ch|sh)es$/, "$1").replace(/([^s])s$/, "$1");
  const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stemWord);
  const hasPhrase = (hay, needle) => needle.length > 0 && hay.some((_, i) => needle.every((w, j) => hay[i + j] === w));
  function skipMatch(f, term) {
    const t = words(term);
    if (hasPhrase(words(f.n), t)) return { term, via: "name" };
    const alias = (f.a || []).find(a => hasPhrase(words(a), t));
    return alias ? { term, via: "alias", alias } : null;
  }
  function skipReason(f, p) {
    const list = String(p.skip || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const term of list) {
      const m = skipMatch(f, term);
      if (!m) {
        // The skip list also covers additives on scanned products: "sucralose", "carrageenan", "E407".
        const a = ADD && ADD.skipAdditive(f, term.toLowerCase());
        if (a) return { why: `It's on your skip list: it contains ${a.name.toLowerCase()}${a.code ? ` (${a.code})` : ""}.`, note: "Nutrition is shown for reference. Edit your skip list under Your goals." };
        continue;
      }
      const why = m.via === "name" ? `It's on your skip list: the name includes “${term.toLowerCase()}”.` : `It's on your skip list: it's also called “${m.alias}”, which includes “${term.toLowerCase()}”.`;
      return { why, note: "Nutrition is shown for reference. Edit your skip list under Your goals." };
    }
    return null;
  }

  // FDA Daily Values (2,000-calorie label). Positives need 10% DV; a Compare highlight needs 5% DV.
  const FDA_DV = { cal: 2000, fat: 78, sat: 20, chol: 300, na: 2300, carb: 275, fib: 28, add: 50, pro: 50, sug: 50 };
  const POS_FLOOR = { pro: 5, fib: 2.8 };
  const HEAVY_SHARE = 0.2;
  const MEANINGFUL_REL = 0.1;
  // One serving's cutoffs, as shares of the daily limit: the first costs a point, the second two.
  // The optional carb limit (low carb, keto) has a third step: one serving that takes half the day's carbs costs three
  // points, so even a whole fruit or whole grain can't be a top pick on a tight limit.
  const CUT = { sat: [0.15, 0.3], na: [0.2, 0.35], add: [0.15, 0.3], carb: [0.15, 0.3, 0.5] };
  // Share of calories from protein for "decent" and "high" protein, and below which a heavy serving is penalized.
  const DENSITY = [0.2, 0.4];
  const HEAVY_DENSITY = 0.15;
  const floorFor = (k, share) => (FDA_DV[k] || 0) * share;
  // A difference worth pointing out: at least 10% relative and above a per-nutrient floor (share of the Daily Value).
  function meaningfulDiff(k, x, y, share = 0.05) {
    const d = Math.abs(x - y), hi = Math.max(Math.abs(x), Math.abs(y));
    return hi > 0 && d >= MEANINGFUL_REL * hi && d >= floorFor(k, share);
  }

  // A plate is a meal, so it's judged against a meal's share of the day (a third of each daily goal and limit),
  // not as if it were one food. It gets credit for protein, fiber and balance, and a flag when protein is low.
  const MEAL_SHARE = 1 / 3;
  // Meal cutoffs, as shares of a meal's third of each daily goal or limit.
  const MEAL_CUT = { pro: [0.5, 0.8], fib: 0.6, limit: [0.7, 1], cal: 1.5 };
  const PROTEIN_CATS = new Set(["meat", "seafood", "plant", "dairy", "protein"]);
  function assessMeal(f, p) {
    const m = {}; for (const k of ["cal", "pro", "sat", "na", "add", "fib"]) m[k] = (p[k] || 0) * MEAL_SHARE;
    const K = k => known(f, k), r = []; let s = 0;
    const pct = (v, t) => Math.round(v / t * 100);
    const items = f.items || [];
    if (K("pro")) {
      if (f.pro >= MEAL_CUT.pro[1] * m.pro) { s += 2; r.push({ k: "pos", n: "pro", d: 2, t: `Enough protein for a meal: ${fmt(f.pro)} g of the ${Math.round(m.pro)} g that's a third of your ${p.pro} g goal.` }); }
      else if (f.pro >= MEAL_CUT.pro[0] * m.pro) { s += 1; r.push({ k: "pos", n: "pro", d: 1, t: `Some protein: ${fmt(f.pro)} g of about ${Math.round(m.pro)} g for this meal.` }); }
      else { s -= 1; r.push({ k: "neg", n: "pro", d: -1, t: `Low protein for a meal: ${fmt(f.pro)} g. A third of your ${p.pro} g goal is about ${Math.round(m.pro)} g.` }); }
    }
    if (K("fib") && f.fib >= MEAL_CUT.fib * m.fib) { s += 1; r.push({ k: "pos", n: "fib", d: 1, t: `Good fiber for a meal: ${fmt(f.fib)} g of about ${Math.round(m.fib)} g.` }); }
    const hasProtein = items.some(({ food, mult }) => PROTEIN_CATS.has(food.c) && (food.pro || 0) * (mult || 1) >= 7);
    const hasProduce = items.some(({ food }) => food.c === "fruit" || food.c === "veg");
    if (hasProtein && hasProduce) { s += 1; r.push({ k: "pos", n: "balance", d: 1, t: "Balanced: a protein food plus fruit or vegetables." }); }
    else if (items.length && !hasProduce) r.push({ k: "note", t: "No fruit or vegetables on this plate yet. Adding some is the easiest upgrade." });
    const limit = (k, word, unit) => {
      if (!K(k) || !m[k]) return;
      const share = f[k] / m[k], amt = k === "na" ? Math.round(f[k]).toLocaleString("en-US") : fmt(f[k]);
      if (share >= MEAL_CUT.limit[1]) { s -= 2; r.push({ k: "neg", n: k, d: -2, t: `High ${word}: ${amt}${unit} is ${pct(f[k], m[k])}% of this meal's share (${pct(f[k], p[k])}% of your daily limit).` }); }
      else if (share >= MEAL_CUT.limit[0]) { s -= 1; r.push({ k: "neg", n: k, d: -1, t: `Getting high on ${word}: ${amt}${unit}, ${pct(f[k], m[k])}% of this meal's share.` }); }
    };
    limit("sat", "saturated fat", " g"); limit("na", "sodium", " mg"); limit("add", "added sugar", " g");
    const net = netCarb(f), mc = p.carb > 0 ? p.carb * MEAL_SHARE : 0;
    if (mc && net != null) {
      const share = net / mc;
      if (share >= MEAL_CUT.limit[1]) { s -= 2; r.push({ k: "neg", n: "carb", d: -2, t: `High in carbs for your limit: ${fmt(net)} g net carbs is ${pct(net, mc)}% of this meal's share (${pct(net, p.carb)}% of your ${p.carb} g a day).` }); }
      else if (share >= MEAL_CUT.limit[0]) { s -= 1; r.push({ k: "neg", n: "carb", d: -1, t: `Getting high on carbs: ${fmt(net)} g net, ${pct(net, mc)}% of this meal's share.` }); }
    }
    if ((f.tags || []).includes("processed")) { s -= 1; r.push({ k: "neg", n: "processed", d: -1, t: "Includes processed meat, which is linked to higher heart and cancer risk." }); }
    if (K("cal") && m.cal) {
      if (f.cal > MEAL_CUT.cal * m.cal) { s -= 1; r.push({ k: "neg", n: "cal", d: -1, t: `A big meal: ${Math.round(f.cal)} calories is ${pct(f.cal, p.cal)}% of your ${p.cal.toLocaleString("en-US")} for the day.` }); }
      else if (f.cal < 0.5 * m.cal) r.push({ k: "note", t: `A light meal: ${Math.round(f.cal)} calories, well under a third of your day.` });
    }
    let tier, word, why;
    const hasNeg = r.some(x => x.k === "neg");
    if (s >= 2) { tier = "good"; word = "Get it"; why = "A strong meal for your goals."; }
    else if (s <= -2) { tier = "bad"; word = "Limit it"; why = "This meal works against your goals as a regular thing."; }
    else { tier = "mid"; word = "In moderation"; why = "An OK meal. See what would improve it below.";
      if (!hasNeg) r.push({ k: "warn", t: "Not much going for it yet: more protein, fiber or vegetables would make this a strong meal." }); }
    // A meal over its share of a limit can't be a top pick, however much protein and fiber it has: the −2 for a
    // limit is the same at 100% or 260% of the share, so the pluses could otherwise outweigh it.
    const over = ["sat", "na", "add"].filter(k => K(k) && m[k] && f[k] / m[k] >= MEAL_CUT.limit[1]).map(k => NUTRIENT_WORD[k]);
    if (mc && net != null && net / mc >= MEAL_CUT.limit[1]) over.push("net carbs");
    if (over.length && tier === "good") {
      tier = "mid"; word = "In moderation";
      const ow = over.length <= 1 ? over.join("") : over.slice(0, -1).join(", ") + " or " + over.at(-1);
      why = `Strong on protein and balance, but over this meal's share of ${ow}.`;
      r.push({ k: "warn", t: `Can't be "Get it" while it goes over this meal's share of ${ow}. A smaller portion or a leaner swap would fix that.` });
    }
    const unknownLimits = limitsFor(p).filter(k => unknownLimit(f, k, p, true));
    const note = missingNote(f);
    if (note) r.push({ k: "warn", t: (f.missing || []).some(k => KEY_LIMITS.includes(k) || k === "sug") ? `${note} They aren't counted either way.` : note });
    if (unknownLimits.length && tier === "good") {
      tier = "mid"; word = "In moderation"; why = "Looks good on what's known, but key data is missing.";
      r.push({ k: "warn", t: `Can't rate this meal "Get it" without ${listWords(unknownLimits)} for every item.` });
    }
    return { tier, word, why, score: s, reasons: r, partial: !!note, spicy: !!p.mild && (f.tags || []).includes("spicy"), meal: true };
  }

  // Score one serving against the viewer's goals. Returns tier, headline and reasons, plus `allergy`: the viewer's
  // allergens in this food (js/allergens.js), or null when they haven't set any. An allergen never changes the score;
  // the app shows it as a flag beside the verdict.
  function assess(f, p) {
    const a = score(f, p);
    a.allergy = AL ? AL.check(f, p) : null;
    return a;
  }
  // An allergen the food contains, or may contain: left out of swaps and meal ideas.
  const allergyBlocks = a => !!(a && a.allergy && (a.allergy.status === "contains" || a.allergy.status === "may"));
  function score(f, p) {
    if (f.c === "plate") return assessMeal(f, p);
    const skip = skipReason(f, p);
    if (skip) return { tier: "skip", word: "Skip", why: skip.why, score: null, reasons: [{ k: "note", t: skip.note }] };

    let s = 0;
    const r = [];
    const K = k => known(f, k);
    const pd = K("cal") && K("pro") && f.cal > 0 ? (f.pro * 4) / f.cal : 0;
    if (!K("pro")) { /* unknown protein: no protein credit */ }
    else if (f.pro >= POS_FLOOR.pro && pd >= DENSITY[1]) { s += 2; r.push({ k: "pos", n: "pro", d: 2, t: `High protein for the calories: ${fmt(f.pro)} g, about ${Math.round(f.pro / p.pro * 100)}% of your ${p.pro} g goal.` }); }
    else if (f.pro >= POS_FLOOR.pro && pd >= DENSITY[0]) { s += 1; r.push({ k: "pos", n: "pro", d: 1, t: `Decent protein: ${fmt(f.pro)} g per serving.` }); }

    if (!K("fib")) { /* unknown fiber */ }
    // A positive needs at least 10% of the Daily Value (FDA's "good source" bar), so 1.5 g of fiber no longer counts.
    else if (f.fib >= POS_FLOOR.fib) { s += 2; r.push({ k: "pos", n: "fib", d: 2, t: `Good fiber source: ${fmt(f.fib)} g (${Math.round(f.fib / FDA_DV.fib * 100)}% of the daily value) keeps you full.` }); }
    if (wholeProduce(f)) { s += 2; r.push({ k: "pos", n: "whole", d: 2, t: f.c === "fruit" ? "Whole fruit: its natural sugar comes with water, fiber and nutrients, and most people should eat more." : "A whole vegetable: most people should eat more of these." }); }
    if (wholeGrain(f)) { s += 2; r.push({ k: "pos", n: "grain", d: 2, t: "Whole grain: keeps the bran and germ that refined grains lose." }); }

    const grams = servingGrams(f.s) ? servingGrams(f.s) * (f.mult || 1) : null;
    const lowDensity = grams ? f.cal / grams <= 1.0 : false; // "volume" means low energy density, not just a small serving
    if (["cal", "fat", "sat", "add", "na", "fib"].every(K) && lowDensity && f.cal >= 5 && f.cal <= 65 && f.fat < 3 && f.sat < 1 && f.add === 0 && f.na < 250 && f.fib >= 0.5) { s += 2; r.push({ k: "pos", n: "volume", d: 2, t: "Lots of food volume for very few calories." }); }
    const goodFat = healthyFatSource(f);
    if (goodFat && K("cal") && f.fat >= 5 && f.fat * 9 >= 0.5 * f.cal && !OIL_NAME.test(f.n) && (f.pro >= 3 || f.fib >= 2)) { s += 1; r.push({ k: "pos", n: "goodfat", d: 1, t: "Its fat is mostly the unsaturated kind, which is better for cholesterol." }); }

    const satShare = K("sat") ? f.sat / p.sat : 0;
    if (satShare >= CUT.sat[1]) { s -= 2; r.push({ k: "neg", n: "sat", d: -2, t: `High saturated fat: ${fmt(f.sat)} g is ${Math.round(satShare * 100)}% of your ${p.sat} g daily limit in one serving.` }); }
    else if (satShare >= CUT.sat[0]) { s -= 1; r.push({ k: "neg", n: "sat", d: -1, t: `Moderate saturated fat: ${fmt(f.sat)} g (${Math.round(satShare * 100)}% of your limit).` }); }
    if (K("trans") && f.trans > 0.5) {
      s -= 1;
      const natural = f.c === "meat" || f.c === "dairy";
      r.push({ k: "neg", n: "trans", d: -1, t: `Contains ${fmt(f.trans)} g trans fat${natural ? " (the kind that occurs naturally in red meat and dairy)" : ", the type of fat that raises LDL the most"}.` });
    }

    const naShare = K("na") ? f.na / p.na : 0;
    if (naShare >= CUT.na[1]) { s -= 2; r.push({ k: "neg", n: "na", d: -2, t: `Very salty: ${Math.round(f.na).toLocaleString("en-US")} mg sodium is ${Math.round(naShare * 100)}% of your daily limit.` }); }
    else if (naShare >= CUT.na[0]) { s -= 1; r.push({ k: "neg", n: "na", d: -1, t: `Salty: ${Math.round(f.na)} mg sodium (${Math.round(naShare * 100)}% of your limit).` }); }

    const addShare = K("add") && p.add > 0 ? f.add / p.add : 0;
    if (addShare >= CUT.add[1]) { s -= 2; r.push({ k: "neg", n: "add", d: -2, t: `High added sugar: ${fmt(f.add)} g is ${Math.round(addShare * 100)}% of your ${p.add} g daily limit.` }); }
    else if (addShare >= CUT.add[0]) { s -= 1; r.push({ k: "neg", n: "add", d: -1, t: `Some added sugar: ${fmt(f.add)} g (${Math.round(addShare * 100)}% of your limit).` }); }

    // The carb limit, when one is set (Goals → carb limit). Judged on net carbs.
    const net = p.carb > 0 ? netCarb(f) : null, carbShare = net != null ? net / p.carb : 0;
    if (net != null) {
      const fib = K("fib") && f.fib > 0 ? ` (${fmt(f.carb)} g carbs minus ${fmt(f.fib)} g fiber)` : "";
      if (carbShare >= CUT.carb[2]) { s -= 3; r.push({ k: "neg", n: "carb", d: -3, t: `Uses up most of your carbs: ${fmt(net)} g net carbs${fib} is ${Math.round(carbShare * 100)}% of your ${p.carb} g daily limit.` }); }
      else if (carbShare >= CUT.carb[1]) { s -= 2; r.push({ k: "neg", n: "carb", d: -2, t: `High in carbs for your limit: ${fmt(net)} g net carbs${fib} is ${Math.round(carbShare * 100)}% of your ${p.carb} g a day.` }); }
      else if (carbShare >= CUT.carb[0]) { s -= 1; r.push({ k: "neg", n: "carb", d: -1, t: `Some carbs: ${fmt(net)} g net (${Math.round(carbShare * 100)}% of your ${p.carb} g limit).` }); }
    }
    if (K("sug") && K("add") && K("pro") && CONCENTRATED_SUGAR.test(f.n) && f.sug >= 25 && f.add < 10 && f.pro < 5) { s -= 1; r.push({ k: "neg", n: "sug", d: -1, t: `${fmt(f.sug)} g of sugar in one serving. Even natural sugar adds up at this amount.` }); }
    if ((f.tags || []).includes("treat")) { s -= 1; r.push({ k: "neg", n: "treat", d: -1, t: "A treat (dessert, candy or fried snack): best kept occasional, not a regular buy." }); }
    if ((f.tags || []).includes("processed")) { s -= 2; r.push({ k: "neg", n: "processed", d: -2, t: "Processed meat, which is linked to higher heart and cancer risk." }); }
    const isPureFat = K("fat") && K("carb") && K("pro") && K("cal") && f.fat > 0 && f.carb < 0.5 && f.pro < 0.5 && f.fat * 9 >= 0.9 * f.cal;
    const unsaturatedOil = isPureFat && OIL_NAME.test(f.n) && K("sat") && f.sat / f.fat <= 0.25 && f.trans <= 0.2;
    if (unsaturatedOil) r.push({ k: "pos", t: "A cooking fat that's mostly unsaturated, which is better for cholesterol than butter, lard or coconut oil." });
    else if (K("cal") && K("pro") && K("fib") && f.cal >= 100 && f.pro < 2 && f.fib < 1) { s -= 1; r.push({ k: "neg", n: "empty", d: -1, t: "Calories with little protein or fiber, so it won't keep you full." }); }
    // A big share of the day's calories in one serving, with little protein to show for it.
    if (K("cal") && K("pro") && f.cal >= HEAVY_SHARE * p.cal && pd < HEAVY_DENSITY) { s -= 1; r.push({ k: "neg", n: "cal", d: -1, t: `A big share of your day: ${Math.round(f.cal)} calories (${Math.round(f.cal / p.cal * 100)}% of your ${p.cal.toLocaleString("en-US")}) in one serving, with only ${fmt(f.pro)} g protein.` }); }
    if (EVIDENCE[f.n]) { s += 1; r.push({ k: "pos", n: "evidence", d: 1, t: EVIDENCE[f.n] }); }
    if (NOTES[f.n]) r.push({ k: "note", t: NOTES[f.n] });

    if (K("chol") && K("sat") && f.chol >= 150 && satShare < 0.15) r.push({ k: "note", t: `High in dietary cholesterol (${Math.round(f.chol)} mg), but low in saturated fat. For most people saturated fat raises blood cholesterol more.` });
    if (goodFat && f.fat >= 10 && f.cal >= 100) r.push({ k: "note", t: `Healthy fats are still calorie-dense: ${Math.round(f.cal)} cal per serving, so portion size matters on ${p.cal.toLocaleString("en-US")} cal a day.` });

    // Every verdict must be backed by a reason shown in WHY:
    //   Get it: score >= 2 (from + reasons)
    //   Limit it: score <= -2 (from − reasons)
    //   In moderation: a − reason, or a ! reason saying why a small plus isn't enough
    //   Fine: negligible calories and nothing to flag either way
    const hasNeg = r.some(x => x.k === "neg"), hasPos = r.some(x => x.k === "pos");
    let tier, word, why;
    if (s >= 2) { tier = "good"; word = "Get it"; why = "A strong fit for your goals."; }
    else if (s <= -2) { tier = "bad"; word = "Limit it"; why = "Works against your goals if it's a regular buy."; }
    else if (hasNeg) { tier = "mid"; word = "In moderation"; why = "Fine sometimes. See the tradeoffs below."; }
    else if (K("cal") && f.cal < NEGLIGIBLE_KCAL) {
      // Small servings still need to be "low" in the FDA's terms to be Fine: under 2 g added sugar,
      // under 140 mg sodium and under 1 g saturated fat.
      const flags = [];
      if (K("add") && f.add >= 2) flags.push(`${fmt(f.add)} g of it is added sugar`);
      if (K("na") && f.na >= 140) flags.push(`${Math.round(f.na)} mg sodium`);
      if (K("sat") && f.sat >= 1) flags.push(`${fmt(f.sat)} g saturated fat`);
      if (flags.length) {
        tier = "mid"; word = "In moderation"; why = "A small serving, but not a free one.";
        r.push({ k: "warn", t: `Only ${Math.round(f.cal)} calories, but ${flags.join(" and ")}. Easy to use more than one serving.` });
      } else {
        tier = "fine"; word = "Fine"; why = "No real impact either way.";
        r.push({ k: "note", t: `${f.cal < 0.5 ? "No calories" : `Only ${Math.round(f.cal)} calories`} and nothing to flag, so it barely affects your day.` });
      }
    }
    else if (hasPos) {
      tier = "mid"; word = "In moderation"; why = "Nothing against it, but not a standout either.";
      r.push({ k: "warn", t: "Only a modest benefit: one plus and nothing against it isn't enough to make it a top pick." });
    } else {
      tier = "mid"; word = "In moderation"; why = "Fine sometimes. See the tradeoffs below.";
      r.push({ k: "warn", t: K("cal") ? `Not much fiber or protein for its ${Math.round(f.cal)} calories, so it won't do much to keep you full.` : "Calories weren't reported, so there's not enough to judge it well." });
    }

    // A serving that takes 30% or more of a carb limit can't be a top pick, whatever else it has going for it.
    if (net != null && carbShare >= CUT.carb[1] && tier === "good") {
      tier = "mid"; word = "In moderation"; why = "Good on nutrition, but heavy on carbs for your limit.";
      r.push({ k: "warn", t: `Can't be "Get it" on your ${p.carb} g carb limit: one serving takes ${Math.round(carbShare * 100)}% of it.` });
    }

    // Additives (scanned products only). Flagged ones get a "!" line; one a regulator has removed from food keeps
    // the product from being a top pick. Processing level is a note: nutrition still decides the verdict.
    const adds = ADD ? ADD.analyze(f) : null;
    if (adds) {
      for (const a of adds.flagged) r.push({ k: "warn", t: `${a.name}${a.code ? ` (${a.code})` : ""}: ${a.flag.t}` });
      if (adds.removed && (tier === "good" || tier === "fine")) {
        tier = "mid"; word = "In moderation"; why = "Fine on nutrition, but it contains an additive regulators have removed from food.";
      }
      if (adds.nova === 4) r.push({ k: "note", t: "Ultra-processed (NOVA 4): made mostly from industrial ingredients and additives. Shown for information; the verdict is on nutrition." });
    }

    // Unknown or lower-bound limiting nutrients: say so, and never call it a "Get it" on incomplete data.
    const unknownLimits = limitsFor(p).filter(k => unknownLimit(f, k, p));
    const note = missingNote(f);
    if (note) r.push({ k: "warn", t: `${note} ${unknownLimits.length ? "Those aren't counted either way." : "They aren't counted either way."}` });
    if (unknownLimits.length && (tier === "good" || tier === "fine")) {
      tier = "mid"; word = "In moderation"; why = "Looks good on what's known, but key data is missing.";
      r.push({ k: "warn", t: `Can't rate it "Get it" without ${listWords(unknownLimits)}: check the package label.` });
    }
    // The mild-food preference flags spicy foods; it never changes the nutrition verdict. Only the skip list does that.
    const spicy = !!p.mild && (f.tags || []).includes("spicy");
    if (spicy) r.unshift({ k: "warn", t: "Spicy: you said you prefer mild food. The verdict is on nutrition alone." });
    return { tier, word, why, score: s, reasons: r, partial: !!note, spicy };
  }

  // What each label line means; rules of thumb use the viewer's own goals.
  function explain(k, f, p) {
    const share = (v, t) => Math.round(v / t * 100);
    const it = f.c === "plate" ? "this meal" : "this serving";
    const E = {
      cal: ["Calories", "ctx", f.c === "plate" ? "The energy in this meal." : "The energy in one serving.", `Your budget is ${p.cal.toLocaleString("en-US")} a day; ${it} is ${share(f.cal, p.cal)}% of it.`],
      fat: ["Total fat", "ctx", "All the fat combined. Not good or bad by itself.", "Look at saturated fat below it: that's the part that matters most."],
      sat: ["Saturated fat", "low", "The fat in fatty meat, butter, cheese and cream. It's the biggest food driver of LDL (\"bad\") cholesterol.", `Your limit is ${p.sat} g a day; ${it} is ${share(f.sat, p.sat)}% of it.`],
      trans: ["Trans fat", "low", "Mostly from processed food; small amounts occur naturally in meat and dairy. It raises LDL more than any other fat.", "Keep it as close to zero as possible."],
      chol: ["Cholesterol", "ctx", "Cholesterol in the food itself, found only in animal foods.", "For most people it affects blood cholesterol much less than saturated fat does, so don't avoid eggs or shrimp for this alone."],
      na: ["Sodium", "low", "Salt. Too much raises blood pressure and makes you hold water.", `Your limit is ${p.na.toLocaleString("en-US")} mg a day; ${it} is ${share(f.na, p.na)}% of it. Over 20% DV per serving is salty.`],
      carb: p.carb > 0 && netCarb(f) != null
        ? ["Total carbohydrate", "low", "Starch, sugar and fiber combined. Net carbs are what's left after subtracting fiber, which you don't digest.", `Your net-carb limit is ${p.carb} g a day; ${it} has ${fmt(netCarb(f))} g net, ${share(netCarb(f), p.carb)}% of it.`]
        : ["Total carbohydrate", "ctx", "Starch, sugar and fiber combined: your main fuel.", "Judge the quality by the fiber and added-sugar lines beneath it."],
      fib: ["Dietary fiber", "more", "The part of plants you don't digest. It keeps you full, steadies blood sugar and lowers LDL a little.", `Your goal is ${p.fib} g a day; 3 g or more per serving is a good source.`],
      sug: ["Total sugars", "ctx", "Natural sugar (in fruit and milk) plus added sugar.", "Natural sugar is fine in whole foods. Check the added-sugar line instead."],
      add: ["Added sugars", "low", "Sugar put in during processing: calories that don't keep you full.", `Your limit is ${p.add} g a day; ${it} is ${share(f.add, p.add)}% of it.`],
      pro: ["Protein", "more", "Builds and keeps muscle, and keeps you full longer than carbs or fat.", `Your goal is ${p.pro} g a day (about ${Math.round(p.pro / 4)} g per meal over four meals); ${it} is ${share(f.pro, p.pro)}% of it.`],
    };
    return E[k] || null;
  }

  // A copy of the food with every amount multiplied, for the serving-size control.
  function scale(f, m) {
    const out = { ...f, mult: m };
    for (const k of NUM_KEYS) out[k] = (f[k] || 0) * m;
    return out;
  }

  // Hand-picked swaps for common foods; the generic search fills in the rest.
  const SWAP_HINTS = {
    "Ground beef 80/20": ["Ground beef 93/7", "Ground turkey 93/7", "Chicken breast, grilled"],
    "Ground beef 85/15": ["Ground beef 93/7", "Ground turkey 93/7", "Chicken breast, grilled"],
    "Ground beef 90/10": ["Ground beef 93/7", "Ground turkey 93/7"],
    "Ground pork": ["Pork tenderloin", "Ground turkey 93/7"],
    "Ribeye steak": ["Sirloin steak, lean", "Filet mignon", "Flank steak"],
    "Beef brisket": ["Sirloin steak, lean", "Turkey breast, roasted"],
    "Bacon": ["Egg whites", "Turkey breast, roasted"],
    "Pork breakfast sausage": ["Egg whites", "Turkey breast, roasted"],
    "Deli turkey": ["Turkey breast, roasted", "Rotisserie chicken, breast meat"],
    "Deli ham": ["Turkey breast, roasted", "Rotisserie chicken, breast meat"],
    "Hot dog, beef": ["Chicken breast, grilled", "Veggie burger"],
    "Chicken nuggets, frozen": ["Chicken breast, grilled", "Rotisserie chicken, breast meat"],
    "Chicken sandwich, fried": ["Grilled chicken sandwich"],
    "Cheeseburger, fast food": ["Turkey burger patty", "Veggie burger"],
    "Yogurt, flavored low-fat": ["Greek yogurt, plain nonfat", "Skyr, plain nonfat"],
    "Greek yogurt, vanilla": ["Greek yogurt, plain nonfat", "Skyr, plain nonfat"],
    "Vanilla ice cream": ["Greek yogurt, plain nonfat", "Frozen mixed berries"],
    "Whole milk": ["Skim milk", "Soy milk, unsweetened"],
    "2% milk": ["Skim milk", "Soy milk, unsweetened"],
    "Chocolate milk, low-fat": ["Skim milk", "Protein shake, ready-to-drink"],
    "Oat milk": ["Soy milk, unsweetened", "Almond milk, unsweetened"],
    "Sour cream": ["Greek yogurt, plain nonfat"],
    "Mayonnaise": ["Greek yogurt, plain nonfat"],
    "Butter": ["Extra virgin olive oil", "Avocado oil"],
    "Coconut oil": ["Extra virgin olive oil", "Avocado oil"],
    "Ghee": ["Extra virgin olive oil", "Avocado oil"],
    "Lard": ["Extra virgin olive oil", "Avocado oil"],
    "Beef tallow": ["Extra virgin olive oil", "Avocado oil"],
    "Bacon grease": ["Extra virgin olive oil", "Avocado oil"],
    "Vegetable shortening": ["Canola oil", "Avocado oil"],
    "Palm oil": ["Canola oil", "Extra virgin olive oil"],
    "MCT oil": ["Extra virgin olive oil", "Avocado oil"],
    "Ranch dressing": ["Balsamic vinaigrette", "Salsa, mild"],
    "Caesar dressing": ["Balsamic vinaigrette", "Salsa, mild"],
    "BBQ sauce": ["Salsa, mild", "Yellow mustard"],
    "Ketchup": ["Salsa, mild"],
    "Soda": ["Sparkling water", "Diet soda"],
    "Sweet tea": ["Sparkling water", "Diet soda"],
    "Lemonade": ["Sparkling water", "Diet soda"],
    "Sports drink": ["Electrolyte drink, zero sugar"],
    "Bubble milk tea, regular sugar": ["Latte, whole milk", "Kombucha", "Sparkling water"],
    "Bubble milk tea, half sugar": ["Latte, whole milk", "Kombucha", "Sparkling water"],
    "Thai iced tea": ["Latte, whole milk", "Kombucha", "Sparkling water"],
    "Energy drink": ["Coffee, black"],
    "Orange juice": ["Orange", "Clementine"],
    "Apple juice": ["Apple", "Applesauce, unsweetened"],
    "Fruit smoothie, bottled": ["Frozen mixed berries", "Banana"],
    "Frosted cereal": ["Oatmeal, rolled oats", "Toasted oat cereal, plain", "Shredded wheat"],
    "Instant oatmeal, flavored": ["Oatmeal, rolled oats"],
    "Granola": ["Oatmeal, rolled oats", "Shredded wheat"],
    "Granola bar, chewy": ["Protein bar", "Almonds"],
    "White rice": ["Brown rice", "Quinoa"],
    "Jasmine rice": ["Brown rice", "Quinoa"],
    "Pasta": ["Whole wheat pasta"],
    "White bread": ["Whole wheat bread", "Pita, whole wheat", "English muffin, whole wheat"],
    "Flour tortilla": ["Corn tortillas", "Low-carb tortilla"],
    "Instant ramen": ["Soba noodles", "Beef pho"],
    "Mac and cheese, boxed": ["Whole wheat pasta"],
    "French fries": ["Potato, baked", "Sweet potato, baked"],
    "Potato chips": ["Popcorn, air-popped", "Whole grain crackers"],
    "Tortilla chips": ["Popcorn, air-popped", "Whole grain crackers"],
    "Microwave popcorn, butter": ["Popcorn, air-popped"],
    "Milk chocolate bar": ["Dark chocolate, 70%"],
    "Eggs": ["Egg whites"],
    "Pancakes": ["Oatmeal, rolled oats", "English muffin, whole wheat"],
    "French toast": ["Oatmeal, rolled oats", "English muffin, whole wheat"],
    "Frozen waffles": ["Oatmeal, rolled oats", "English muffin, whole wheat"],
    "Croissant": ["English muffin, whole wheat", "Pita, whole wheat"],
    "Bagel, plain": ["English muffin, whole wheat", "Pita, whole wheat"],
    "Blueberry muffin": ["English muffin, whole wheat", "Oatmeal, rolled oats"],
    "Glazed donut": ["English muffin, whole wheat", "Oatmeal, rolled oats"],
    "Toaster pastry": ["English muffin, whole wheat", "Oatmeal, rolled oats"],
    "Cheddar cheese": ["Cottage cheese 2%", "Mozzarella, part-skim"],
    "Honey": ["Monk fruit sweetener", "Zero-calorie sweetener"],
    "Maple syrup": ["Monk fruit sweetener", "Zero-calorie sweetener"],
    "Agave syrup": ["Monk fruit sweetener", "Zero-calorie sweetener"],
    "Soy sauce": ["Low-sodium soy sauce"],
    "Molasses": ["Monk fruit sweetener", "Coconut sugar"],
    "Spam": ["Canned chicken breast", "Tuna, canned in water"],
    "Egg bites, bacon and cheese": ["Egg whites", "Greek yogurt, plain nonfat"],
    "Pumpkin spice latte": ["Latte, whole milk", "Cold brew coffee"],
    "Iced caramel macchiato": ["Latte, whole milk", "Cold brew coffee"],
    "Cheese puffs": ["Popcorn, air-popped", "Whole grain crackers"],
    "Nacho cheese tortilla chips": ["Popcorn, air-popped", "Whole grain crackers"],
    "Pepperoni pizza, restaurant": ["Chicken taco", "Grilled chicken sandwich", "Chicken burrito bowl"],
    "Cheese pizza, restaurant": ["Chicken taco", "Grilled chicken sandwich", "Chicken burrito bowl"],
    "Chocolate hazelnut spread": ["Almond butter", "Powdered peanut butter", "Peanut butter"],
    "Frozen pepperoni pizza": ["Frozen chicken and rice bowl", "Chicken taco"],
  };

  const STOP = new Set(["canned", "frozen", "plain", "fresh", "cooked", "whole", "low", "fat", "sweetened", "unsweetened", "flavored", "with", "and", "the", "store", "fast", "food", "restaurant", "deli", "raw"]);
  const tokens = s => s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !STOP.has(w));
  const ALCOHOL = /beer|wine|liquor|hard seltzer|margarita/i;
  const LIQUID = /milk|kefir|juice|shake|smoothie|latte|coffee|tea\b|soda|water|drink|beer|wine|lemonade|kombucha|liquor|seltzer|margarita|chocolate, from mix/i;
  // Cooking fats only swap with other cooking fats.
  const pureFat = g => g.fat > 0 && g.carb < 0.5 && g.pro < 0.5 && g.fat * 9 >= 0.9 * g.cal;
  // Pantry staples that score well but aren't a real substitute for most things; only suggested when hand-picked.
  const HINT_ONLY = new Set(["Cocoa powder, unsweetened", "Table salt", "Zero-calorie sweetener", "Monk fruit sweetener", "Stevia sweetener", "Erythritol", "Allulose", "Cooking spray", "Balsamic vinegar"]);

  // Open Food Facts category tags → our categories. First match wins, so specific tags come before broad ones.
  // Swap groups narrower than a category, for packaged foods whose category alone suggests the wrong things
  // (a hazelnut spread should swap with nut butters, not with almonds or popcorn).
  const SWAP_GROUPS = {
    spreads: { cat: "nuts", foods: ["Almond butter", "Peanut butter", "Powdered peanut butter", "Tahini"] },
    cereal: { cat: "grains", foods: ["Oatmeal, rolled oats", "Toasted oat cereal, plain", "Shredded wheat", "Bran flakes", "Raisin bran"] },
    soda: { cat: "drinks", foods: ["Sparkling water", "Diet soda", "Electrolyte drink, zero sugar", "Kombucha"] },
  };
  // Open Food Facts categories_tags → a swap group or one of our categories. Checked in order, so specific
  // tags come before broad ones; a product matches the first rule any of its tags fits.
  /** @type {Array<[RegExp, string]>} */
  const OFF_CATEGORY = [
    [/protein-bars|protein-powders|protein-shakes/, "protein"],
    [/hummus|salted-spreads/, "plant"],
    [/jams|marmalades|fruit-spreads|honeys|syrups/, "condiments"],
    // Nutella's tags are en:spreads, en:sweet-spreads, en:confectionary-based-spreads (no "hazelnut" tag).
    [/nut-butters|peanut-butters|hazelnut|chocolate-spreads|cocoa-and-hazelnuts|sweet-spreads|confection[ae]ry-based-spreads|^en:spreads$/, "group:spreads"],
    [/breakfast-cereals|cereal-flakes|mueslis|granolas/, "group:cereal"],
    [/sodas|soft-drinks|carbonated-drinks|colas|energy-drinks/, "group:soda"],
    [/nuts|seeds/, "nuts"],
    [/confectioneries|candies|chocolates|biscuits|cookies|cakes|ice-creams|desserts|sweet-snacks|chips-and-fries|crisps|popcorn|salty-snacks|snacks/, "snacks"],
    [/plant-based-milks|dairies|milks|yogurts|cheeses|eggs/, "dairy"],
    [/beverages|drinks|waters|juices|teas|coffees/, "drinks"],
    [/fishes|seafood|fish-and-seafood/, "seafood"],
    [/meats|poultries|sausages|hams/, "meat"],
    [/legumes|beans|tofu|meat-analogues/, "plant"],
    [/breads|cereals|pastas|rices|flours|noodles/, "grains"],
    [/fruits/, "fruit"],
    [/vegetables/, "veg"],
    [/sauces|condiments|dressings|oils|fats|spices|sweeteners/, "condiments"],
    [/meals|pizzas|soups|sandwiches|prepared/, "prepared"],
  ];
  // USDA foodCategory (SR Legacy food groups like "Nut and Seed Products", or survey categories like "Soft drinks").
  /** @type {Array<[RegExp, string]>} */
  const USDA_CATEGORY = [
    [/baby/i, null],
    [/breakfast cereal|ready-to-eat cereal|oatmeal/i, "group:cereal"],
    [/soft drink|soda/i, "group:soda"],
    [/nut butter|peanut butter/i, "group:spreads"],
    [/sausage|luncheon|poultry|chicken|turkey|beef|pork|lamb|veal|game|meat/i, "meat"],
    [/finfish|shellfish|fish|seafood/i, "seafood"],
    [/dairy|egg|milk|cheese|yogurt/i, "dairy"],
    [/legume|bean/i, "plant"],
    [/nut|seed/i, "nuts"],
    [/fruit/i, "fruit"], // "Fruits and Fruit Juices": whole fruit unless the name says juice (checked above)
    [/beverage|coffee|tea\b|juice|water/i, "drinks"],
    [/vegetable|potato/i, "veg"],
    [/sweets|snack|cookie|cake|candy|chips|crackers/i, "snacks"],
    [/cereal grain|pasta|baked product|bread|rice|tortilla|grain/i, "grains"],
    [/soup|meal|entree|fast food|restaurant|pizza|sandwich|mixed dish/i, "prepared"],
    [/fats and oils|oil|spice|herb|sauce|gravy|condiment|dressing|sugar/i, "condiments"],
  ];
  // USDA Branded Foods categories (the brand's own, e.g. "Chips, Pretzels & Snacks", "Nut & Seed Butters").
  /** @type {Array<[RegExp, string]>} */
  const BRANDED_CATEGORY = [
    [/protein|nutrition(al)? (drinks?|shakes?|powders?)|meal replacement/i, "protein"],
    [/soda|soft drink/i, "group:soda"],
    [/ice cream|frozen yogurt|frozen dessert|frozen novelt/i, "snacks"],
    [/\bbars?\b/i, "snacks"],
    [/cereal|granola|oatmeal|muesli/i, "group:cereal"],
    [/nut (&|and) seed butter|peanut butter/i, "group:spreads"],
    [/juice|nectar|drink|beverage|water|\btea\b|tea bags|coffee|concentrate|lemonade/i, "drinks"],
    [/chips|pretzel|popcorn|crackers|snack|cookie|biscuit|candy|chocolate|cake|pastr|\bpies?\b|dessert|donut|doughnut/i, "snacks"],
    [/butter|margarine|\boils?\b|dressing|mayonnaise|sauce|condiment|ketchup|mustard|spice|seasoning|syrup|honey|jam|jelly|spread|dip/i, "condiments"],
    [/cheese|milk|yogurt|cream|\beggs?\b|dairy/i, "dairy"],
    [/bread|\bbuns?\b|bagel|tortilla|pasta|\brice\b|grain|flour|rolls|noodle/i, "grains"],
    [/meat|poultry|chicken|turkey|beef|pork|sausage|bacon|hot dog|deli|jerky/i, "meat"],
    [/fish|seafood|tuna|salmon|shrimp|shellfish/i, "seafood"],
    [/beans|legume|tofu|hummus|plant based/i, "plant"],
    [/vegetable|potato/i, "veg"],
    [/fruit/i, "fruit"],
    [/dinner|entree|entrée|meal|pizza|soup|sandwich|prepared|side dish/i, "prepared"],
  ];
  const NUT_NAME = /almond|peanut|cashew|pistachio|walnut|pecan|macadamia|hazelnut|\bnuts?\b|\bseeds?\b|trail mix/i;
  // Kinds inside a category: a swap has to be the same kind of food (tartar sauce for a creamy sauce, not Sriracha;
  // bacon for another processed meat, not chicken nuggets). First match wins, so specific kinds come first.
  const KINDS = {
    condiments: [
      ["pasta sauce", /marinara|alfredo|pasta sauce|pizza sauce|vodka sauce|pesto/],
      ["cheese dip", /queso|cheese dip|cheese sauce/],
      ["creamy", /mayo|mayonnaise|aioli|tartar|ranch|caesar|thousand island|blue cheese|tzatziki|queso|remoulade|creamy|honey mustard|sandwich spread/],
      ["burger", /ketchup|catsup|mustard|bbq|barbecue|relish|pickle|steak sauce|worcestershire/],
      ["hot", /sriracha|hot sauce|buffalo|chili sauce|chili garlic|tabasco|harissa|salsa|gochujang|chipotle/],
      ["asian", /soy sauce|teriyaki|hoisin|fish sauce|oyster sauce|miso|peanut sauce|ponzu|tamari|coconut aminos|stir[- ]fry sauce/],
      ["dressing", /vinaigrette|dressing|vinegar/],
      ["fruit spread", /\bjam\b|jelly|preserves|marmalade|fruit spread/],
      ["sweetener", /sugar|syrup|honey|molasses|agave|sweetener|monk fruit|stevia|erythritol|allulose/],
      ["fat", /butter|margarine|ghee|lard|tallow|shortening|\boils?\b|grease|cooking spray/],
      ["gravy", /gravy/],
    ],
    drinks: [
      ["broth", /broth|stock/],
      ["energy", /energy/],
      ["sports", /sports drink|electrolyte|gatorade|powerade|bodyarmor|coconut water|hydration/],
      ["coffee and tea", /coffee|latte|macchiato|cold brew|espresso|mocha|\btea\b|matcha|chai|horchata/],
      ["juice", /juice|smoothie|nectar/],
      ["fizzy and sweet", /soda|cola|lemonade|punch|kombucha|sparkling|seltzer|tonic|root beer|ginger ale|sweet tea|soft drink/],
    ],
    snacks: [
      ["sweet", /ice cream|cookie|oreo|chocolate|donut|doughnut|muffin|brownie|cheesecake|\bpie\b|popsicle|sorbet|gumm|fruit snacks|candy|candies|\bbars?\b|treat|cake|mochi|cinnamon roll|milkshake|cocoa|hazelnut spread|fig|graham|pastr|frozen yogurt|pudding|wafer|s'mores/],
      ["salty", /chips|crisps|crackers|pretzel|popcorn|pork rinds|veggie straws|seaweed|puffs|beef stick|kettle corn|snack mix|cheese curls|doritos|cheetos/],
    ],
    meat: [
      ["meat snack", /jerky|beef stick|meat stick|meat snack/],
      ["breakfast meat", /bacon|breakfast sausage|sausage links|sausage patt/],
      ["deli meat", /deli|salami|pepperoni|bologna|\bham\b|lunch ?meat|prosciutto|spam|corned beef|roast beef|luncheon/],
      ["sausage", /sausage|hot dog|frank|kielbasa|chorizo|bratwurst/],
      ["ground", /ground|burger|patty|patties|meatball/],
      ["breaded", /nugget|tender|breaded|popcorn chicken|fried chicken|wings/],
    ],
    dairy: [
      ["eggs", /\beggs?\b|egg whites/],
      ["yogurt", /yogurt|skyr|kefir/],
      ["cream", /cream cheese|sour cream|whipped|heavy cream|half and half|creamer/],
      ["cheese", /cheese|mozzarella|cheddar|parmesan|feta|brie|ricotta|swiss|provolone|colby|monterey/],
      ["milk", /milk/],
    ],
    grains: [
      ["breakfast", /cereal|flakes|granola|muesli|bran|oatmeal|\boats\b|cream of wheat|grits|cheerios/],
      ["bread", /bread|\bbuns?\b|\brolls?\b|bagel|muffin|pita|naan|croissant|biscuit|toast|waffle|pancake|tortilla|wrap|cornbread/],
      ["pasta and rice", /pasta|spaghetti|penne|noodle|macaroni|\brice\b|quinoa|couscous|farro|barley|bulgur|udon|soba/],
    ],
    prepared: [
      ["soup", /soup|chili|\bpho\b|ramen|congee|stew/],
      ["salad", /salad/],
    ],
  };
  // Categories so broad that an unknown kind means no generic swap at all.
  const STRICT_KIND = new Set(["condiments", "drinks", "snacks"]);
  function kindOf(f, cat) {
    const list = KINDS[cat];
    if (!list) return null;
    const name = [f.n, ...(f.a || [])].join(" | ").toLowerCase();
    if (cat === "condiments" && pureFat(f) && !/mayo|aioli|dressing/.test(name)) return "fat";
    for (const [k, re] of list) if (re.test(name)) return k;
    return null;
  }
  // A packaged product's own name can say more than its store category ("Frosted Flakes" filed under "Pantry meal essentials").
  /** @type {Array<[RegExp, string]>} */
  const NAME_TARGET = [[/\b(?:cereal|frosted flakes|corn flakes|cheerios|bran flakes|muesli)\b(?!.*\bbars?\b)/i, "group:cereal"],
    // Baked sweets: "Honey Buns" are a pastry, not honey.
    [/\b(?:honey buns?|donuts?|doughnuts?|pastr(?:y|ies)|cinnamon rolls?|muffins?|danish|cupcakes?|snack cakes?|brownies?|cookies?|zebra cakes|swiss rolls?|oatmeal creme pies?)\b/i, "snacks"]];
  const toTarget = (v, via) => !v ? null : v.startsWith("group:") ? { ...SWAP_GROUPS[v.slice(6)], group: v.slice(6), via } : { cat: v, via };

  // Where to look for swaps. Built-ins use their category. A lookup uses its Open Food Facts tags or USDA food
  // category, then the built-in foods whose names share the most words with it. null means no confident match,
  // and then "Try instead" is hidden rather than filled with unrelated foods.
  function swapTarget(f, foods) {
    if (f.c === "plate") return null;
    if (f.c && f.c !== "lookup") return { cat: f.c, via: "category" };
    for (const [re, c] of NAME_TARGET) if (re.test(f.n)) return toTarget(c, "name");
    for (const [re, c] of OFF_CATEGORY) if ((f.categories || []).some(tag => re.test(tag))) return toTarget(c, "off");
    if (f.foodCategory && f.dataType === "Branded") {
      // "Popcorn, Peanuts, Seeds & Related Snacks" holds both: nuts swap with nuts, popcorn with snacks.
      if (/peanuts|seeds|nuts/i.test(f.foodCategory) && NUT_NAME.test(f.n)) return toTarget("nuts", "usda");
      // Sweet drinks (lemonade, fruit punch, cola) swap like soda: sparkling water, diet soda.
      if (/lemonade|punch|\bcola\b|soda|fruit drink|sweet tea/i.test(f.n)) return toTarget("group:soda", "usda");
      for (const [re, c] of BRANDED_CATEGORY) if (re.test(f.foodCategory)) return toTarget(c, "usda");
    }
    if (f.foodCategory && f.dataType !== "Branded") {
      if (/juice/i.test(f.n) && /fruit|vegetable|beverage/i.test(f.foodCategory)) return toTarget("drinks", "usda");
      // "Baked Products" holds both bread and cookies; sweets swap with snacks, bread with grains.
      if (/baked/i.test(f.foodCategory) && /cookie|cake|brownie|\bpie\b|pastr|doughnut|donut|muffin|danish|croissant|sweet roll/i.test(f.n)) return toTarget("snacks", "usda");
      for (const [re, c] of USDA_CATEGORY) if (re.test(f.foodCategory)) return toTarget(c, "usda");
    }
    const ft = new Set(tokens(f.n));
    if (!ft.size) return null;
    const best = {}; // category → most words any of its foods shares with the lookup's name
    for (const g of foods) {
      if (!g.c || g.c === "lookup") continue;
      const n = new Set([...tokens(g.n), ...(g.a || []).flatMap(tokens)]);
      const hit = [...ft].filter(t => n.has(t)).length;
      if (hit) best[g.c] = Math.max(best[g.c] || 0, hit);
    }
    const ranked = Object.entries(best).sort((a, b) => b[1] - a[1]);
    // Ambiguous (a tie between categories) means we don't know, so show nothing rather than guess.
    return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? { cat: ranked[0][0], via: "name" } : null;
  }
  const swapCategory = (f, foods) => (swapTarget(f, foods) || {}).cat || null;

  // A store product borrows the hand-picked swaps of the built-in food its name contains in full
  // ("Oscar Mayer Naturally Hardwood Smoked Bacon" → Bacon's), when that food is in the same category.
  function borrowedHints(f, foods, target) {
    if ((f.c && f.c !== "lookup") || !target) return null;
    const ft = new Set(tokens(f.n));
    let best = null, bestLen = 0;
    for (const g of foods) {
      if (!SWAP_HINTS[g.n] || g.c !== target.cat) continue;
      const gt = tokens(g.n.split(",")[0]);
      if (gt.length && gt.every(t => ft.has(t)) && gt.length > bestLen) { best = g; bestLen = gt.length; }
    }
    return best ? SWAP_HINTS[best.n] : null;
  }

  // A lighter version of the same kind of food: at least 40% less of calories, sodium, added sugar or saturated
  // fat per serving (each counted only where the original has a real amount), and not meaningfully more of any.
  // Used only when nothing of that kind earns a better verdict; most condiments sit at "In moderation" either way.
  /** @type {Array<[string, string, number, number]>} */
  const LIGHTER = [["cal", "fewer calories", 40, 10], ["na", "less sodium", 140, 40], ["add", "less added sugar", 2, 1], ["sat", "less saturated fat", 1, 0.5]];
  // Compared at the same weight when both servings give grams (a teaspoon of sugar isn't "lighter" than a tablespoon
  // of jam). Cooking fats are judged on the kind of fat, not on being lighter, so they're left out.
  const NONE_WORD = { cal: "almost no calories", na: "almost no sodium", add: "no added sugar", sat: "almost no saturated fat" };
  function lighterBy(f, g) {
    if (pureFat(f) || pureFat(g)) return null;
    const fg = servingGrams(f.s), gg = servingGrams(g.s);
    const k2 = fg && gg ? fg / gg : 1;
    let best = null;
    for (const [k, word, floor, slack] of LIGHTER) {
      if (isMissing(f, k) || isMissing(g, k)) continue;
      const gv = g[k] * k2;
      if (gv > f[k] * 1.25 + slack) return null;
      const drop = f[k] >= floor ? 1 - gv / f[k] : 0;
      if (drop >= 0.4 && (!best || drop > best.drop)) best = { drop, text: drop >= 0.95 ? NONE_WORD[k] : `${Math.round(drop * 100)}% ${word}` };
    }
    if (best && k2 !== 1) best.text += " by weight";
    return best;
  }

  // Up to `max` better options from the same category, best verdict first ("Get it" before "In moderation"),
  // then hand-picked hints, name overlap and similar calories. Hand-picked hints are the only cross-category picks.
  function findSwaps(f, foods, p, max = 3) {
    const base = assess(f, p);
    const want = base.tier === "skip" ? 0 : RANK[base.tier];
    if (base.tier === "good" || base.tier === "fine") return [];
    const target = swapTarget(f, foods);
    const hints = SWAP_HINTS[f.n] || borrowedHints(f, foods, target) || [];
    const cat = target && target.cat, only = target && target.foods ? new Set(target.foods) : null;
    // Drink or not: from the name for built-ins, from the source's category for lookups ("Coca-Cola" has no drink word).
    const fLiquid = target && (target.via === "off" || target.via === "usda") ? cat === "drinks" || LIQUID.test(f.n) : LIQUID.test(f.n);
    if (!cat && !hints.length) return [];
    const ft = new Set(tokens(f.n));
    const fKind = cat && !only ? kindOf(f, cat) : null;
    // A food of unknown kind in a broad category gets only its hand-picked swaps.
    if (cat && !only && !fKind && STRICT_KIND.has(cat) && !hints.length) return [];
    const out = [];
    for (const g of foods) {
      if (g.n === f.n) continue;
      const hinted = hints.includes(g.n);
      if (!hinted && (only ? !only.has(g.n) : g.c !== cat)) continue;
      if (!hinted && ALCOHOL.test(g.n) && !ALCOHOL.test(f.n)) continue;
      if (!hinted && !only && LIQUID.test(g.n) !== fLiquid) continue;
      if (!hinted && pureFat(g) !== pureFat(f)) continue;
      if (!hinted && HINT_ONLY.has(g.n)) continue;
      if (!hinted && !only && cat && (fKind || STRICT_KIND.has(cat)) && kindOf(g, cat) !== fKind) continue;
      const a = assess(g, p);
      if (a.tier === "skip" || allergyBlocks(a)) continue;
      const lighter = RANK[a.tier] === want && !hinted ? lighterBy(f, g) : null;
      if (RANK[a.tier] < want || (RANK[a.tier] === want && !lighter)) continue;
      let score = 0;
      const hi = hints.indexOf(g.n);
      if (hi >= 0) score += 100 - hi;
      if (g.c === cat) score += 20;
      score += 8 * tokens(g.n).filter(t => ft.has(t)).length;
      if (score < 20) continue;
      score -= 4 * Math.abs(Math.log((g.cal + 20) / (f.cal + 20)));
      out.push({ food: g, verdict: a, score: score + (lighter ? 30 * lighter.drop : 0), hinted, shared: tokens(g.n).filter(t => ft.has(t)).length, lighter: lighter ? lighter.text : null });
    }
    // Hand-picked swaps stand alone when any of them apply; the generic search only fills in when there are none.
    const picked = out.filter(o => o.hinted);
    // A better verdict beats a lighter version; lighter versions show only when nothing scores better.
    const better = out.filter(o => !o.lighter);
    if (!picked.length && better.length) out.splice(0, out.length, ...better);
    // Best verdict first; among equal verdicts, a closer substitute (shares a word: "Ground beef 90/10" for ground beef 80/20).
    return (picked.length ? picked : out).sort((x, y) => RANK[y.verdict.tier] - RANK[x.verdict.tier] || (!picked.length && (y.shared - x.shared)) || y.score - x.score).slice(0, max);
  }

  // Why a swap is better, in a fair unit: per serving when the two servings have similar calories, otherwise
  // per 100 calories. Only differences of at least 10% of the Daily Value are mentioned.
  function swapDiffs(f, g) {
    const similar = f.cal > 0 && g.cal > 0 && Math.max(f.cal, g.cal) / Math.min(f.cal, g.cal) <= 1.25;
    const perKcal = !similar && f.cal >= KCAL_MIN && g.cal >= KCAL_MIN;
    const a = perKcal ? per100kcal(f) : f, b = perKcal ? per100kcal(g) : g;
    const bits = [];
    const d = (k, more, unit, word) => {
      if (isMissing(f, k) || isMissing(g, k)) return;
      const diff = b[k] - a[k];
      if ((more ? diff > 0 : diff < 0) && meaningfulDiff(k, a[k], b[k], 0.1)) bits.push(`${k === "na" ? Math.round(Math.abs(diff)) : fmt(Math.abs(diff))}${unit} ${more ? "more" : "less"} ${word}`);
    };
    d("sat", false, " g", "saturated fat"); d("add", false, " g", "added sugar"); d("na", false, " mg", "sodium");
    d("pro", true, " g", "protein"); d("fib", true, " g", "fiber");
    if (!bits.length && !perKcal && g.cal < f.cal - 40) bits.push(`${Math.round(f.cal - g.cal)} fewer calories`);
    const kinds = [];
    if (wholeGrain(g) && !wholeGrain(f)) kinds.push("Whole grain");
    if (wholeProduce(g) && !wholeProduce(f)) kinds.push(g.c === "fruit" ? "Whole fruit" : "A whole vegetable");
    return { bits: bits.slice(0, 2), kinds, basis: perKcal ? "kcal" : "serving" };
  }

  // For sorting by healthiness: the verdict score (ignoring skip list and spice preference, which aren't about
  // nutrition), then a tiebreaker for how much of the daily saturated fat, sodium and added-sugar limits one serving uses.
  // basis "kcal" scores 100 calories' worth of the food (nutrient density) instead of one serving.
  // Foods under 25 calories per serving (condiments, spices, diet drinks) keep their per-serving score:
  // scaling a teaspoon of hot sauce up to 100 calories says nothing useful.
  function health(f, p, basis = "serving") {
    const g = basis === "kcal" ? (per100kcal(f) || f) : f;
    const score = assess(g, { ...p, skip: "", mild: false }).score;
    const harm = g.sat / p.sat + g.na / p.na + (p.add > 0 ? g.add / p.add : 0) + (p.carb > 0 && netCarb(g) != null ? netCarb(g) / p.carb : 0) + ((g.tags || []).includes("processed") ? 0.3 : 0);
    return { score, harm, scaled: g !== f };
  }

  const KCAL_MIN = 25;
  // 100 calories' worth of a food, or null when a serving has too few calories to scale meaningfully.
  function per100kcal(f) {
    if (!(f.cal >= KCAL_MIN)) return null;
    const g = scale(f, 100 / f.cal);
    g.s = "100 calories";
    return g;
  }

  // Several foods at chosen servings, added up into one meal ("plate").
  // A nutrient no item reports is missing; one only some items report is a lower bound ("at least").
  function combine(items, name = "Your plate") {
    const out = { n: name, a: [], s: `${items.length} item${items.length === 1 ? "" : "s"}`, c: "plate", tags: [], items, missing: [], atLeast: [] };
    for (const k of NUM_KEYS) out[k] = 0;
    for (const { food, mult } of items) {
      for (const k of NUM_KEYS) if (!isMissing(food, k)) out[k] += (food[k] || 0) * (mult || 1);
      for (const t of food.tags || []) if (!out.tags.includes(t)) out.tags.push(t);
    }
    for (const k of NUM_KEYS) {
      out[k] = Math.round(out[k] * 10) / 10;
      const lacking = items.filter(({ food }) => isMissing(food, k)).length;
      if (lacking === items.length && items.length) out.missing.push(k); else if (lacking) out.atLeast.push(k);
    }
    out.addLikelyZero = items.every(({ food }) => !isMissing(food, "add") || food.addLikelyZero);
    return out;
  }

  // URL-safe ids. Accents are folded first (Jalapeño → jalapeno), so links stay ASCII and easy to type.
  const foldAccents = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const slug = s => foldAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // The old slug dropped accented letters (Jalapeño → jalape-o); kept so links shared before still resolve.
  const legacySlug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // What decided the verdict, as chart rows. Every point comes from a scored reason in assess() (r.n, r.d), so the
  // chart can't disagree with the verdict; cutoffs are the same constants assess() uses. Judged on one serving.
  const OTHER_LABEL = { whole: f => f.c === "fruit" ? "Whole fruit" : "Whole vegetable", grain: "Whole grain", volume: "Lots of volume, few calories",
    goodfat: "Mostly unsaturated fat", trans: "Trans fat", sug: "A lot of sugar, even natural", treat: "A treat", processed: "Processed meat",
    empty: "Little protein or fiber", evidence: "Research beyond the label", balance: "Protein plus fruit or veg" };
  const ROW_KEYS = ["pro", "fib", "cal", "sat", "na", "add", "carb"];
  function breakdown(f, p) {
    const a = assess(f, p);
    if (a.score == null) return null;
    const meal = f.c === "plate";
    const pts = n => a.reasons.filter(r => r.n === n).reduce((t, /** @type {any} */ r) => t + r.d, 0);
    const pct = v => Math.round(v * 100);
    const num = (k, v) => k === "na" || k === "cal" ? Math.round(v).toLocaleString("en-US") : fmt(v);
    const rows = [];
    const row = (k, o) => rows.push({ k, name: { pro: "Protein", fib: "Fiber", cal: "Calories", sat: "Saturated fat", na: "Sodium", add: "Added sugar", carb: "Net carbs" }[k],
      known: known(f, k), atLeast: isLowerBound(f, k), points: pts(k), ...o });
    // Protein: share of calories for one food (what earns the credit); share of the meal's goal for a plate.
    if (meal) row("pro", { kind: "goal", v: f.pro / p.pro, max: 0.5, marks: MEAL_CUT.pro.map(c => c * MEAL_SHARE),
      text: `${fmt(f.pro)} g · ${pct(f.pro / p.pro)}% of your ${p.pro} g goal`, axis: "share of your daily protein goal" });
    else {
      const pd = f.cal > 0 ? Math.min(1, f.pro * 4 / f.cal) : 0;
      row("pro", { kind: "goal", v: pd, max: 1, marks: DENSITY.slice(),
        text: `${fmt(f.pro)} g · ${pct(pd)}% of calories`, axis: "share of calories from protein",
        hint: known(f, "pro") && f.pro < POS_FLOOR.pro && pd >= DENSITY[0] ? `Under ${POS_FLOOR.pro} g, too little to count` : "" });
    }
    row("fib", { kind: "goal", v: f.fib / p.fib, max: 0.4, marks: [meal ? MEAL_CUT.fib * MEAL_SHARE : POS_FLOOR.fib / p.fib],
      text: `${fmt(f.fib)} g · ${pct(f.fib / p.fib)}% of your ${p.fib} g goal`, axis: "share of your daily fiber goal" });
    row("cal", { kind: "ctx", v: f.cal / p.cal, max: meal ? 0.8 : 0.5, marks: [meal ? MEAL_CUT.cal * MEAL_SHARE : HEAVY_SHARE],
      text: `${num("cal", f.cal)} · ${pct(f.cal / p.cal)}% of your day`, axis: "share of your daily calories",
      hint: !meal && f.cal >= HEAVY_SHARE * p.cal && !pts("cal") ? "Past the tick, but it has enough protein to not count against it" : "" });
    for (const [k, u] of [["sat", " g"], ["na", " mg"], ["add", " g"]]) {
      if (!p[k]) continue;
      const v = f[k] / p[k];
      row(k, { kind: "limit", v, max: Math.max(0.5, meal ? 0.5 : CUT[k][1] + 0.15), marks: meal ? MEAL_CUT.limit.map(c => c * MEAL_SHARE) : CUT[k].slice(),
        text: `${isLowerBound(f, k) ? "≥" : ""}${num(k, f[k])}${u} · ${pct(v)}% of your limit`, axis: "share of your daily limit" });
    }
    const net = netCarb(f);
    if (p.carb > 0) rows.push({ k: "carb", name: "Net carbs", known: net != null, atLeast: isLowerBound(f, "carb"), points: pts("carb"), kind: "limit", v: net != null ? net / p.carb : 0,
      max: meal ? 0.5 : 0.65, marks: meal ? MEAL_CUT.limit.map(c => c * MEAL_SHARE) : CUT.carb.slice(),
      text: net != null ? `${isLowerBound(f, "carb") ? "≥" : ""}${fmt(net)} g · ${pct(net / p.carb)}% of your limit` : "Not reported", axis: "share of your daily net-carb limit" });
    const other = a.reasons.filter(r => r.n && !ROW_KEYS.includes(r.n))
      .map(r => ({ n: r.n, points: r.d, label: typeof OTHER_LABEL[r.n] === "function" ? OTHER_LABEL[r.n](f) : OTHER_LABEL[r.n] || r.n }));
    // A score between −2 and +2 is In moderation, or Fine for a serving with barely any calories and nothing to flag.
    const byScore = a.score >= 2 ? "good" : a.score <= -2 ? "bad" : a.tier === "fine" ? "fine" : "mid";
    // When something other than the score set the verdict (missing data, a removed additive), say what.
    const override = a.tier === byScore ? "" : a.why;
    const note = byScore === "fine" ? `Under ${NEGLIGIBLE_KCAL} calories and nothing to flag.` : "";
    return { rows, other, score: a.score, tier: a.tier, word: a.word, byScore, override, note, meal };
  }

  return { netCarb, allergyBlocks, breakdown, CUT, DENSITY, MEAL_CUT, NEGLIGIBLE_KCAL, RANK, DEFAULT_PROFILE, NUM_KEYS, NUTRIENT_WORD, skipMatch, healthyFatSource, servingGrams, isMissing, isLowerBound, missingNote, assess, explain, scale, findSwaps, kindOf, assessMeal, MEAL_SHARE, swapCategory, swapTarget, SWAP_GROUPS, swapDiffs, meaningfulDiff, FDA_DV, POS_FLOOR, HEAVY_SHARE, health, per100kcal, combine, KCAL_MIN, SWAP_HINTS, EVIDENCE, NOTES, slug, legacySlug, foldAccents, fmt };
});
