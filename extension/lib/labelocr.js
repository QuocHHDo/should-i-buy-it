// Turns the text read from a photo of a label (Tesseract.js, in the browser) into numbers the app can score.
// OCR on package photos is unreliable: glare, curved packages and small type give "Og" for 0g, "29" for 2g, "rng" for
// mg, and lines in the wrong order. So this never scores silently: it returns what it read, how sure it is of each
// number, and what doesn't add up, and the person checks the numbers against the photo before anything is scored.
//
// The checks lean on the label itself: each nutrient's %DV says roughly what its amount must be (the FDA Daily
// Values), and fat, carbohydrate and protein must roughly add up to the calories.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckLabelOcr = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  // FDA Daily Values (21 CFR 101.9), as used for the %DV column.
  const DV = { fat: 78, sat: 20, chol: 300, na: 2300, carb: 275, fib: 28, add: 50 };
  const UNIT = { cal: "", fat: "g", sat: "g", trans: "g", chol: "mg", na: "mg", carb: "g", fib: "g", sug: "g", add: "g", pro: "g" };
  const KEYS = Object.keys(UNIT);
  const LABEL = { cal: "Calories", fat: "Total fat", sat: "Saturated fat", trans: "Trans fat", chol: "Cholesterol", na: "Sodium",
    carb: "Total carbohydrate", fib: "Dietary fiber", sug: "Total sugars", add: "Added sugars", pro: "Protein" };

  // Common OCR slips inside amounts: O for 0, l/I/| for 1, "rng" for mg. Only in number-shaped tokens, so words stay.
  function clean(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')
      .replace(/\br\s?n\s?g\b|\bmq\b|\bmg\./gi, "mg")
      // An amount run into its nutrient's name: "Sodiumi70mg", "Cholesterolomg", "Proteinzg" (z for 2).
      .replace(/(sodium|cholesterol|fat|protein|fiber|carbohydrate|sugars)([ilI|oOz0-9][0-9OoiIl|z.]*\s?(?:mg|g))\b/gi, (m, w, a) => w + " " + a.replace(/(.*?)(\s?m?g)$/, (x, n, u) => n.replace(/z/g, "2").replace(/[ilI|]/g, "1").replace(/[oO]/g, "0") + u))
      // "Og", "0q", "l2g", "1O mg", "<lg": letters standing in for digits next to a unit or other digits
      .replace(/(^|[\s(<:])([0-9OoIl|]{1,5}(?:[.,][0-9OoIl]{1,3})?)\s?(mcg|mg|g|q)\b/g, (m, pre, num, u) =>
        /[0-9]/.test(num) || /^[Oo]$|^[Il|]$/.test(num) ? pre + num.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") + " " + (u === "q" ? "g" : u) : m)
      .replace(/(\d),(\d{3})\b/g, "$1$2") // 1,200 → 1200
      .replace(/(\d),(\d{1,2})\s?(mg|g)\b/g, "$1.$2 $3"); // 2,5 g → 2.5 g
  }

  // "<1g" counts as half its bound, like the rest of the app.
  const num = (lt, n) => { const v = Number(String(n).replace(",", ".")); return Number.isFinite(v) ? (lt ? v / 2 : v) : null; };
  const AMT = String.raw`(<|less than)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(mcg|mg|g)?`;
  const PCT = String.raw`(?:[^\d%\n]{0,6}(\d{1,3})\s*%)?`;
  // Each nutrient: what precedes its amount. Lookbehinds keep "Saturated Fat" from reading as "Fat".
  const PATTERNS = {
    fat: [String.raw`total\s*fat`, String.raw`(?<![a-z.]\s?)(?<!saturated\s|trans\s|sat\.\s|sat\s)\bfat`],
    sat: [String.raw`(?<![a-z])sat(?:urated|\.)?\s*fat`],
    trans: [String.raw`trans\s*fat`],
    chol: [String.raw`cholest(?:erol|\.)?`],
    na: [String.raw`sodium`],
    carb: [String.raw`total\s*carb(?:ohydrate|ohydrates|s|\.)?`, String.raw`(?<!total\s)carbohydrates?`],
    fib: [String.raw`(?:dietary\s*)?fib(?:er|re)`],
    sug: [String.raw`total\s*sugars?`, String.raw`(?<!added\s|incl\.?\s)(?<!includes\s\d{1,3}\s?g\s)\bsugars?(?!\s*alcohol)`],
    pro: [String.raw`protein`],
  };

  // The first amount after a nutrient's name, with the %DV that follows it.
  function find(lower, key) {
    for (const p of PATTERNS[key]) {
      const re = new RegExp(p + String.raw`[^\d<\n]{0,12}?` + AMT + PCT, "i");
      const m = lower.match(re);
      if (m && m[2] != null) return { v: num(m[1], m[2]), u: m[3] || "", dv: m[4] != null ? Number(m[4]) : null, at: m.index };
    }
    return null;
  }

  // Reads a Nutrition Facts or Supplement Facts label from OCR text.
  function parse(text) {
    const t = clean(text), lower = t.toLowerCase();
    const supplement = /supp?lement\s*fact/.test(lower) && !/nutrition\s*fact/.test(lower);
    const values = {}, how = {}, notes = [];
    const set = (k, v, h) => { values[k] = Math.round(v * 100) / 100; how[k] = h; };

    // Calories: the first "Calories" with a number, but not the old footnote's "Calories: 2,000 2,500". When the word
    // itself is unreadable (glare on big type), an older label's "160 Calories from Fat 60" still gives it.
    const cm = [...lower.matchAll(/calories(?!\s*from)\s*[:.]?\s*\n?\s*(\d{1,4})\b(?!\s*2,?500)/g)].find(m => !/^(2000|2500)$/.test(m[1]))
      || lower.match(/(\d{2,4})\s*calories\s*from\s*fat/);
    if (cm) set("cal", Number(cm[1]), "read");
    for (const k of ["fat", "sat", "trans", "chol", "na", "carb", "fib", "sug", "pro"]) {
      const r = find(lower, k);
      if (!r) continue;
      let v = r.v, h = "read";
      // "g" read as "9": "0.59", "29", "169" with no unit. A label rounds amounts under 5 g to 0.5 g, so 0.59 can't be
      // real; whole numbers are ambiguous, so the corrected one is marked for checking (and the %DV check below may
      // decide it).
      if (!r.u && UNIT[k] === "g" && /\d9$/.test(String(r.v)) && !(k === "na" || k === "chol")) {
        const cut = Number(String(r.v).slice(0, -1).replace(/\.$/, ""));
        // Labels give grams in steps of 0.5 g, so a value off that step can't be what's printed.
        const legal = x => Number.isInteger(x * 2);
        const near = x => r.dv == null || !DV[k] ? 0 : Math.abs(x - r.dv / 100 * DV[k]);
        if (Number.isFinite(cut) && ((!legal(r.v) && legal(cut)) || near(cut) <= near(r.v))) { v = cut; h = "fixed"; }
      }
      // Units: sodium and cholesterol in mg; the rest in g.
      if ((k === "na" || k === "chol") && r.u === "g") v *= 1000;
      if (k !== "na" && k !== "chol" && r.u === "mg") v /= 1000;
      set(k, v, h);
      if (r.dv != null) how[k + "%"] = r.dv;
    }
    // "Includes 10g Added Sugars" puts the amount first; older labels have none.
    const am = lower.match(new RegExp(String.raw`incl(?:udes|\.)?\s*` + AMT + String.raw`\s*added\s*sugars?` + PCT)) ||
      lower.match(new RegExp(String.raw`added\s*sugars?[^\d<\n]{0,8}` + AMT + PCT));
    if (am && am[2] != null) { set("add", num(am[1], am[2]), "read"); if (am[4] != null) how["add%"] = Number(am[4]); }

    // The %DV check: a "g" read as "9" turns 2g into 29 g, which its own %DV contradicts. Try the amount without its last
    // digit; if that matches the %DV, use it. A missing amount with a %DV is worked out from it.
    for (const k of Object.keys(DV)) {
      const p = how[k + "%"];
      if (p == null) continue;
      const want = p / 100 * DV[k], tol = Math.max(k === "na" || k === "chol" ? 25 : 1.2, want * 0.3);
      if (values[k] == null) { set(k, want, "dv"); continue; }
      if (Math.abs(values[k] - want) <= tol) continue;
      const s = String(values[k]), cut = s.endsWith("9") && s.length > 1 ? Number(s.slice(0, -1)) : null;
      if (cut != null && Math.abs(cut - want) <= tol) set(k, cut, "fixed");
    }

    // Serving size: "Serving size 2/3 cup (55g)".
    const sm = t.match(/serving\s*size\s*[:.]?\s*([^\n]{1,40})/i);
    // OCR junk at the end ("|", "~~") and common slips: "Thsp" for Tbsp, "(329)" for (32g).
    const serving = sm ? sm[1].replace(/\s+/g, " ").replace(/\s*(amount|calories|servings).*$/i, "").replace(/\bThsp\b/g, "Tbsp")
      .replace(/\((\d{1,3})9\)/, "($1g)").replace(/[\s|~_—–-]+$/, "").trim() : "";
    const gm = serving.match(/\((\d+(?:\.\d+)?)\s*(g|ml)\)/i);

    // Supplement Facts rows: "Caffeine (as caffeine anhydrous) 300 mg".
    const rows = [];
    if (supplement) for (const line of t.split("\n")) {
      const m = line.match(/^\s*([A-Za-z][A-Za-z0-9 ,()'/.-]{1,60}?)\s+(\d[\d.]*)\s*(mcg|µg|mg|g|iu)\b/i);
      if (m && !/serving|servings|daily value|amount per/i.test(m[1])) rows.push({ name: m[1].replace(/\s+/g, " ").trim(), amount: `${m[2]} ${m[3].toLowerCase().replace("µg", "mcg")}` });
    }

    // Some labels (imports, and the second column of others) give amounts per 100 g instead of per serving.
    const per100 = /(amount|values?|nutrients?)\s*per\s*100\s*(g|ml)\b/i.test(t);
    return finish({ supplement, values, how, serving, servingGrams: gm ? Number(gm[1]) : null, rows, notes, per100, text: t });
  }

  // The checks that need every number at once: run after one pass, and again after merging several.
  function finish(r) {
    const { values, how } = r, notes = [];
    for (const k of KEYS) if (how[k] === "doubt") how[k] = "read";
    const doubt = k => { if (how[k] === "read" || how[k] === "fixed" || how[k] === "once") how[k] = "doubt"; };
    // A %DV that disagrees with its amount (after the %DV fix in parse) is a misread one or the other.
    for (const k of Object.keys(DV)) {
      const p = how[k + "%"];
      if (p == null || values[k] == null) continue;
      const want = p / 100 * DV[k], tol = Math.max(k === "na" || k === "chol" ? 25 : 1.2, want * 0.3);
      if (Math.abs(values[k] - want) > tol) doubt(k);
    }
    // Things that can't be true on a real label.
    if (values.sat != null && values.fat != null && values.sat > values.fat + 0.5) { doubt("sat"); notes.push("Saturated fat is more than total fat."); }
    if (values.fib != null && values.carb != null && values.fib > values.carb + 0.5) { doubt("fib"); notes.push("Fiber is more than total carbohydrate."); }
    if (values.sug != null && values.carb != null && values.sug > values.carb + 0.5) { doubt("sug"); notes.push("Sugars are more than total carbohydrate."); }
    if (values.add != null && values.sug != null && values.add > values.sug + 0.5) { doubt("add"); notes.push("Added sugars are more than total sugars."); }
    if (values.cal != null && ["fat", "carb", "pro"].every(k => values[k] != null)) {
      const est = 9 * values.fat + 4 * values.carb + 4 * values.pro;
      if (Math.abs(est - values.cal) > Math.max(30, values.cal * 0.25)) { doubt("cal"); notes.push(`Fat, carbs and protein add up to about ${Math.round(est)} calories, not ${values.cal}.`); }
    }
    if (r.per100) notes.push("This label gives amounts per 100 g, not per serving. Check the serving size.");
    const found = KEYS.filter(k => values[k] != null);
    const missing = KEYS.filter(k => values[k] == null && k !== "add" && k !== "trans");
    return { ...r, kind: r.supplement ? "supplement" : found.length >= 3 ? "nutrition" : "unknown", notes, missing };
  }

  // Several OCR passes over the same photo (different preprocessing) miss different lines. Each number goes to the value
  // most passes agree on; a doubtful read counts half, and ties go to the earlier pass.
  function merge(results) {
    results = results.filter(Boolean);
    if (results.length === 1) return results[0];
    const values = {}, how = {};
    for (const k of KEYS) {
      const votes = new Map();
      results.forEach((r, i) => { const v = r.values[k]; if (v == null) return; const e = votes.get(v) || { n: 0, i, h: r.how[k] }; e.n += r.how[k] === "doubt" ? 0.5 : r.how[k] === "fixed" ? 0.75 : 1; votes.set(v, e); });
      const best = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || a[1].i - b[1].i)[0];
      // Read by only one pass: on the photos this was tested on, a quarter of those were wrong (against 1 in 100
      // when two passes agree), so it's marked for checking.
      if (best) { values[k] = best[0]; how[k] = results.filter(r => r.values[k] === best[0]).length < 2 && best[1].h !== "doubt" ? "once" : best[1].h; }
      const dv = results.map(r => r.how[k + "%"]).find(x => x != null);
      if (dv != null) how[k + "%"] = dv;
    }
    const pick = f => (results.find(r => r[f] && (!Array.isArray(r[f]) || r[f].length)) || results[0])[f];
    return finish({ supplement: results.some(r => r.supplement), values, how, serving: pick("serving"), servingGrams: pick("servingGrams"),
      rows: results.reduce((a, r) => r.rows.length > a.length ? r.rows : a, []), per100: results.some(r => r.per100), text: results.map(r => r.text).join("\n---\n") });
  }

  // How the result reads to a person: "read" numbers look like the label; "dv" and "fixed" were worked out from the
  // label's own %DV; "doubt" disagrees with something else on the label.
  const HOW = { read: "", dv: "worked out from its %DV", fixed: "corrected; check it", once: "hard to read; check it", doubt: "doesn't add up; check it" };

  // The checked numbers as an app food. Blank ones stay unknown (the verdict leaves them out), except what follows
  // from the label itself: 0 g fat means no saturated or trans fat; 0 g carbohydrate means no fiber or sugar.
  function toFood(S, name, serving, values) {
    const v = {};
    for (const k of KEYS) if (values[k] != null && values[k] !== "" && Number.isFinite(Number(values[k])) && Number(values[k]) >= 0) v[k] = Number(values[k]);
    if (v.fat === 0) { if (v.sat == null) v.sat = 0; if (v.trans == null) v.trans = 0; }
    if (v.carb === 0) { for (const k of ["fib", "sug", "add"]) if (v[k] == null) v[k] = 0; }
    const missing = KEYS.filter(k => v[k] == null);
    const f = S.makeFood(name || "Product from a label photo", serving || "1 serving", v, { src: "photo", missing });
    return S.settleAddedSugar(f, v.add != null, false);
  }

  return { parse, merge, finish, toFood, clean, DV, UNIT, KEYS, LABEL, HOW };
});
