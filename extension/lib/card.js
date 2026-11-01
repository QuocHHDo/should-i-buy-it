// What the extension's product card says: a one-line reason, bars for the three daily limits, the reasons that
// decided the verdict (the rest folded away), and a better swap. Pure functions on top of verdict.js, so the card can't
// disagree with the app and the tests can check the wording.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"));
  else root.SelfCheckCard = factory(root.SelfCheckVerdict);
})(typeof self !== "undefined" ? self : this, function (V) {
  const pct = (x, t) => Math.round(x / t * 100);
  // Short labels for scored reasons (r.n from assess), for the headline.
  const PLUS = { pro: (f, p, r) => r.d >= 2 ? "high protein for the calories" : "decent protein", fib: "a good fiber source", whole: f => f.c === "fruit" ? "whole fruit" : "a whole vegetable",
    grain: "whole grain", volume: "lots of food for few calories", goodfat: "mostly healthy fats", evidence: "backed by research beyond the label" };
  const MINUS = {
    sat: (f, p) => `${pct(f.sat, p.sat)}% of your saturated-fat limit`, na: (f, p) => `${pct(f.na, p.na)}% of your sodium limit`,
    add: (f, p) => `${pct(f.add, p.add)}% of your added-sugar limit`, trans: () => "some trans fat", sug: () => "a lot of sugar",
    treat: () => "a treat", processed: () => "processed meat", empty: () => "little protein or fiber", cal: f => `${Math.round(f.cal)} calories with little protein`,
  };
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const label = (map, r, f, p) => { const m = map[r.n]; return typeof m === "function" ? m(f, p, r) : m || ""; };
  const byWeight = list => [...list].sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  // One sentence on why: the strongest plus and minus ("Mostly healthy fats, but 15% of your saturated-fat limit.").
  // Falls back to the verdict's own line when something other than the score decided it (skip list, missing data).
  function headline(f, p, a = V.assess(f, p)) {
    if (a.tier === "skip") return a.why;
    // "Fine": the specific reason ("No calories and nothing to flag…") says more than "No real impact either way."
    if (a.tier === "fine") { const n = a.reasons.find(r => r.k === "note" && /barely affects/.test(r.t)); return n ? n.t : a.why; }
    const scored = a.reasons.filter(r => r.n && r.d);
    const plus = byWeight(scored.filter(r => r.d > 0)).map(r => label(PLUS, r, f, p)).filter(Boolean);
    const minus = byWeight(scored.filter(r => r.d < 0)).map(r => label(MINUS, r, f, p)).filter(Boolean);
    const overridden = a.reasons.some(r => r.k === "warn" && /^Can't (rate it|be) "Get it"/.test(r.t));
    if (overridden) return a.why;
    // "Limit it" leads with what's wrong; "In moderation" weighs one against the other.
    if (a.tier === "bad" && minus.length) return `${cap(minus[0])}${minus[1] ? ` and ${minus[1]}` : ""}${plus.length ? `, despite ${plus[0]}` : ""}.`;
    if (plus.length && minus.length) return `${cap(plus[0])}, but ${minus[0]}.`;
    if (minus.length) return `${cap(minus[0])}${minus[1] ? ` and ${minus[1]}` : ""}.`;
    if (plus.length) return a.tier === "good" ? `${cap(plus[0])}${plus[1] ? ` and ${plus[1]}` : ""}.` : `${cap(plus[0])}, but not much else going for it.`;
    // Nothing scored either way: the verdict's own explanation ("Not much fiber or protein for its 150 calories…").
    const warn = a.reasons.find(r => r.k === "warn" && !/^Partial data/.test(r.t));
    return warn ? warn.t.replace(/, so it won't do much to keep you full\.$/, ".") : a.why;
  }

  // Saturated fat, sodium and added sugar against your daily limits, with the verdict's own cutoffs as ticks.
  const LIMITS = ["sat", "na", "add"];
  function limitBars(f, p) {
    const b = V.breakdown(f, p);
    if (!b) return [];
    return b.rows.filter(r => LIMITS.includes(r.k)).map(r => ({
      k: r.k, name: { sat: "Sat fat", na: "Sodium", add: "Added sugar" }[r.k], known: r.known,
      share: r.known ? r.v : null, fill: r.known ? Math.min(1, Math.max(0, r.v) / r.max) : 0, marks: r.marks.filter(m => m < r.max).map(m => m / r.max), markShares: r.marks.filter(m => m < r.max),
      tone: !r.known ? "na" : r.points <= -2 ? "bad" : r.points < 0 ? "warn" : "ok",
      value: r.known ? `${r.atLeast ? "≥" : ""}${r.k === "na" ? Math.round(f.na).toLocaleString("en-US") + " mg" : V.fmt(f[r.k]) + " g"} · ${pct(r.v, 1)}%` : "not listed",
    }));
  }

  // The reasons that decided the verdict come first (biggest effect first, plus anything that capped it); the rest,
  // and additive flags, are folded under "more".
  function reasons(a, flagged = []) {
    const scored = byWeight(a.reasons.filter(r => r.n && r.d)).slice(0, 2);
    const capped = a.reasons.filter(r => r.k === "warn" && (/^Can't/.test(r.t) || /^Spicy/.test(r.t)));
    const top = [...capped, ...scored];
    const rest = [...a.reasons.filter(r => !top.includes(r)), ...flagged.map(x => ({ k: "warn", t: `${x.name}${x.code ? ` (${x.code})` : ""}: ${x.flag.t}` }))];
    return { top, rest };
  }

  // A better option of the same kind, and a Walmart search for it ("Peanut butter, natural" → "natural peanut butter").
  function swap(f, foods, p) {
    const s = V.findSwaps(f, foods, p, 1)[0];
    if (!s) return null;
    return { food: s.food, verdict: s.verdict, query: searchName(s.food.n), lighter: s.lighter || null };
  }
  function searchName(n) {
    const [head, ...rest] = String(n).split(",").map(x => x.trim()).filter(Boolean);
    const extra = rest.join(" ").replace(/\b(plain|regular|store|canned|cooked|raw|unsweetened|fresh|frozen)\b/gi, "").replace(/\s+/g, " ").trim();
    return (extra && extra.split(" ").length <= 2 ? `${extra} ${head}` : head).toLowerCase();
  }
  const walmartSearch = q => "https://www.walmart.com/search?q=" + encodeURIComponent(q);

  // What a dollar buys, by the app's rule (js/prices.js value): protein when the food is a real protein source
  // (at least 5 g and 20% of calories), else fiber when it's a good source (2.8 g+).
  function perDollar(f, cost) {
    if (!(cost > 0) || !f) return null;
    if ((f.pro || 0) >= 5 && f.cal > 0 && f.pro * 4 / f.cal >= 0.2) return `${Math.round(f.pro / cost)} g protein per $1`;
    if ((f.fib || 0) >= 2.8) return `${Math.round(f.fib / cost * 10) / 10} g fiber per $1`;
    return null;
  }
  const money = v => `$${v.toFixed(2)}`;

  // ---------- short copy for the badge and the side panel ----------
  const words = t => String(t).trim().split(/\s+/).filter(Boolean);
  const trimTo = (t, max) => { const w = words(t); return w.length <= max ? t.trim() : w.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…"; };
  // The badge's reason: one short phrase, at most 40 characters ("nothing to flag", "high protein for the calories").
  function badgeReason(f, p, a = V.assess(f, p)) {
    if (a.tier === "skip") return "on your skip list";
    if (a.tier === "fine") return "nothing to flag";
    const scored = a.reasons.filter(r => r.n && r.d);
    const lead = a.tier === "good" ? byWeight(scored.filter(r => r.d > 0)) : byWeight(scored.filter(r => r.d < 0));
    const fromLabel = lead.map(r => label(a.tier === "good" ? PLUS : MINUS, r, f, p)).find(t => t && t.length <= 40);
    if (fromLabel && !a.reasons.some(r => r.k === "warn" && /^Can't (rate it|be) "Get it"/.test(r.t))) return fromLabel;
    // Otherwise the first clause of the headline, cut at a word boundary.
    const h = headline(f, p, a).replace(/\.$/, "").replace(/^Not much fiber or protein for its .*/, "little protein or fiber")
      .replace(/^Only \d+ calories, but .*/, "a small serving, still not free").replace(/^Looks good on what's known, but key data is missing$/, "good so far, but data is missing");
    const clause = h.split(/, (?:but|despite|so|and) |: |; /)[0];
    const t = clause.length <= 40 ? clause : clause.slice(0, 39).replace(/\s+\S*$/, "") + "…";
    return t[0].toLowerCase() + t.slice(1);
  }
  // A note in at most 12 words, with the full sentence kept for a "more" disclosure. Scored reasons use their short
  // label ("30% of your saturated-fat limit"); other notes keep their first clause.
  function shortNote(r, f, p) {
    const full = r.t;
    let short = r.n && r.d ? label(r.d > 0 ? PLUS : MINUS, r, f, p) : "";
    if (short) short = cap(short);
    else {
      // "Partial data: Open Food Facts didn't report fiber." → "Open Food Facts didn't report fiber".
      const body = full.replace(/^Partial data: /, "");
      let first = body.split(/(?<=[a-z0-9%)])[.;:] |, so |, which |, but | — /)[0].replace(/\.$/, "");
      // "Titanium dioxide (E171): Banned as a food additive in the EU since 2022." keeps what follows a short name.
      const named = body.match(/^([^:]{2,40}): (.+)$/);
      if (named && words(named[1]).length <= 4) first = `${named[1]}: ${named[2].split(/(?<=[a-z0-9%)])[.;] |, so |, which |, but /)[0].replace(/\.$/, "")}`;
      short = trimTo(first, 12);
    }
    short = trimTo(short, 12).replace(/\.$/, "");
    return { short, full, more: full.replace(/\.$/, "") !== short };
  }
  // Each verdict has its own shape as well as its own color, so color is never the only cue.
  const TIERS = {
    good: { shape: "check", label: "Get it" },
    fine: { shape: "dot", label: "Fine" },
    mid: { shape: "triangle", label: "In moderation" },
    bad: { shape: "octagon", label: "Limit it" },
    skip: { shape: "slash", label: "Skip" },
    supp: { shape: "capsule", label: "Supplement" },
  };
  // Inline SVG for a verdict's icon (24×24 viewBox). Colors come from CSS custom properties set by the page.
  function icon(tier, size = 20) {
    const S = {
      check: '<circle cx="12" cy="12" r="11" fill="var(--v-good)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--v-glyph, #fff)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
      dot: '<circle cx="12" cy="12" r="9.5" fill="var(--v-fine)"/>',
      triangle: '<path d="M12 2.2L23 21.3H1z" fill="var(--v-mid)" stroke="var(--v-mid)" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v5.6" stroke="#1d1a12" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#1d1a12"/>',
      octagon: '<path d="M7.6 1h8.8L23 7.6v8.8L16.4 23H7.6L1 16.4V7.6z" fill="var(--v-bad)"/><path d="M6.5 12h11" stroke="var(--v-glyph, #fff)" stroke-width="2.8" stroke-linecap="round"/>',
      capsule: '<g transform="rotate(-40 12 12)"><rect x="2.5" y="7.2" width="19" height="9.6" rx="4.8" fill="var(--v-supp, #2c6a3d)"/><path d="M12 7.6v8.8" stroke="var(--v-glyph, #fff)" stroke-width="1.8"/></g>',
      slash: '<circle cx="12" cy="12" r="10" fill="none" stroke="var(--v-bad)" stroke-width="2.8"/><path d="M5.2 18.8L18.8 5.2" stroke="var(--v-bad)" stroke-width="2.8" stroke-linecap="round"/>',
    };
    const t = TIERS[tier] || TIERS.fine;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${S[t.shape]}</svg>`;
  }

  // Missing data that could change the verdict: calories, protein, or a daily limit. A missing fiber value can only
  // cost a food a plus, so it doesn't make the verdict less certain on its own.
  // Missing added sugar doesn't count when total sugars are too low for it to matter: the same rule the verdict uses
  // (below the share of your limit where added sugar starts to count).
  // Could the nutrients that aren't on file change the verdict? Score the food twice, with each missing number at its
  // best plausible value and at its worst, bounded by what the label does say (saturated fat can't exceed total fat,
  // added sugar can't exceed total sugars, protein can't exceed calories / 4). Same verdict both ways: the gap can't
  // matter, so nobody needs to hear about it. Missing calories always matter.
  const BIG = { sat: 0.6, na: 0.6, add: 0.6 }; // of the daily limit: beyond "counts double" for any goals
  function uncertain(f, p = V.DEFAULT_PROFILE) {
    const miss = (f.missing || []).filter(k => k !== "trans" && k !== "chol");
    if (!miss.length) return false;
    if (miss.includes("cal")) return true;
    const known = k => !miss.includes(k) && !V.isLowerBound(f, k);
    const best = { ...f, missing: [] }, worst = { ...f, missing: [] };
    for (const k of miss) {
      if (k === "sat") { best.sat = 0; worst.sat = known("fat") ? f.fat : p.sat * BIG.sat; }
      else if (k === "na") { best.na = 0; worst.na = p.na * BIG.na; }
      else if (k === "add") { best.add = 0; worst.add = known("sug") ? f.sug : f.addLikelyZero ? 0 : p.add * BIG.add; }
      else if (k === "sug") { best.sug = known("add") ? f.add : 0; worst.sug = known("carb") ? Math.max(best.sug, f.carb - (known("fib") ? f.fib : 0)) : best.sug + 30; }
      else if (k === "fat") { best.fat = known("sat") ? f.sat : 0; worst.fat = Math.max(best.fat, f.cal / 9); }
      else if (k === "pro") { best.pro = f.cal / 4; worst.pro = 0; }
      else if (k === "fib") { best.fib = known("carb") ? Math.max(0, f.carb - (known("sug") ? f.sug : 0)) : 15; worst.fib = 0; }
      else if (k === "carb") { best.carb = 0; worst.carb = f.cal / 4; }
      else return true;
    }
    // The actual verdict too: a missing number can hold back a "Get it" on its own.
    const t = V.assess(f, p).tier;
    return V.assess(best, p).tier !== t || V.assess(worst, p).tier !== t;
  }

  return { headline, limitBars, reasons, swap, searchName, walmartSearch, perDollar, money, badgeReason, shortNote, TIERS, icon, uncertain };
});
