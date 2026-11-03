// UI for Should I Buy It? Runs on GitHub Pages ("pages" mode) and inside Claude ("claude" mode).
(function () {
  "use strict";
  const { FOODS, CATEGORIES, DV } = window.SelfCheckData;
  const V = window.SelfCheckVerdict;
  const S = window.SelfCheckSources;
  const Q = window.SelfCheckSearch;
  const CMP = window.SelfCheckCompare; // js/compare.js
  const AL = window.SelfCheckAllergens; // js/allergens.js
  // Icons on the Goals chips and in the summary. Decoration only: the text label is always there.
  const AL_ICON = { milk: "🥛", egg: "🥚", fish: "🐟", shellfish: "🦐", treenut: "🌰", peanut: "🥜", wheat: "🌾", soy: "🫘", sesame: "🥯", gluten: "🍞", vegetarian: "🥕", vegan: "🌱" };
  const CFG = Object.assign({ mode: "pages" }, window.SELF_CHECK_CONFIG || {});
  const PAGES = CFG.mode === "pages";
  const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));
  CAT_LABEL.lookup = "Looked up";

  // ---------- storage (best effort; the page works without it) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const savedProfile = store.get("profile", null);
  // Until someone saves their own goals, verdicts say they're for the standard ones.
  let goalsSet = !!savedProfile;
  let profile = { ...V.DEFAULT_PROFILE, ...(CFG.profile || {}), ...(savedProfile || {}) };
  // Barcode products saved before serving sizes were read correctly (no `missing` list) are dropped; rescanning refreshes them.
  let lookups = store.get("lookups", []).filter(f => f && f.n && typeof f.cal === "number" && !(f.src === "off" && !Array.isArray(f.missing)));
  // Lookups saved before added sugar was tracked as "unknown" stored it as 0; re-check them with the current rule.
  for (const f of lookups) if ((f.src === "usda" || f.src === "off") && f.addLikelyZero === undefined) {
    f.missing = Array.isArray(f.missing) ? f.missing : [];
    S.settleAddedSugar(f, f.src === "off" ? !f.missing.includes("add") : f.add > 0, /\braw\b/i.test(f.n));
  }
  // Lookups saved before the impossible-value checks: run them now (a mistyped record keeps showing otherwise).
  for (const f of lookups) if ((f.src === "usda" || f.src === "off" || f.src === "walmart") && !f.checked) { S.check(f, f.categories); f.checked = 1; }
  let recents = store.get("recents", []);
  let favs = store.get("favorites", []);
  const allFoods = () => [...FOODS, ...lookups];
  const byName = n => allFoods().find(f => f.n === n);

  // ---------- small helpers ----------
  const { el, $ } = window.SelfCheckDom; // js/dom.js
  const fmt = V.fmt;
  const pct = (v, dv) => Math.round(v / dv * 100) + "%";
  // Amounts that respect missing data: "—" when the source didn't report it, "≥" when it's a plate's lower bound.
  const whole = k => k === "na" || k === "chol" || k === "cal";
  function amt(f, k, unit = "") {
    if (V.isMissing(f, k)) return "—";
    const n = whole(k) ? Math.round(f[k]).toLocaleString("en-US") : fmt(f[k]);
    return (V.isLowerBound(f, k) ? "≥" : "") + n + unit;
  }
  const dvText = (f, k) => (V.isMissing(f, k) ? "—" : (V.isLowerBound(f, k) ? "≥" : "") + pct(f[k], DV[k]));
  // The verdict pill, plus a flag for the viewer's allergens (contains / may contain) and the mild-food preference.
  const alPill = a => {
    const al = a && a.allergy;
    if (!al || (al.status !== "contains" && al.status !== "may")) return null;
    return el("span", { class: "vp al-" + al.status, title: al.title, text: al.status === "contains" ? `⚠ ${al.short}` : al.short });
  };
  const pill = a => {
    const extra = [alPill(a), a.spicy ? el("span", { class: "vp spicy", text: "Spicy" }) : null].filter(Boolean);
    const main = el("span", { class: "vp " + a.tier, text: a.word });
    return extra.length ? el("span", { class: "pills" }, main, ...extra) : main;
  };
  // The allergen box above the verdict. With no allergens set, a one-line pointer to set them.
  function renderAllergy(a) {
    const al = a.allergy;
    if (!al) return el("p", { class: "allergy" }, "Allergens and diets aren't checked until you add yours. ",
      el("button", { class: "linkbtn", type: "button", text: "Add allergies or a diet", onclick: () => { showView("goals"); const b = $("p-allergies"); if (b) b.scrollIntoView({ block: "center" }); } }));
    const ICON = { contains: "!", may: "?", unknown: "?", clear: "✓" };
    return el("section", { class: "alflag " + al.status, role: al.status === "contains" ? "alert" : "note", "aria-label": "Your allergens and diet" },
      el("p", { class: "alt" }, el("span", { class: "alic", "aria-hidden": "true", text: ICON[al.status] }), al.title),
      el("p", { text: al.text }),
      el("p", { class: "alnote", text: al.status === "clear" ? "Not a guarantee. Ingredients change and cross-contact isn't always listed." : "Always read the package, and ask your allergist what to avoid." }));
  }
  let toastTimer;
  function toast(msg, action) {
    let t = /** @type {HTMLElement} */ (document.querySelector(".toast"));
    if (!t) { t = el("div", { class: "toast", role: "status" }); document.body.append(t); }
    t.replaceChildren(el("span", { text: msg }), action ? el("button", { class: "toast-act", type: "button", text: action.label,
      onclick: () => { t.hidden = true; clearTimeout(toastTimer); action.run(); } }) : "");
    t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 4500 : 2200);
  }
  const svgIcon = d => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = d; return s; };
  const STAR = '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>';
  const STAR_ON = '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>';
  const LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';

  // ---------- state ----------
  let labelOpen = false, current = null, mult = 1, explainKey = null, compareWith = null, cmpBasis = "serving";
  let glist = store.get("grocery", []).filter(x => x && x.n);
  let plate = store.get("plate", []).filter(x => x && x.n);

  // ---------- nutrition label ----------
  function labelRow(f, name, k, cls = "", bold = true, showDv = true, unit = "g") {
    const left = el("span");
    const a = amt(f, k, unit);
    if (bold) left.append(el("b", { text: name }), " " + a); else left.append(name + " " + a);
    return el("div", { class: "row " + cls, "data-k": k }, left, el("span", { class: "pct", text: showDv ? dvText(f, k) : "" }));
  }
  function servingText(f) { return f.mult && f.mult !== 1 ? `${fmt(f.mult)} × ${f.s}` : f.s; }
  function renderLabel(f) {
    const trans = el("div", { class: "row ind", "data-k": "trans" }, el("span", {}, el("i", { text: "Trans" }), " Fat " + amt(f, "trans", "g")), el("span"));
    const prot = el("div", { class: "row", "data-k": "pro" }, el("span", {}, el("b", { text: "Protein" }), " " + amt(f, "pro", "g")), el("span"));
    const addRow = el("div", { class: "row ind2", "data-k": "add" }, el("span", { text: V.isMissing(f, "add") ? "Added Sugars —" : `Includes ${amt(f, "add", "g")} Added Sugars` }), el("span", { class: "pct", text: dvText(f, "add") }));
    return el("div", { class: "label", role: "group", "aria-label": `Nutrition facts for ${f.n}. Select a line to see what it means.` },
      el("p", { class: "lt", text: "Nutrition Facts" }),
      el("p", { class: "food", text: f.n }),
      el("div", { class: "rule-thin" }),
      el("div", { class: "serv" }, el("span", { text: "Serving size" }), el("span", { text: servingText(f) })),
      el("div", { class: "rule-thick" }),
      el("div", { class: "amt", text: "Amount per serving" }),
      el("div", { class: "cal", "data-k": "cal" }, el("span", { class: "k", text: "Calories" }), el("span", { class: "v", text: amt(f, "cal") })),
      el("div", { class: "rule-med" }),
      el("div", { class: "dvh", text: "% Daily Value*" }),
      labelRow(f, "Total Fat", "fat"),
      labelRow(f, "Saturated Fat", "sat", "ind", false),
      trans,
      labelRow(f, "Cholesterol", "chol", "", true, true, "mg"),
      labelRow(f, "Sodium", "na", "", true, true, "mg"),
      labelRow(f, "Total Carbohydrate", "carb"),
      labelRow(f, "Dietary Fiber", "fib", "ind", false),
      labelRow(f, "Total Sugars", "sug", "ind", false, false),
      addRow,
      prot,
      el("div", { class: "rule-thick" }),
      el("div", { class: "foot", text: "* The % Daily Value tells you how much a nutrient in a serving contributes to a daily diet. 2,000 calories a day is used for general nutrition advice." })
    );
  }
  const GROUP = { more: "Aim for more", low: "Keep low", ctx: "Context" };
  function renderExplain(box, k, f) {
    const e = k && V.explain(k, f, profile);
    if (!e) { box.replaceChildren(el("p", { class: "ex-hint", text: "Tap any line on the label to see what it means." })); return; }
    const detail = V.isMissing(f, k) ? "Not reported for this food, so it isn't counted either way." : (V.isLowerBound(f, k) ? "Some items don't report this, so the total is a minimum. " : "") + e[3];
    box.replaceChildren(el("div", { class: "ex-h" }, el("p", { class: "ex-t", text: e[0] }), el("span", { class: "ex-g " + e[1], text: GROUP[e[1]] })), el("p", { text: e[2] }), el("p", { class: "ex-r", text: detail }));
  }
  function wireLabel(label, box, f) {
    const rows = [...label.querySelectorAll("[data-k]")];
    const choose = k => {
      explainKey = explainKey === k ? null : k;
      rows.forEach(r => { const on = r.dataset.k === explainKey; r.classList.toggle("on", on); r.setAttribute("aria-pressed", on ? "true" : "false"); });
      renderExplain(box, explainKey, f);
    };
    rows.forEach(r => {
      r.setAttribute("role", "button"); r.setAttribute("tabindex", "0"); r.setAttribute("aria-pressed", "false");
      r.addEventListener("click", () => choose(r.dataset.k));
      r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(r.dataset.k); } });
    });
    const keep = explainKey; explainKey = null;
    if (keep) choose(keep); else renderExplain(box, null, f);
  }

  // ---------- share-of-day bars ----------
  function renderBars(f) {
    const p = profile;
    const rows = [
      { n: "Protein", k: "pro", t: p.pro, u: "g", goal: true },
      { n: "Fiber", k: "fib", t: p.fib, u: "g", goal: true },
      { n: "Calories", k: "cal", t: p.cal, u: "", neutral: true },
      { n: "Saturated fat", k: "sat", t: p.sat, u: "g" },
      { n: "Sodium", k: "na", t: p.na, u: "mg" },
      { n: "Added sugar", k: "add", t: p.add, u: "g" },
    ];
    const wrap = el("div", { class: "bars" });
    for (const r of rows) {
      r.v = f[r.k];
      if (V.isMissing(f, r.k)) {
        wrap.append(el("div", { class: "bar", title: `${r.n}: not reported` }, el("span", { class: "name", text: r.n }), el("div", { class: "track na" }), el("span", { class: "val", text: "not reported" })));
        continue;
      }
      const share = r.t > 0 ? r.v / r.t : 0;
      const cls = r.goal ? "goal" : r.neutral ? "neutral" : share >= 0.3 ? "limit-bad" : share >= 0.15 ? "limit-warn" : "limit-ok";
      const val = el("span", { class: "val" }, el("b", { text: (V.isLowerBound(f, r.k) ? "≥" : "") + Math.round(share * 100) + "%" }), ` of ${r.t.toLocaleString("en-US")}${r.u}`);
      wrap.append(el("div", { class: "bar", title: `${r.n}: ${fmt(r.v)}${r.u} of your ${r.t.toLocaleString("en-US")}${r.u} ${r.goal ? "goal" : r.neutral ? "budget" : "limit"}` },
        el("span", { class: "name", text: r.n }), el("div", { class: "track" }, el("div", { class: "fill " + cls, style: `width:${Math.min(100, share * 100).toFixed(1)}%` })), val));
    }
    const what = f.c === "plate" ? "This meal" : f.mult && f.mult !== 1 ? `${fmt(f.mult)} servings` : "One serving";
    return el("section", { class: "panel" }, el("h3", { text: `${what}, as a share of your day` }), wrap,
      el("p", { class: "legend", text: "Green bars are goals to reach. Amber and red show how much of a daily limit this uses." }));
  }

  // ---------- what decided the verdict ----------
  // Each bar is a nutrient against the verdict's own cutoffs (the tick marks), with the points it scored. Other
  // factors and the total follow, so the verdict reads as a sum. Always one standard serving: what the verdict judges.
  const signed = n => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
  function renderWhy(f) {
    const b = V.breakdown(f, profile);
    if (!b) return renderBars(V.scale(f, mult));
    const wrap = el("div", { class: "why-rows" });
    for (const r of b.rows) {
      const tone = !r.known ? "na" : r.points > 0 ? "good" : r.points <= -2 ? "bad" : r.points < 0 ? "warn" : r.kind === "limit" ? "ok" : "neutral";
      const head = el("div", { class: "why-head" }, el("span", { class: "name", text: r.name }),
        el("span", { class: "val", text: r.known ? r.text : "not reported" }),
        el("span", { class: "pts " + tone, text: r.known ? signed(r.points) : "?", "aria-label": r.known ? `${signed(r.points)} points` : "not counted" }));
      const track = el("div", { class: "track" + (r.known ? "" : " na") });
      if (r.known) {
        const w = Math.min(1, Math.max(0, r.v) / r.max);
        track.append(el("div", { class: "fill " + tone, style: `width:${(w * 100).toFixed(1)}%` }));
        if (r.v > r.max) track.append(el("span", { class: "over", "aria-hidden": "true", text: "›" }));
      }
      for (const m of r.marks) if (m < r.max) track.append(el("span", { class: "tick", style: `left:${(m / r.max * 100).toFixed(1)}%`, title: `${Math.round(m * 100)}%` }));
      wrap.append(el("div", { class: "why-row", role: "group", "aria-label": `${r.name}: ${r.known ? r.text : "not reported"}, ${r.known ? signed(r.points) + " points" : "not counted"}. Ticks at ${r.marks.map(m => Math.round(m * 100) + "%").join(" and ")} of the ${r.axis}.` },
        head, track, r.hint && r.known ? el("span", { class: "hint", text: r.hint }) : null));
    }
    const other = b.other.length ? el("div", { class: "why-other" }, el("span", { class: "lbl", text: "Also" }),
      ...b.other.map(o => el("span", { class: "why-chip " + (o.points > 0 ? "good" : "bad") }, el("b", { text: signed(o.points) }), " " + o.label))) : null;
    // Score line from −6 to +6: Limit it at −2 or lower, Get it at +2 or higher.
    // Where a score sits on the -6…+6 scale, as a percentage (a number; formatted where it's used).
    const pos = s => Math.round((Math.max(-6, Math.min(6, s)) + 6) / 12 * 1000) / 10;
    const scale = el("div", { class: "why-scale", "aria-hidden": "true" },
      el("div", { class: "zone bad", style: `width:${pos(-1.5)}%` }), el("div", { class: "zone mid", style: `width:${(pos(1.5) - pos(-1.5)).toFixed(1)}%` }), el("div", { class: "zone good" }),
      el("span", { class: "marker", style: `left:${pos(b.score)}%` }));
    const total = el("div", { class: "why-total" },
      el("p", {}, "Total ", el("b", { text: signed(b.score) }), " → ", el("b", { class: "tw " + b.byScore, text: { good: "Get it", mid: "In moderation", bad: "Limit it", fine: "Fine" }[b.byScore] })),
      scale, el("div", { class: "why-scale-lbl", "aria-hidden": "true" }, el("span", { text: "Limit it ≤ −2" }), el("span", { text: "In moderation" }), el("span", { text: "Get it ≥ +2" })),
      b.note ? el("p", { class: "why-override", text: b.note }) : null,
      b.override ? el("p", { class: "why-override" }, el("b", { text: `Verdict: ${b.word}. ` }), b.override) : null);
    const title = b.meal ? "What decided it (whole meal)" : "What decided it";
    return el("section", { class: "panel decided" }, el("h3", { text: title }), wrap, other, total,
      el("p", { class: "legend", text: (b.meal
        ? "Bars are this meal against a third of your daily goals and limits. Ticks are the cutoffs: past the first, ±1 point; past the second, ±2."
        : "Ticks are the verdict's cutoffs: past the first, ±1 point; past the second, ±2. Protein counts by its share of calories, so a lean food scores higher than a fatty one with the same grams.")
        + (mult !== 1 && !b.meal ? ` Bars are one serving, which is what the verdict judges; the label shows your ${fmt(mult)} servings.` : "") }));
  }

  // ---------- swaps ----------
  // Differences are per serving when servings have similar calories, otherwise per 100 calories, so a big
  // serving can't win just by being big. Only differences of at least 10% of the Daily Value are listed.
  function swapReason(f, g) {
    const { bits, kinds, basis } = V.swapDiffs(f, g);
    const parts = [...kinds];
    if (bits.length) {
      const t = bits.join(" · ");
      parts.push(t[0].toUpperCase() + t.slice(1) + (basis === "kcal" ? ` per 100 calories (serving: ${g.s})` : ` per serving (${g.s} vs ${f.s})`));
      return parts.join(" · ");
    }
    return `${parts.length ? parts.join(" · ") : "Rated higher for your goals"} (${g.s})`;
  }
  function renderSwaps(f) {
    const swaps = V.findSwaps(f, allFoods(), profile, 3);
    if (!swaps.length) return null;
    const list = el("div", { class: "swaps" });
    for (const s of swaps) {
      list.append(el("button", { class: "swap", type: "button", onclick: () => pick(s.food) },
        el("span", { class: "sn", text: s.food.n }), s.lighter ? el("span", { class: "vp lite", text: "Lighter" }) : pill(s.verdict),
        el("span", { class: "sd", text: s.lighter ? `${s.lighter[0].toUpperCase() + s.lighter.slice(1)} (${s.food.s}). Same verdict, but it goes further on your limits.` : swapReason(f, s.food) })));
    }
    return el("section", { class: "panel tryinstead" }, el("h3", { text: "Try instead" }), list);
  }

  // ---------- additives (scanned products) ----------
  // Every additive with what it does; a few flagged with a sourced reason; the NOVA processing level.
  // The label's ingredients in plain groups (js/ingredients.js). Additives get one line each here; their notes are in the panel below.
  function renderIngredients(f) {
    const r = f && f.ingredients && window.SelfCheckIngredients ? window.SelfCheckIngredients.analyze(f.ingredients, f.n) : null;
    if (!r) return null;
    const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
    const sec = el("section", { class: "panel ingredients" }, el("h3", { text: "Ingredients" }), el("p", { class: "ing-sum", text: r.summary + "." }));
    if (r.contains) sec.append(el("p", { class: "ing-allergen" }, el("b", { text: "Label says: " }), `Contains ${r.contains}.`));
    for (const g of r.groups) {
      sec.append(el("div", { class: "ig " + g.tone },
        el("div", { class: "igh" }, el("span", { class: "gdot", "aria-hidden": "true" }), el("b", { text: g.label }), el("span", { class: "muted", text: ` ${g.items.length}` })),
        g.note || g.detail ? el("p", { class: "ign", text: [g.detail, g.note].filter(Boolean).join(" ") }) : null,
        el("div", { class: "ichips" }, ...g.items.map(i => el("span", { class: "ich" + (i.additive ? " st-" + i.additive.status : ""),
          title: [i.pos ? `${ord(i.pos)} ingredient${i.minor ? " (2% or less)" : ""}` : i.inside ? `Part of ${i.inside}` : "", i.additive && (i.additive.role || i.additive.what)].filter(Boolean).join(": ") },
          i.pos ? el("span", { class: "ipos", text: String(i.pos) }) : null, i.name, i.inside ? el("span", { class: "muted", text: ` in ${i.inside.toLowerCase()}` }) : null,
          i.conflict ? el("span", { class: "iwarn", role: "img", "aria-label": "Conflicts with the product name", text: "⚠" }) : null))),
        ...g.items.filter(i => i.conflict).map(i => el("p", { class: "ign iconf", text: `⚠ ${i.name}: ${i.conflict}` }))));
    }
    if (r.may.length) sec.append(el("p", { class: "legend", text: r.may.join(" ") }));
    sec.append(el("details", { class: "ingr" }, el("summary", { text: "The label's full text" }), el("p", { text: f.ingredients })));
    sec.append(el("p", { class: "legend", text: "Numbers are each ingredient's place on the label, from most to least by weight. Groups describe what each ingredient is; the verdict already counts the amounts that matter (added sugar, saturated fat, sodium)." }));
    return sec;
  }

  function renderAdditives(f) {
    const info = window.SelfCheckAdditives && window.SelfCheckAdditives.analyze(f);
    if (!info) return null;
    const sec = el("section", { class: "panel additives" }, el("h3", { text: "Additives & processing" }));
    if (info.novaInfo) sec.append(el("div", { class: "nova n" + info.nova },
      el("span", { class: "nova-badge", text: `NOVA ${info.nova}` }),
      el("span", {}, el("b", { text: info.novaInfo[0] + ". " }), info.novaInfo[1])));
    if (info.known) {
      if (!info.items.length) sec.append(el("p", { class: "muted", text: "No additives listed." }));
      else {
        const list = el("ul", { class: "addlist" });
        // Tap a row for what it is, why it's there and what the evidence says. Removed ones start open.
        for (const a of info.items) {
          const body = el("div", { class: "abody-more" },
            a.what || a.role ? el("p", {}, a.what ? el("b", { text: a.what + " " }) : null, a.role || "") : null,
            a.note ? el("p", {}, a.note, a.src ? " " : null, a.src ? el("a", { href: a.src, target: "_blank", rel: "noopener", text: "Source" }) : null) : null,
            a.efsaHigh ? el("p", { class: "muted", text: "EFSA's safety review found some people may exceed the acceptable daily intake." }) : null,
            el("p", { class: "muted", text: a.statusHint }));
          const sum = el("summary", {},
            el("span", { class: "acode", text: a.code || "—" }),
            el("span", { class: "aname", text: a.name }),
            el("span", { class: `astatus ${a.status}`, text: a.statusLabel }));
          list.append(el("li", { class: `st-${a.status}` }, el("details", { open: a.status === "removed" ? true : null }, sum, body)));
        }
        sec.append(list);
      }
    }
    if (f.ingredients && !window.SelfCheckIngredients) sec.append(el("details", { class: "ingr" }, el("summary", { text: "Ingredients" }), el("p", { text: f.ingredients })));
    sec.append(el("p", { class: "legend", text: (info.fromText ? "Found by name in the ingredient list, so an additive listed under an unusual name can be missed. " : "From Open Food Facts. ") + "Tap an additive for what it is and what the evidence says. Most approved additives are judged safe at normal amounts; “Mixed evidence” means approved but questioned, with the source. Add any you avoid to your skip list (for example “sucralose” or “E407”)." }));
    return sec;
  }

  // ---------- price (typical, or your own) ----------
  const PR = window.SelfCheckPrices;
  let myPrices = store.get("myPrices", {});
  let priceEditing = null;
  const saveMyPrices = () => { store.set("myPrices", myPrices); renderBrowse(); renderPlate(); renderList(); renderMeals(); if (current) renderResult(current); };
  // A store's own price, read from its product page by the extension or the phone bookmark.
  const storePriceOf = f => f && (f.storePrice || (f.spItem || f.spServing ? { perServing: f.spServing, item: f.spItem, unitText: f.spUnit, store: f.spStore || "Walmart", on: f.spOn } : null));
  function renderPrice(f) {
    const sp = storePriceOf(f);
    if (sp) {
      const per = sp.perServing ? sp.perServing * mult : null, v = per && window.SelfCheckCard ? window.SelfCheckCard.perDollar(V.scale(f, mult), per) : null;
      const when = sp.on ? new Date(sp.on + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      return el("section", { class: "panel price" },
        per ? el("div", { class: "price-main" }, el("span", { class: "price-amt", text: `≈ ${PR ? PR.money(per) : "$" + per.toFixed(2)}` }),
          el("span", {}, mult === 1 ? " per serving" : ` for ${fmt(mult)} servings`, v ? el("span", { class: "price-val", text: ` · ${v}` }) : null)) : null,
        el("p", { class: "legend", text: `${sp.store}'s price${when ? ` on ${when}` : ""}${sp.item ? `: $${Number(sp.item).toFixed(2)} an item` : ""}${sp.unitText ? ` (${sp.unitText})` : ""}. Prices change; the shelf wins.` }));
    }
    if (!PR) return null;
    const p = PR.price({ ...f, mult }, myPrices);
    const sec = el("section", { class: "panel price" });
    const editing = priceEditing === f.n;
    const unitWord = p && !p.mine ? p.unitLabel : p && p.mine && p.unitLabel !== "serving" ? p.unitLabel : "serving";
    if (p) {
      const v = PR.value(f, p);
      sec.append(el("div", { class: "price-main" },
        el("span", { class: "price-amt", text: `≈ ${PR.money(p.cost)}` }),
        el("span", {}, mult === 1 ? " per serving" : ` for ${fmt(mult)} servings`, v ? el("span", { class: "price-val", text: ` · ${v.text}` }) : null)));
      sec.append(el("p", { class: "legend" }, p.mine
        ? `Your price: ${PR.money(p.unitPrice)} per ${unitWord}${p.typical != null ? ` (typical ${PR.money(p.typical)} per serving)` : ""}.`
        : `Typical ${PR.money(p.unitPrice)} per ${p.unitLabel} · ${p.source}${p.note ? ` · ${p.note}` : ""}. Your store may differ.`));
    } else sec.append(el("p", { class: "legend", text: "No typical price for this food: there's no free, current price series for it." }));
    if (editing) {
      const input = el("input", { type: "number", min: "0", step: "0.01", inputmode: "decimal", id: "myPrice", "aria-label": `Your price per ${unitWord}`, value: p && p.mine ? String(p.unitPrice) : "" });
      const save = () => { const v = Number(input.value); if (!(v > 0)) { input.setAttribute("aria-invalid", "true"); return; }
        const m = { ...myPrices }; delete m[f.n];
        m[PR.keyOf(f)] = p && !(p.mine && p.unitLabel === "serving") && PR.has(f.n) ? { unit: v } : { serving: v };
        myPrices = m; priceEditing = null; saveMyPrices(); };
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { priceEditing = null; renderResult(current); } });
      sec.append(el("div", { class: "price-edit" }, el("label", { for: "myPrice", text: `What you pay, $ per ${PR.has(f.n) ? (p ? p.unitLabel : "serving") : "serving"}` }), input,
        el("button", { class: "btn small", type: "button", text: "Save", onclick: save }),
        el("button", { class: "btn small ghost", type: "button", text: "Cancel", onclick: () => { priceEditing = null; renderResult(current); } })));
      setTimeout(() => input.focus(), 0);
    } else {
      const row = el("div", { class: "chiprow", style: "margin:0" },
        el("button", { class: "linkish", type: "button", text: p && p.mine ? "Change my price" : PR.has(f.n) ? "Use my store's price" : "Add my price", onclick: () => { priceEditing = f.n; renderResult(current); } }));
      if (p && p.mine) row.append(el("button", { class: "linkish", type: "button", text: "Use typical price", onclick: () => { const m = { ...myPrices }; delete m[f.n]; delete m[PR.keyOf(f)]; myPrices = m; saveMyPrices(); } }));
      sec.append(row);
    }
    return sec;
  }
  function renderPlatePrice() {
    if (!PR) return null;
    const c = PR.plateCost(plate.map(i => ({ food: byName(i.n), mult: i.mult })).filter(i => i.food), myPrices);
    if (!c.priced) return null;
    return el("section", { class: "panel price" }, el("div", { class: "price-main" },
      el("span", { class: "price-amt", text: `≈ ${PR.money(c.total)}` }), el("span", { text: c.missing ? ` for the ${c.priced} item${c.priced === 1 ? "" : "s"} with a price (${c.missing} without)` : " for this meal" })));
  }

  // ---------- compare ----------
  // Shelf prices for the two products being compared: the price and the package size, as the shelf tag shows them.
  // Saved like "Use my store's price", so the product's own page uses them too.
  function shelfPrices(f, g) {
    if (!PR || !PR.shelfCost) return null;
    const item = (food, i) => {
      const s = (PR.mineOf(food, myPrices) || {}).shelf || {};
      return el("div", { class: "shelfrow" }, el("span", { class: "shelfname", text: food.n }),
        el("label", { class: "vh", for: `shp${i}`, text: `Price of ${food.n}` }), el("input", { id: `shp${i}`, name: `p${i}`, inputmode: "decimal", placeholder: "$ price", value: s.price || "" }),
        el("label", { class: "vh", for: `shs${i}`, text: `Package size of ${food.n}` }), el("input", { id: `shs${i}`, name: `s${i}`, placeholder: "64 fl oz", value: s.size || "" }));
    };
    const msg = el("p", { class: "legend", role: "status" });
    const form = el("form", { class: "shelf-prices", onsubmit: e => {
      e.preventDefault();
      const next = { ...myPrices }, bad = [];
      [f, g].forEach((food, i) => {
        const price = form.elements[`p${i}`].value.trim(), size = form.elements[`s${i}`].value.trim();
        if (!price && !size) return;
        const c = PR.shelfCost(price, size, food.s);
        if (c) { delete next[food.n]; next[PR.keyOf(food)] = { serving: Math.round(c.perServing * 1000) / 1000, shelf: { price, size } }; } else bad.push(food.n);
      });
      if (bad.length) { msg.textContent = `Couldn't work out a serving's cost for ${bad.join(" and ")}. Type the price and the size, like 3.99 and 64 fl oz.`; return; }
      myPrices = next; saveMyPrices(); showCompare();
    } }, item(f, 0), item(g, 1), el("div", { class: "shelfbtns" }, el("button", { class: "btn small", type: "submit", text: "Use these prices" })), msg);
    return el("details", { class: "shelf", open: [f, g].some(x => (PR.mineOf(x, myPrices) || {}).shelf) ? null : true },
      el("summary", { text: "Shelf prices" }), form);
  }
  function renderCompare(f) {
    const sec = el("section", { class: "panel compare" }, el("h3", { text: "Compare" }));
    const input = el("input", { type: "search", id: "cmpq", placeholder: "Compare with another food…", "aria-label": "Food to compare with", autocomplete: "off" });
    const list = el("ul", { class: "suggest", role: "listbox", hidden: true });
    const row = el("div", { class: "compare-row" }, input,
      PAGES ? el("button", { class: "btn small", type: "button", text: "Scan to compare", onclick: startCompareScan }) : null);
    sec.append(row, list);
    // Recent scans, one tap each: the products you were just holding.
    const recent = PAGES && !compareWith ? scans.map(x => byName(x.n)).filter(g => g && g.n !== f.n).slice(0, 4) : [];
    if (recent.length) sec.append(el("div", { class: "chiprow", style: "margin:0", role: "group", "aria-label": "Compare with a recent scan" }, el("span", { class: "lbl", text: "Recent scans" }),
      ...recent.map(g => el("button", { class: "chip", type: "button", text: g.n, onclick: () => { compareWith = g; renderResult(current); showCompare(); } }))));
    attachSuggest(input, list, g => { compareWith = g; renderResult(current); });
    if (compareWith && compareWith.n !== f.n) {
      let a = V.scale(f, mult), b = compareWith, note = "";
      if (cmpBasis === "kcal") {
        const a2 = V.per100kcal(f), b2 = V.per100kcal(compareWith);
        if (a2 && b2) { a = a2; b = b2; } else note = `One of these has under ${V.KCAL_MIN} calories per serving, so it's shown per serving instead.`;
      }
      const va = V.assess(f, profile), vb = V.assess(compareWith, profile);
      const basisRow = el("div", { class: "chiprow", style: "margin:0", role: "group", "aria-label": "Compare basis" }, 
        ...[["serving", "Per serving"], ["kcal", "Per 100 calories"]].map(([id, label]) => el("button", { class: "chip" + (cmpBasis === id ? " on" : ""), type: "button", "aria-pressed": cmpBasis === id ? "true" : "false", text: label, onclick: () => { cmpBasis = id; renderResult(current); } })));
      sec.append(basisRow);
      if (note) sec.append(el("p", { class: "legend", text: note }));
      const thead = el("thead", {}, el("tr", {}, el("th", { text: a.s === "100 calories" ? "Per 100 calories" : "Per serving" }),
        el("th", {}, f.n, el("span", { class: "sv", text: a.s === "100 calories" ? "100 calories" : servingText(a) }), pill(va)),
        el("th", {}, compareWith.n, el("span", { class: "sv", text: b.s }), pill(vb))));
      // What's better and by how much is decided in js/compare.js; this draws it.
      const tbody = el("tbody"), cell = (text, mark) => el("td", { class: mark ? "win" : null, text });
      const nutrientRows = CMP.rows(a, b);
      for (const r of nutrientRows) tbody.append(el("tr", {}, el("td", { text: r.label }), cell(amt(a, r.k, r.unit), r.win === 0), cell(amt(b, r.k, r.unit), r.win === 1)));
      // Price per serving when both have one (the shelf prices typed below, or typical prices), then protein per dollar.
      const pa = PR && PR.price({ ...f, mult }, myPrices), pb = PR && PR.price(compareWith, myPrices);
      const perKcal = cmpBasis === "kcal" && a !== f && b !== compareWith && pa && pb ? [pa.perServing * 100 / f.cal, pb.perServing * 100 / compareWith.cal] : null;
      for (const r of CMP.priceRows(pa, pb, pa && PR.value(f, pa), pb && PR.value(compareWith, pb), perKcal))
        tbody.append(el("tr", {}, el("td", { text: r.label }), ...r.values.map((v, i) => cell(r.kind === "money" ? PR.money(v) : `${Math.round(v)} g`, r.win === i))));
      // The answer in one line, for reading in the aisle.
      const sum = CMP.summary(f.n, compareWith.n, nutrientRows, va.word, vb.word);
      sec.append(el("p", { class: "cmpsum", role: "status" }, el("b", { text: sum.lead }), " " + sum.verdicts));
      sec.append(el("div", { class: "ctable-wrap" }, el("table", { class: "ctable" }, thead, tbody)),
        el("p", { class: "legend", text: a.s === "100 calories" ? "Green marks a meaningful difference (at least 10% apart and 5% of the daily value). Per 100 calories shows nutrient density: what you get for the same calories." : "Green marks a meaningful difference (at least 10% apart and 5% of the daily value). Servings differ, so compare against how much you'd actually eat, or switch to per 100 calories." }),
        shelfPrices(f, compareWith),
        el("div", {}, el("button", { class: "btn small ghost", type: "button", text: "Clear comparison", onclick: () => { compareWith = null; renderResult(current); } })));
    }
    return sec;
  }

  // Restaurant or homemade dishes (not packaged foods with a label): their values are a typical recipe.
  const PACKAGED = /frozen|canned|boxed|instant|\bkit\b|snack box|deli\b/i;
  const DISH_ELSEWHERE = new Set(["Elote", "Bao, BBQ pork", "Overnight oats", "Tres leches cake", "Horchata", "Matcha latte, sweetened"]);
  const isDish = f => !f.src && (f.c === "prepared" && !PACKAGED.test(f.n) || DISH_ELSEWHERE.has(f.n));

  // ---------- result ----------
  const MULTS = [0.5, 1, 1.5, 2, 3];
  const multLabel = m => (m === 0.5 ? "½" : m === 1.5 ? "1½" : String(m));
  function renderResult(f) {
    current = f;
    const isPlate = f.c === "plate";
    if (isPlate) mult = 1;
    const scaled = V.scale(f, mult);
    const a = V.assess(f, profile);
    const head = el("div", { class: "result-head" }, el("h2", { text: f.n }), el("span", { class: "cat", text: isPlate ? f.s : CAT_LABEL[f.c] || "" }));
    let seg = null;
    if (isPlate) {
      head.append(f.idea
        ? el("button", { class: "icon-btn", type: "button", onclick: () => { useAsPlate(f.idea); showView("plate"); } }, "Use as my plate")
        : el("button", { class: "icon-btn", type: "button", onclick: () => showView("plate") }, "Edit plate"));
    } else {
      const isFav = favs.includes(f.n), onList = glist.some(x => x.n === f.n);
      const actions = el("div", { class: "actions", role: "group", "aria-label": "Actions" });
      head.append(actions);
      actions.append(
        el("button", { class: "icon-btn", type: "button", "aria-pressed": isFav ? "true" : "false", onclick: () => toggleFav(f) }, svgIcon(isFav ? STAR_ON : STAR), stableLabel(isFav, "Save", "Saved")),
        el("button", { class: "icon-btn", type: "button", "aria-pressed": onList ? "true" : "false", onclick: () => toggleList(f) },
          el("span", { class: "lbl-long" }, stableLabel(onList, "Add to list", "On grocery list")), el("span", { class: "lbl-short" }, stableLabel(onList, "+ List", "On list"))),
        el("button", { class: "icon-btn", type: "button", onclick: () => addToPlate(f, mult) },
          el("span", { class: "lbl-long", text: `Add ${multLabel(mult)} to plate` }), el("span", { class: "lbl-short", text: `+ ${multLabel(mult)} to plate` })));
      if (PAGES) actions.append(el("button", { class: "icon-btn icon-only", type: "button", "aria-label": "Copy link", title: "Copy link", onclick: () => copyLink(f) }, svgIcon(LINK), el("span", { class: "lbl-long", text: "Copy link" })));
      seg = el("div", { class: "serving", role: "group", "aria-label": "Serving size" }, el("span", { class: "lbl", text: "Servings" }));
      for (const m of MULTS) seg.append(el("button", { class: "seg", type: "button", "aria-pressed": m === mult ? "true" : "false", text: multLabel(m), onclick: () => { mult = m; renderResult(current); } }));
    }

    const label = renderLabel(scaled);
    const box = el("div", { class: "explain", "aria-live": "polite" });
    wireLabel(label, box, scaled);
    const src = el("p", { class: "src" });
    if (f.src === "claude") src.append(el("b", { text: "Looked up by Claude. " }), "Typical values; check the package label.");
    else if (f.src === "usda" && f.dataType === "Branded" && f.replacedOff) src.append(el("b", { text: "From USDA Branded Foods. " }), "Open Food Facts' record for this barcode had numbers that look wrong, so this uses the brand's own label data. Recipes change; the package wins.");
    else if (f.src === "usda" && f.dataType === "Branded") src.append(el("b", { text: "From USDA Branded Foods. " }),
      `The brand's own label${f.published ? `, published ${f.published}` : ""}${f.gtin ? ` (UPC ${f.gtin})` : ""}. ${f.perServing ? "Values per serving." : "Values per 100 g."} Recipes change; the package wins.`);
    else if (f.src === "usda") src.append(el("b", { text: "From USDA FoodData Central. " }), "Values per 100 g.");
    else if (f.src === "walmart") src.append(el("b", { text: "From Walmart's Nutrition Facts panel. " }), "Added from the browser extension. Recipes change; the package wins.");
    else if (f.src === "photo") src.append(el("b", { text: "From a photo of the label. " }), "Read on this device and checked by you; the photo wasn't uploaded.");
    else if (f.src === "off") src.append(el("b", { text: "From Open Food Facts. " }), f.per100 ? "Values are per 100 g because the package has no serving size on file; use the servings buttons to match what you eat." : "Values per the package's serving. Crowd-sourced; check the label.");
    else if (isPlate) src.append("The sum of every item at the servings you chose. Judged as one meal: against a third of your daily goals and limits.");
    else if (isDish(f)) src.append(el("b", { text: "A typical recipe. " }), "Restaurant and homemade versions vary a lot, most of all in sodium and portion size, so treat these numbers as an estimate. If the restaurant posts nutrition, that wins.");
    else src.append("Typical values for this serving. Brands vary.");

    // Numbers the source has that no label can have (a mistyped crowd-sourced record): left out, and said so.
    // One short line; what exactly is wrong, and where to fix it, behind "Details".
    const issues = f.issues && f.issues.length ? el("div", { class: "partial-note", role: "note" }, el("span", { text: S.issueSummary(f) }),
      el("details", { class: "issue-more" }, el("summary", { text: "Details" }),
        el("ul", {}, ...f.issues.map(t => el("li", { text: t.replace(/^./, c => c.toUpperCase()) }))),
        f.src === "off" && f.code ? el("a", { href: `https://world.openfoodfacts.org/product/${encodeURIComponent(f.code)}`, target: "_blank", rel: "noopener", text: "Fix it on Open Food Facts" }) : null)) : null;
    // A number that isn't on file is only worth a sentence when it could change the verdict (window.SelfCheckCard's
    // uncertain(): the food scored with the missing numbers at their best and worst plausible values). Otherwise the
    // label's "—" says enough. Plates keep their own note, since their totals can be minimums.
    const C2 = window.SelfCheckCard;
    let partial = null;
    if (isPlate) { const mn = V.missingNote(scaled); if (mn) partial = el("p", { class: "partial-note", role: "note" }, mn.replace(/^Partial data: /, "") + " Shown as “—” and not counted."); }
    else {
      const NAMES = { cal: "calories", fat: "total fat", sat: "saturated fat", na: "sodium", carb: "carbohydrate", fib: "fiber", sug: "total sugars", add: "added sugar", pro: "protein" };
      const keys = (f.missing || []).filter(k => NAMES[k] && !(f.issueKeys || []).includes(k));
      if (keys.length && (!C2 || C2.uncertain(f, profile))) {
        const words = keys.map(k => NAMES[k]), list = words.length < 2 ? words[0] : words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
        partial = el("p", { class: "partial-note", role: "note" }, `${list[0].toUpperCase() + list.slice(1)} ${keys.length > 1 ? "aren't" : "isn't"} listed for this product, so the verdict could change. Check the package.`);
      }
    }
    const ICON = { pos: "+", neg: "−", warn: "!", note: "i" };
    const reasons = el("ul", { class: "reasons" });
    for (const r of a.reasons) reasons.append(el("li", { class: r.k }, el("span", { class: "ic", "aria-hidden": "true", text: ICON[r.k] || "i" }), el("span", { text: r.t })));

    const alFirst = !!(a.allergy && (a.allergy.status === "contains" || a.allergy.status === "may"));
    $("out").replaceChildren(...[
      closestBanner(f),
      head,
      el("div", { class: "result" },
        el("div", { class: "leftcol" + (labelOpen ? "" : " fold") }, seg, issues, partial, label,
          el("button", { class: "btn small ghost label-more", type: "button", "aria-expanded": labelOpen ? "true" : "false",
            text: labelOpen ? "Show less of the label" : "Show the full label", onclick: () => { labelOpen = !labelOpen; renderResult(current); } }),
          box, src, PAGES && !isPlate ? el("p", { class: "report" }, el("a", { href: reportUrl(f, a), target: "_blank", rel: "noopener", text: "Wrong number or verdict? Report it" })) : null),
        el("div", { class: "side" },
          // Your allergens come before the verdict when one is (or may be) in the food; otherwise just after it.
          alFirst ? renderAllergy(a) : null,
          el("div", { class: "tag " + a.tier }, el("div", { class: "for" }, goalsSet ? (isPlate ? "For you · whole meal" : "For you") : (isPlate ? "Standard goals · whole meal · " : "Standard goals · "),
            goalsSet ? null : el("button", { class: "linkbtn", type: "button", text: "Set yours", onclick: () => showView("goals") })), el("div", { class: "verdict" }, C2 ? el("span", { class: "vicon", "aria-hidden": "true", html: C2.icon(a.tier, 34) }) : null, a.word), a.spicy ? el("span", { class: "vp spicy flag", text: "Spicy" }) : null, el("p", { class: "why", text: a.why }),
            mult !== 1 ? el("p", { class: "per", text: "The verdict is for one standard serving; the label and bars show your amount." }) : null),
          alFirst ? null : renderAllergy(a),
          !isPlate && compareWith && compareWith.n !== f.n ? renderCompare(f) : null,
          isPlate ? renderPlatePrice() : renderPrice(f),
          renderWhy(f),
          isPlate ? null : renderSwaps(f),
          el("section", { class: "panel" }, el("h3", { text: "Why" }), reasons),
          isPlate ? null : renderIngredients(f),
          isPlate ? null : renderAdditives(f),
          isPlate || (compareWith && compareWith.n !== f.n) ? null : renderCompare(f)
        ))
    ].filter(Boolean));
  }

  // Problem reports go to the GitHub issue tracker, prefilled with the food and its verdict.
  const REPORT = "https://github.com/QuocHHDo/should-i-buy-it/issues/new";
  const reportUrl = (f, a) => REPORT + "?" + new URLSearchParams({ title: `Wrong verdict or number: ${f.n}`.slice(0, 120),
    body: `Food: ${f.n}${f.s ? ` (${f.s})` : ""}\nSource: ${f.src || "built-in"}\nVerdict: ${a.word}\n\nWhat the package label says (a photo helps):\n\nWhat you expected:\n` });

  // When Enter found only a loose match ("kirkland protein bar" → Protein bar), say so above the result.
  let closestFor = null;
  function closestBanner(f) {
    if (!closestFor || closestFor.n !== f.n) return null;
    const text = closestFor.text;
    const box = el("div", { class: "notice closest", role: "status" }, el("p", {}, closestFor.link ? `No food matches the link #${closestFor.link} exactly. ` : "", "Showing closest match: ", el("strong", { text: f.n }), closestFor.link ? "." : ". It's not exactly what you typed."));
    if (PAGES) box.append(el("button", { class: "btn small ghost", type: "button", text: `Search USDA for “${text}” instead`, onclick: () => usdaSearch(text, box) }),
      el("button", { class: "btn small ghost", type: "button", text: "Packaged products", title: `Search packaged products (USDA Branded Foods) for “${text}”`, onclick: () => usdaSearch(text, box, "branded") }));
    else if (sampleState !== "none") box.append(el("button", { class: "btn small ghost", type: "button", text: `Look up “${text}” with Claude instead`, onclick: () => claudeLookup(text, box) }));
    return box;
  }
  function pick(f, opts = {}) {
    if (current && (current.n !== f.n || current.c === "plate")) { mult = 1; explainKey = null; if (compareWith && compareWith.n === f.n) compareWith = null; }
    closestFor = opts.closest ? { n: f.n, text: opts.closest, link: opts.fromLink } : null;
    if (!current || current.n !== f.n) priceEditing = null;
    $("q").value = opts.closest || f.n; $("suggest").hidden = true;
    // Opening a food from another view goes to Check, as a new history entry so Back returns to that view.
    const fromOther = view !== "check" && !opts.stay;
    if (fromOther) showView("check", { history: false });
    if (!opts.stay && homeMode) { homeMode = false; renderAppHome(); }
    if (!opts.stay) document.body.classList.add("picked");
    renderResult(f);
    if (!opts.noRecent) addRecent(f);
    if (PAGES && !opts.noHash) { try { history[fromOther ? "pushState" : "replaceState"](null, "", "#" + S.linkId(f, V.slug)); } catch {} }
    if (opts.scroll) $("out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // A toggle label that's always as wide as its longer state, so pressing it never moves the buttons beside it.
  const stableLabel = (on, off, onText) => el("span", { class: "stable" },
    el("span", { text: off, "aria-hidden": on ? "true" : null, class: on ? "ghost" : null }),
    el("span", { text: onText, "aria-hidden": on ? null : "true", class: on ? null : "ghost" }));

  // ---------- views (tab bar) ----------
  // One view at a time: Check (search + result), Plate, List, Browse (with the quiz), Goals. On GitHub Pages each
  // view but Check has its own address (#plate, #list, #browse, #goals), so Back and shared links work.
  const VIEWS = ["check", "plate", "list", "browse", "goals"];
  let view = "check";
  const viewFromHash = h => { const v = String(h || "").replace(/^#/, ""); return v !== "check" && VIEWS.includes(v) ? v : null; };
  // opts.history: false when the address already says where we are (a hash change or the first load).
  function showView(v, opts = {}) {
    if (!VIEWS.includes(v)) v = "check";
    const changed = v !== view;
    view = v;
    document.body.dataset.view = v;
    document.querySelectorAll(".view").forEach((/** @type {HTMLElement} */ n) => { n.hidden = n.dataset.view !== v; });
    document.querySelectorAll("#tabs button").forEach((/** @type {HTMLElement} */ b) => b.setAttribute("aria-current", b.dataset.view === v ? "page" : "false"));
    if (v === "browse") renderBrowse();
    if (v === "plate") renderMeals();
    if (v !== "check" && !$("scan").hidden) closeScan(); // don't leave the camera running behind another view
    if (PAGES && opts.history !== false) {
      const want = v !== "check" ? "#" + v : current && current.c !== "plate" ? "#" + S.linkId(current, V.slug) : "";
      if (location.hash !== want) { try { history.pushState(null, "", want || location.pathname + location.search); } catch {} }
    }
    if (changed && opts.scroll !== false) window.scrollTo(0, 0);
  }

  // ---------- favorites, recents, share ----------
  // Recents keep 12 names; the shelf always shows up to 6 that aren't already favorites.
  const RECENTS_KEEP = 12, RECENTS_SHOW = 6;
  function addRecent(f) { recents = [f.n, ...recents.filter(n => n !== f.n)].slice(0, RECENTS_KEEP); store.set("recents", recents); renderChips(); }
  function toggleFav(f) {
    favs = favs.includes(f.n) ? favs.filter(n => n !== f.n) : [f.n, ...favs].slice(0, 30);
    store.set("favorites", favs); renderChips(); renderResult(current);
  }
  async function copyLink(f) {
    const url = location.href.split("#")[0] + "#" + S.linkId(f, V.slug);
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch { toast(url); }
  }
  // Chips show a short name ("Chicken breast") unless two chips would read the same; then both show in full.
  function chipRow(rowId, names) {
    const row = $(rowId);
    const lbl = row.querySelector(".lbl");
    row.replaceChildren(lbl);
    const foods = [...new Set(names)].map(byName).filter(Boolean);
    const short = f => f.n.split(",")[0];
    const count = {}; for (const f of foods) count[short(f)] = (count[short(f)] || 0) + 1;
    for (const f of foods) row.append(el("button", { class: "chip", type: "button", text: count[short(f)] > 1 ? f.n : short(f), title: f.n, onclick: () => pick(f) }));
    row.hidden = !foods.length;
  }
  const QUICK = ["Avocado", "Ground beef 80/20", "Chicken breast, grilled", "Greek yogurt, plain nonfat", "Eggs", "Oatmeal, rolled oats", "Shrimp", "Instant ramen"];
  // Fade the shelf's edges only where there's more to scroll.
  function shelfFade() {
    const sh = $("shelf"); if (!sh) return;
    const more = sh.scrollWidth - sh.clientWidth;
    sh.classList.toggle("fade-start", more > 1 && sh.scrollLeft > 1);
    sh.classList.toggle("fade-end", more > 1 && sh.scrollLeft < more - 1);
  }
  function renderChips() {
    requestAnimationFrame(shelfFade);
    chipRow("favRow", favs);
    chipRow("recentRow", recents.filter(n => !favs.includes(n) && byName(n)).slice(0, RECENTS_SHOW));
    chipRow("quickRow", QUICK);
    $("quickRow").hidden = recents.length + favs.length >= 3;
  }

  // ---------- grocery list ----------
  function saveList() { store.set("grocery", glist); renderList(); }
  function toggleList(f) {
    const had = glist.some(x => x.n === f.n);
    glist = had ? glist.filter(x => x.n !== f.n) : [...glist, { n: f.n, done: false }];
    saveList();
    if (current && current.c !== "plate") renderResult(current);
    toast(had ? "Removed from grocery list" : "Added to grocery list", { label: "Undo", run: () => toggleList(f) });
  }
  // Store sections in a typical walking order. Canned and dried goods go to Pantry, frozen to Frozen.
  const SECTIONS = ["Produce", "Meat & seafood", "Dairy & eggs", "Bakery & grains", "Pantry", "Frozen", "Deli & prepared", "Drinks", "Other"];
  function sectionOf(f) {
    if (!f) return "Other";
    if (/frozen/i.test(f.n)) return "Frozen";
    if (/tofu|tempeh|hummus/i.test(f.n)) return "Produce";
    if (/canned|dried/i.test(f.n) && f.c !== "prepared") return "Pantry";
    return { fruit: "Produce", veg: "Produce", meat: "Meat & seafood", seafood: "Meat & seafood", dairy: "Dairy & eggs", grains: "Bakery & grains",
      plant: "Pantry", nuts: "Pantry", condiments: "Pantry", snacks: "Pantry", protein: "Pantry", drinks: "Drinks", prepared: "Deli & prepared" }[f.c] || "Other";
  }
  const qtyOf = item => Math.max(1, Math.min(99, Math.round(item.qty || 1)));
  // Price of one purchase unit (a lb, a dozen, a gallon…), yours when you've set one.
  // A store product's own item price when it has one (what you'd pay), else the typical price per unit.
  const unitCost = f => { const sp = storePriceOf(f); if (sp && sp.item > 0 && !PR.mineOf(f, myPrices)) return { each: Number(sp.item), unit: "item", mine: false };
    const p = f && PR ? PR.price(f, myPrices) : null; return p ? { each: p.unitPrice, unit: p.unitLabel, mine: p.mine } : null; };
  function listRow(item) {
    const f = byName(item.n), id = "g-" + V.slug(item.n), q = qtyOf(item), u = unitCost(f);
    const setQty = n => { item.qty = Math.max(1, Math.min(99, n)); saveList(); };
    const verdict = f ? V.assess(f, profile) : null;
    // The list's one-tap swap is for a better verdict only, not a lighter version with the same one.
    const swap = f && !item.done && verdict.tier === "bad" ? V.findSwaps(f, allFoods(), profile, 3).find(s => !s.lighter) || null : null;
    return el("div", { class: "lrow" + (item.done ? " done" : "") },
      el("input", { type: "checkbox", id, checked: item.done ? true : null, onchange: e => { item.done = e.target.checked; saveList(); } }),
      el("label", { for: id, text: item.n }),
      verdict ? pill(verdict) : null,
      el("div", { class: "lmeta" },
        el("span", { class: "qty", role: "group", "aria-label": `Quantity of ${item.n}` },
          el("button", { type: "button", text: "−", "aria-label": `One less ${item.n}`, disabled: q <= 1 ? true : null, onclick: () => setQty(q - 1) }),
          el("span", { text: String(q), "aria-live": "polite" }),
          el("button", { type: "button", text: "+", "aria-label": `One more ${item.n}`, disabled: q >= 99 ? true : null, onclick: () => setQty(q + 1) })),
        el("span", { class: "lprice" }, u ? el("b", { text: `≈ ${PR.money(u.each * q)}` }) : "no typical price",
          u ? ` ${PR.money(u.each)}/${u.unit}${u.mine ? " (yours)" : ""}` : null),
        f ? el("button", { class: "linkish", type: "button", text: "View", "aria-label": `View ${item.n}`, onclick: () => pick(f, { scroll: true }) }) : null,
        el("button", { class: "linkish", type: "button", text: "Remove", "aria-label": `Remove ${item.n}`, onclick: () => { glist = glist.filter(x => x !== item); saveList(); if (current && current.c !== "plate") renderResult(current); } })),
      swap ? el("div", { class: "lswap" }, "Try instead: ", el("b", { text: swap.food.n }), " ", pill(swap.verdict), " ",
        el("button", { class: "linkish", type: "button", text: "Swap it", "aria-label": `Swap ${item.n} for ${swap.food.n}`, onclick: () => {
          if (glist.some(x => x.n === swap.food.n)) glist = glist.filter(x => x !== item); else { item.n = swap.food.n; item.done = false; }
          saveList(); toast(`Swapped for ${swap.food.n}`);
        } })) : null);
  }
  // Items to buy grouped by store section, then the ones already in the cart, then an estimated trip total.
  function renderList() {
    const box = $("glistItems");
    box.replaceChildren();
    const open = glist.filter(x => !x.done).length;
    $("tabListN").textContent = String(open); $("tabListN").hidden = !open;
    $("tabListN").setAttribute("aria-label", `${open} to buy`);
    $("glistCount").textContent = glist.length ? `${open} to buy${glist.length > open ? ` · ${glist.length - open} done` : ""}` : "empty";
    if (!glist.length) box.append(el("p", { class: "muted", text: "Choose “Add to list” on any food, or add your “Get it” favorites below." }));
    const toBuy = glist.filter(x => !x.done), done = glist.filter(x => x.done);
    for (const sec of SECTIONS) {
      const items = toBuy.filter(x => sectionOf(byName(x.n)) === sec);
      if (!items.length) continue;
      box.append(el("h3", { class: "lsec", text: sec }));
      for (const item of items) box.append(listRow(item));
    }
    if (done.length) { box.append(el("h3", { class: "lsec", text: "In your cart" })); for (const item of done) box.append(listRow(item)); }
    if (toBuy.length && PR) {
      let total = 0, priced = 0;
      for (const item of toBuy) { const u = unitCost(byName(item.n)); if (u) { total += u.each * qtyOf(item); priced++; } }
      const missing = toBuy.length - priced;
      box.append(el("div", { class: "ltotal" }, priced
        ? el("p", { style: "margin:0" }, "Estimated trip ", el("span", { class: "amt", text: `≈ ${PR.money(total)}` }),
            el("span", { class: "muted", text: ` for ${priced} item${priced === 1 ? "" : "s"}${missing ? `; ${missing} without a price` : ""}` }))
        : el("p", { class: "muted", style: "margin:0", text: "None of these items has a typical price yet." }),
        priced ? el("p", { class: "fine", style: "margin:4px 0 0", text: "One unit of each (a lb, a dozen, a gallon…) times your quantity, at typical South-region or U.S. prices, or your own where you've set one. Your store may differ." }) : null));
    }
    $("glistCopy").disabled = !glist.length; $("glistClear").disabled = $("glistClear").hidden = !glist.some(x => x.done);
  }
  async function copyList() {
    const lines = [];
    for (const sec of SECTIONS) {
      const items = glist.filter(x => !x.done && sectionOf(byName(x.n)) === sec);
      if (!items.length) continue;
      lines.push((lines.length ? "\n" : "") + sec);
      for (const x of items) lines.push(`- ${qtyOf(x) > 1 ? qtyOf(x) + " × " : ""}${x.n}`);
    }
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); toast("List copied"); } catch { toast("Couldn't copy here; select the list and copy it instead."); }
  }
  function addGoodFavorites() {
    const add = favs.map(byName).filter(f => f && V.assess(f, profile).tier === "good" && !glist.some(x => x.n === f.n));
    glist = [...glist, ...add.map(f => ({ n: f.n, done: false }))];
    saveList();
    toast(add.length ? `Added ${add.length} favorite${add.length === 1 ? "" : "s"}` : "No “Get it” favorites to add yet");
  }

  // ---------- plate builder ----------
  function savePlate() { store.set("plate", plate); renderPlate(); }
  function addToPlate(f, m) {
    const ex = plate.find(x => x.n === f.n);
    if (ex) ex.mult = m; else plate.push({ n: f.n, mult: m });
    savePlate();
    toast(`${f.n} is on your plate`);
  }
  function plateFood() {
    const items = plate.map(x => ({ food: byName(x.n), mult: x.mult })).filter(x => x.food);
    return items.length ? V.combine(items) : null;
  }
  function showPlate() {
    const pf = plateFood();
    if (!pf) return;
    explainKey = null;
    renderResult(pf);
    showView("check");
  }
  function afterPlateChange() {
    savePlate();
    if (current && current.c === "plate") { const pf = plateFood(); if (pf) renderResult(pf); else pick(FOODS[0], { noRecent: true, noHash: true, stay: true }); }
  }
  function renderPlate() {
    const box = $("plateItems");
    box.replaceChildren();
    const pf = plateFood();
    $("tabPlateN").textContent = String(plate.length); $("tabPlateN").hidden = !plate.length;
    $("tabPlateN").setAttribute("aria-label", `${plate.length} on your plate`);
    $("plateCount").textContent = pf ? `${pf.s} · ${V.isLowerBound(pf, "cal") ? "at least " : ""}${Math.round(pf.cal)} cal` : "empty";
    $("plateView").disabled = !pf; $("plateClear").disabled = !pf;
    $("plateView").parentElement.hidden = !pf; // nothing to do with an empty plate; keeps the meal ideas in view
    if (!pf) {
      box.append(el("p", { class: "muted", text: "Build a meal: open any food, pick the servings, and choose “Add to plate”." }),
        el("div", { class: "empty-acts" },
          el("button", { class: "btn small", type: "button", text: "Search a food", onclick: () => { showView("check"); $("q").focus(); } }),
          el("button", { class: "btn small ghost", type: "button", text: "Browse foods", onclick: () => showView("browse") })));
      return;
    }
    for (const item of plate) {
      const f = byName(item.n);
      if (!f) continue;
      const sel = el("select", { "aria-label": `Servings of ${item.n}`, onchange: e => { item.mult = Number(e.target.value); afterPlateChange(); } },
        ...MULTS.map(m => el("option", { value: String(m), selected: m === item.mult ? true : null, text: `${multLabel(m)} serving${m === 1 ? "" : "s"}` })));
      box.append(el("div", { class: "lrow" },
        el("span", { class: "pname" }, item.n, el("small", { class: "muted", text: ` · ${f.s}` }), alPill(V.assess(f, profile)) ? " " : null, alPill(V.assess(f, profile))),
        sel,
        el("button", { class: "linkish", type: "button", text: "Remove", "aria-label": `Remove ${item.n} from plate`, onclick: () => { plate = plate.filter(x => x !== item); afterPlateChange(); } })));
    }
    const tot = (k, unit, word) => V.isMissing(pf, k) ? `${word} not reported` : `${V.isLowerBound(pf, k) ? "at least " : ""}${amt({ ...pf, atLeast: [] }, k, unit)} ${word}`;
    const pc = PR ? PR.plateCost(plate.map(i => ({ food: byName(i.n), mult: i.mult })).filter(i => i.food), myPrices) : null;
    const costText = pc && pc.priced ? ` · ≈ ${PR.money(pc.total)}${pc.missing ? ` (${pc.missing} item${pc.missing === 1 ? "" : "s"} unpriced)` : ""}` : "";
    box.append(el("p", { class: "ptotal" }, `Total: ${tot("cal", " cal", "").trim()} · ${tot("pro", " g", "protein")} · ${tot("sat", " g", "saturated fat")} · ${tot("na", " mg", "sodium")}${costText} `, pill(V.assess(pf, profile))));
  }

  // ---------- learn mode ----------
  const L = window.SelfCheckLearn;
  let learn = { asked: 0, correct: 0, streak: 0, missed: [], ...store.get("learn", {}) };
  let quizQ = null, quizChosen = null;
  // ---------- cheap meal ideas (Plate view) ----------
  const M = window.SelfCheckMeals;
  const BUDGETS = [2, 3, 5];
  let mealBudget = store.get("mealBudget", 3), mealProtein = store.get("mealProtein", null); // null: a third of your goal
  let mealCache = { key: "", list: [] };
  function useAsPlate(items) {
    const had = plate.length;
    plate = items.map(i => ({ n: i.food.n, mult: i.mult }));
    savePlate();
    toast(had ? "Your plate is now this meal" : "Added to your plate");
  }
  function ideaFood(items) { const f = V.combine(items, "Meal idea"); f.idea = items; return f; }
  function renderMeals() {
    if (!M || !PR || view !== "plate") return;
    const third = Math.round(profile.pro * V.MEAL_SHARE);
    const target = mealProtein || third;
    const chips = (box, label, opts, on, set) => {
      $(box).replaceChildren(el("span", { class: "lbl", text: label }), ...opts.map(([v, text]) => el("button", { class: "chip" + (v === on ? " on" : ""), type: "button",
        "aria-pressed": v === on ? "true" : "false", text, onclick: () => { set(v); renderMeals(); } })));
    };
    chips("mealBudget", "Budget", BUDGETS.map(b => [b, `Up to $${b}`]), mealBudget, v => { mealBudget = v; store.set("mealBudget", v); });
    const proteinOpts = [...new Set([25, third, 40])].sort((a, b) => a - b).map(g => [g === third ? null : g, g === third ? `${g} g · ⅓ of goal` : `${g} g`]);
    chips("mealProtein", "Protein", proteinOpts, mealProtein === third ? null : mealProtein, v => { mealProtein = v; store.set("mealProtein", v); });
    const key = JSON.stringify([mealBudget, target, profile, myPrices]);
    if (mealCache.key !== key) mealCache = { key, list: M.ideas(FOODS, profile, { budget: mealBudget, protein: target, own: myPrices, max: 6 }) };
    const list = $("mealList");
    list.replaceChildren();
    if (!mealCache.list.length) list.append(el("p", { class: "muted", text: `No meal up to $${mealBudget} reaches ${target} g protein with a “Get it” verdict. Try a bigger budget or less protein.` }));
    for (const idea of mealCache.list) {
      list.append(el("div", { class: "idea" },
        el("div", { class: "idea-head" }, el("span", { class: "cost", text: `≈ ${PR.money(idea.cost)}` }),
          el("span", { text: `${Math.round(idea.plate.pro)} g protein · ${Math.round(idea.plate.cal)} cal` }), pill(idea.verdict)),
        el("ul", {}, ...idea.items.map(({ food, mult }) => el("li", {}, `${multLabel(mult)} × ${food.n} `, el("span", { class: "muted", text: `(${food.s})` })))),
        el("div", { class: "actions" },
          el("button", { class: "btn small", type: "button", text: "Use as my plate", onclick: () => useAsPlate(idea.items) }),
          el("button", { class: "btn small ghost", type: "button", text: "See why", onclick: () => { explainKey = null; renderResult(ideaFood(idea.items)); showView("check"); } }))));
    }
    $("mealNote").textContent = `Built from the ${M.roles(FOODS, profile, myPrices).protein.length} protein foods that have a typical price (most fish and many others don't yet). Costs are per serving at typical prices; foods on your skip list${profile.mild ? " and spicy foods" : ""} are left out.`;
  }

  function nextQuestion() {
    const due = L.dueReview(learn);
    const review = due && L.fromId(due.id, FOODS, profile);
    quizQ = review || L.makeQuestion(FOODS, profile, Math.random);
    quizQ.review = !!review;
    quizChosen = null;
    renderQuiz();
    const first = /** @type {HTMLElement} */ (document.querySelector("#quiz .qopt"));
    if (first) first.focus();
  }
  function answerQuiz(i) {
    if (quizChosen !== null) return;
    quizChosen = i;
    learn = L.recordAnswer(learn, quizQ, i === quizQ.answer);
    store.set("learn", learn);
    renderQuiz();
    const next = $("quizNext");
    if (next) next.focus();
  }
  function renderQuiz() {
    $("learnScore").textContent = learn.asked ? `${learn.correct} of ${learn.asked} right${learn.streak > 1 ? ` · ${learn.streak} in a row` : ""}${learn.missed.length ? ` · ${learn.missed.length} to review` : ""}` : "";
    const box = $("quiz");
    if (!quizQ) {
      box.replaceChildren(el("p", { class: "muted", text: "Quick questions built from these foods and your goals. Missed ones come back later so they stick." }),
        el("div", {}, el("button", { class: "btn small", type: "button", text: "Start", onclick: nextQuestion })));
      return;
    }
    const done = quizChosen !== null;
    const opts = el("div", { class: "qopts", role: "group", "aria-label": "Answers" }, ...quizQ.options.map((o, i) => el("button", {
      class: "qopt" + (done ? (i === quizQ.answer ? " right" : i === quizChosen ? " wrong" : "") : ""),
      type: "button", "aria-disabled": done ? "true" : null, text: o, onclick: () => answerQuiz(i) })));
    const parts = [quizQ.review ? el("p", { class: "qtag", text: "Review: you missed this one earlier" }) : null, el("p", { class: "qprompt", text: quizQ.prompt }), opts];
    if (done) {
      const right = quizChosen === quizQ.answer;
      parts.push(el("div", { class: "qexplain", "aria-live": "polite" },
        el("p", { class: "qres " + (right ? "ok" : "no"), text: right ? "Correct." : `Not quite. The answer is ${quizQ.options[quizQ.answer]}.` }),
        el("p", { text: quizQ.explain }),
        quizQ.principle ? el("p", { class: "muted", text: quizQ.principle }) : null,
        el("div", { class: "actions" }, el("button", { class: "btn small", type: "button", id: "quizNext", text: "Next question", onclick: nextQuestion }),
          ...quizQ.foods.map(f => el("button", { class: "btn small ghost", type: "button", text: `Open ${f.n}`, onclick: () => pick(f, { scroll: true }) })))));
    }
    box.replaceChildren(...parts.filter(Boolean)); // null placeholders would render as the text "null"
  }

  // ---------- browse ----------
  let browseCat = "all";
  let browseSort = store.get("browseSort", "az");
  let browseBasis = store.get("browseBasis", "serving");
  const SORTS = [{ id: "az", label: "A–Z" }, { id: "worst", label: "Least healthy first" }, { id: "best", label: "Healthiest first" }, { id: "value", label: "Most protein per $" }];
  function renderBrowse() {
    $("browseCount").textContent = foodCountText();
    if (view !== "browse") return; // built when the view is shown
    const cats = $("cats");
    cats.replaceChildren();
    const opts = [{ id: "all", label: "All" }, ...CATEGORIES, ...(lookups.length ? [{ id: "lookup", label: "Looked up" }] : [])];
    for (const c of opts) cats.append(el("button", { class: "chip" + (c.id === browseCat ? " on" : ""), type: "button", "aria-pressed": c.id === browseCat ? "true" : "false", text: c.label, onclick: () => { browseCat = c.id; renderBrowse(); } }));
    const sorts = $("bsort");
    sorts.replaceChildren(el("span", { class: "lbl", text: "Sort" }));
    for (const s of SORTS) sorts.append(el("button", { class: "chip" + (s.id === browseSort ? " on" : ""), type: "button", "aria-pressed": s.id === browseSort ? "true" : "false", text: s.label, onclick: () => { browseSort = s.id; store.set("browseSort", s.id); renderBrowse(); } }));
    const ranked = browseSort !== "az", byValue = browseSort === "value";
    $("bsortNote").hidden = !ranked;
    const basis = $("bbasis");
    basis.hidden = !ranked || byValue;
    basis.replaceChildren(el("span", { class: "lbl", text: "Basis" }), ...[["serving", "Per serving"], ["kcal", "Per 100 calories"]].map(([id, label]) =>
      el("button", { class: "chip" + (browseBasis === id ? " on" : ""), type: "button", "aria-pressed": browseBasis === id ? "true" : "false", text: label, onclick: () => { browseBasis = id; store.set("browseBasis", id); renderBrowse(); } })));
    $("bsortNote").textContent = browseBasis === "kcal"
      ? `Ranked by nutrient density: 100 calories' worth of each food, scored by the same rules as the verdict (lower is less healthy). Foods under ${V.KCAL_MIN} calories per serving keep their per-serving score.`
      : "Ranked per serving by the same score behind each verdict (lower is less healthy), then by how much of your saturated fat, sodium and added-sugar limits one serving uses.";

    if (byValue) $("bsortNote").textContent = `Grams of protein a dollar buys, at typical prices (or yours). Only priced foods that are real protein sources (at least 5 g and 20% of calories from protein) are listed. Prices: BLS ${PR.meta.bls}, produce from USDA ERS adjusted to ${PR.meta.cpi}.`;
    /** @type {any[]} */
    let rows = allFoods().filter(f => browseCat === "all" || f.c === browseCat).map(f => ({ f, v: V.assess(f, profile), h: V.health(f, profile, browseBasis) }));
    if (byValue) {
      rows = rows.map(r => { const p = PR.price(r.f, myPrices); const val = PR.value(r.f, p); return { ...r, p, val }; }).filter(r => r.val && r.val.k === "pro");
      rows.sort((x, y) => y.val.v - x.val.v || x.f.n.localeCompare(y.f.n));
    } else if (browseSort === "az") rows.sort((x, y) => x.f.n.localeCompare(y.f.n));
    else {
      const dir = browseSort === "worst" ? 1 : -1;
      rows.sort((x, y) => dir * (x.h.score - y.h.score) || dir * (y.h.harm - x.h.harm) || x.f.n.localeCompare(y.f.n));
    }
    const list = $("blist");
    list.classList.toggle("ranked", ranked);
    list.replaceChildren(...rows.map((r, i) => {
      const name = el("span", {}, ranked ? el("span", { class: "rank", text: `${i + 1}.` }) : null, r.f.n);
      if (byValue) return el("button", { class: "bitem", type: "button", onclick: () => pick(r.f, { scroll: true }) }, name,
        el("span", { class: "bright" }, el("span", { class: "score", title: `${PR.money(r.p.perServing)} per serving`, text: `${Math.round(r.val.v)} g/$` }), pill(r.v)));
      const right = el("span", { class: "bright" }, ranked ? el("span", { class: "score", title: browseBasis === "kcal" && r.h.scaled ? "Health score per 100 calories (higher is better)" : "Health score per serving (higher is better)", text: (r.h.score > 0 ? "+" : "") + r.h.score }) : null, pill(r.v));
      return el("button", { class: "bitem", type: "button", onclick: () => pick(r.f, { scroll: true }) }, name, right);
    }));
    $("browseCount").textContent = foodCountText();
  }

  // ---------- search ----------
  // Matching lives in search.js (exact, prefix, word, contains, and typo-tolerant).
  const match = q => Q.match(q, allFoods()).map(x => x.f);

  // `extra(text)` can add a final action row, e.g. "Search packaged products for …".
  function attachSuggest(input, list, onPick, extra) {
    let sel = -1, sugg = [];
    const close = () => { list.hidden = true; sel = -1; };
    const choose = item => { close(); if (item.run) item.run(); else onPick(item); };
    input.addEventListener("input", () => {
      const text = input.value.trim();
      sugg = text ? match(input.value).slice(0, 7) : [];
      const act = text && extra ? extra(text) : null;
      if (act) sugg.push(act);
      sel = -1;
      list.replaceChildren();
      if (!sugg.length) return close();
      sugg.forEach((f, i) => {
        const li = f.run
          ? el("li", { role: "option", class: "action", id: input.id + "-opt" + i, "aria-selected": "false" }, el("span", { text: f.label }))
          : el("li", { role: "option", id: input.id + "-opt" + i, "aria-selected": "false" }, el("span", { text: f.n }), pill(V.assess(f, profile)));
        li.addEventListener("mousedown", e => { e.preventDefault(); choose(f); });
        list.append(li);
      });
      list.hidden = false;
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", e => {
      // Escape closes open suggestions and keeps the text; a type="search" box would otherwise clear the whole query.
      // With nothing open, Escape does the browser's usual clear.
      if (e.key === "Escape") { if (!list.hidden) { e.preventDefault(); close(); } return; }
      if (list.hidden || !sugg.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length;
        [...list.children].forEach((li, i) => li.setAttribute("aria-selected", i === sel ? "true" : "false"));
        input.setAttribute("aria-activedescendant", input.id + "-opt" + sel);
      } else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); choose(sugg[sel]); }
      else if (e.key === "Enter" && input.id === "cmpq") { e.preventDefault(); const m = match(input.value); if (m.length) choose(m[0]); }
    });
  }

  // ---------- lookups for foods that aren't built in ----------
  // Same numbers in the header and the Browse panel: built-ins + looked-up foods.
  const foodCountText = () => `${FOODS.length} foods` + (lookups.length ? ` + ${lookups.length} looked up` : "");
  function updateCount() {
    $("foodCount").textContent = `${FOODS.length} common foods built in` + (lookups.length ? ` + ${lookups.length} looked up.` : ".");
  }
  function saveLookup(f) {
    if (FOODS.some(x => x.n === f.n)) f.n += f.src === "off" ? "" : " (lookup)";
    if (!f.savedAt) f.savedAt = Date.now();
    lookups = [f, ...lookups.filter(x => x.n !== f.n)].slice(0, 80);
    store.set("lookups", lookups);
    updateCount(); renderBrowse();
  }

  // A barcode number is a barcode, however it arrives (the suggestion row, a link, the Check button).
  const isBarcode = text => /^\d{8,14}$/.test(String(text).replace(/[\s-]/g, ""));
  function openPackaged(text) {
    if (isBarcode(text)) { barcodeLookup(String(text).replace(/[\s-]/g, "")); return; }
    closestFor = null;
    const box = el("div", { class: "notice" }); $("out").replaceChildren(box);
    packagedSearch(text, box);
  }
  function offerLookup(text, near, typo, link) {
    closestFor = null;
    const box = el("div", { class: "notice" }, el("p", { text: link ? `No food matches the link #${link}.` : typo ? `No exact match for “${text}”.` : `“${text}” isn't in the built-in list.` }));
    if (near.length) {
      const p = el("p", { class: "muted" }, near.length > 1 && !typo ? "Did you mean one of these? " : "Did you mean ");
      near.forEach(f => p.append(el("button", { class: "chip", type: "button", text: f.n, onclick: () => pick(f) }), " "));
      box.append(p);
    }
    if (PAGES) {
      box.append(el("div", { class: "chiprow", style: "margin:0" },
        el("button", { class: "btn ghost", type: "button", text: `Search USDA for “${text}”`, onclick: () => usdaSearch(text, box) }),
        el("button", { class: "btn ghost", type: "button", text: "Packaged products", title: `Search packaged products (USDA Branded Foods) for “${text}”`, onclick: () => usdaSearch(text, box, "branded") })));
    } else if (sampleState !== "none") {
      box.append(el("button", { class: "btn ghost", type: "button", text: `Look up “${text}” with Claude`, onclick: () => claudeLookup(text, box) }),
        el("p", { class: "muted", style: "font-size:13px", text: "Uses your Claude account. You'll be asked to allow it the first time." }));
    } else box.append(el("p", { class: "muted", text: "Lookups aren't available in this view, so only built-in foods work here." }));
    $("out").replaceChildren(box);
  }
  const busy = (box, msg) => box.replaceChildren(el("span", { class: "thinking" }, el("span", { class: "dot" }), msg));

  // Packaged products by name: AND search (all words, any field), falling back to any-word search, then re-ranked
  // here with an optional Walmart-brands-only filter (remembered).
  let walmartOnly = store.get("walmartOnly", false);
  async function packagedSearch(text, box) {
    busy(box, `Searching packaged products for ${text}…`);
    const key = (profile.usdaKey || "").trim() || "DEMO_KEY";
    const get = async all => {
      const res = await withTimeout(fetch(S.brandedSearchUrl(text, key, { all })), LOOKUP_MS);
      if (res.status === 429) throw Object.assign(new Error("rate"), { name: "RateLimit" });
      if (res.status === 403) throw Object.assign(new Error("key"), { name: "KeyError" });
      if (!res.ok) throw Object.assign(new Error("http"), { name: "HttpError", status: res.status });
      return (await res.json()).foods || [];
    };
    try {
      let raw = await get(true), loose = false;
      if (!raw.length) { raw = await get(false); loose = true; }
      const render = () => {
        const ranked = S.rankBranded(raw, text, { walmartOnly });
        const items = ranked.map(S.fromUsda).filter(f => !["cal", "fat", "carb", "pro"].every(k => V.isMissing(f, k))).slice(0, 15);
        const toggle = el("button", { class: "chip" + (walmartOnly ? " on" : ""), type: "button", "aria-pressed": walmartOnly ? "true" : "false", text: "Walmart brands only",
          onclick: () => { walmartOnly = !walmartOnly; store.set("walmartOnly", walmartOnly); render(); } });
        const head = el("div", { class: "chiprow", style: "margin:0" }, toggle);
        const generic = el("button", { class: "btn small ghost", type: "button", text: `Search generic foods for “${text}”`, onclick: () => usdaSearch(text, box) });
        if (!items.length) {
          box.replaceChildren(el("p", { text: walmartOnly ? `No Walmart-brand product matches “${text}”.` : `No packaged product matches “${text}”. Try the brand and product, like “great value whole milk”.` }), head, generic);
          return;
        }
        const list = el("ul", { class: "results" });
        for (const f of items) list.append(el("li", {}, el("button", { type: "button", onclick: () => { saveLookup(f); pick(f); } },
          el("span", { class: "rname" }, el("span", { text: f.n }), pill(V.assess(f, profile))),
          el("small", { text: `${amt(f, "cal", " cal")} · ${amt(f, "pro", " g")} protein · ${V.isMissing(f, "sat") ? "sat fat not reported" : amt(f, "sat", " g") + " sat fat"} per ${f.perServing ? f.s : "100 g"}${f.published ? ` · label from ${String(f.published).slice(0, 4)}` : ""}` }))));
        box.replaceChildren(el("p", { text: loose ? `Nothing matched every word of “${text}”, so these match some of them.` : "Packaged products from USDA Branded Foods, with each label's serving." }), head, list, generic);
      };
      render();
    } catch (e) {
      const msg = e.name === "RateLimit" ? "USDA's shared demo key is out of searches for now. Add your own free key under Your goals, or try again later."
        : e.name === "KeyError" ? "USDA rejected the API key. Check the key under Your goals."
        : navigator.onLine === false ? "You're offline. Packaged-product search needs a connection."
        : e.name === "TimeoutError" ? "USDA took too long to answer. Try again in a moment." : "The search didn't go through. Try again in a moment.";
      box.replaceChildren(el("p", { text: msg }), el("button", { class: "btn ghost", type: "button", text: "Try again", onclick: () => packagedSearch(text, box) }));
    }
  }

  async function usdaSearch(text, box, kind = "generic") {
    if (kind === "branded") return packagedSearch(text, box);
    const branded = false;
    busy(box, branded ? `Searching packaged products for ${text}…` : `Searching USDA for ${text}…`);
    const key = (profile.usdaKey || "").trim() || "DEMO_KEY";
    const url = S.usdaSearchUrl(text, key, kind);
    try {
      // USDA's API rejects some requests intermittently; retry twice before giving up.
      let res;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 600 * attempt));
        res = await fetch(url);
        if (res.ok || res.status === 403 || res.status === 429) break;
      }
      if (res.status === 429) throw new Error("rate");
      if (res.status === 403) throw new Error("key");
      if (!res.ok) throw new Error("http");
      const data = await res.json();
      // Keep anything with reported nutrition, including zero-calorie products (tea, diet soda).
      const items = (data.foods || []).map(S.fromUsda).filter(f => !["cal", "fat", "carb", "pro"].every(k => V.isMissing(f, k)));
      const other = el("button", { class: "btn small ghost", type: "button", text: branded ? `Search generic foods for “${text}”` : `Search packaged products for “${text}”`, onclick: () => usdaSearch(text, box, branded ? "generic" : "branded") });
      if (!items.length) { box.replaceChildren(el("p", { text: branded ? `No packaged product matches “${text}”. Try the brand and product, like “great value whole milk”.` : `USDA has no match for “${text}”. Try a simpler name, like “chicken thigh” instead of a brand.` }), other); return; }
      const list = el("ul", { class: "results" });
      for (const f of items) list.append(el("li", {}, el("button", { type: "button", onclick: () => { saveLookup(f); pick(f); } },
        el("span", { text: f.n }), el("br"), el("small", { text: `${amt(f, "cal", " cal")} · ${amt(f, "pro", " g")} protein · ${V.isMissing(f, "sat") ? "sat fat not reported" : amt(f, "sat", " g") + " sat fat"} per ${f.perServing ? f.s : "100 g"}` }))));
      box.replaceChildren(el("p", { text: branded ? "Pick the product. Values are per serving from its label." : "Pick the closest match. USDA values are per 100 g." }), list, other);
    } catch (e) {
      const msg = e.message === "rate" ? "USDA's shared demo key is out of searches for now. Add your own free key under Your goals, or try again later."
        : e.message === "key" ? "USDA rejected the API key. Check the key under Your goals."
        : navigator.onLine === false ? "You're offline. Built-in foods still work; USDA search needs a connection." : "The USDA search didn't go through. Try again in a moment.";
      box.replaceChildren(el("p", { text: msg }), el("button", { class: "btn ghost", type: "button", text: "Try again", onclick: () => usdaSearch(text, box, kind) }));
    }
  }

  // Resolves or rejects like `promise`, but rejects with a "timeout" error after `ms` instead of hanging forever.
  const withTimeout = (promise, ms) => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
    promise.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); fail(e); });
  });
  const LOOKUP_MS = CFG.lookupTimeoutMs || 15000, CAMERA_MS = CFG.cameraTimeoutMs || 60000;

  // A barcode is looked up in Open Food Facts first (crowd-sourced, worldwide, tags additives and NOVA), then in
  // USDA Branded Foods (labels US brands submit, including Walmart's Great Value, Marketside and Equate).
  async function barcodeLookup(code) {
    const clean = String(code).replace(/\D/g, "");
    if (clean.length < 8) { toast("That doesn't look like a full barcode."); return; }
    // Scanned before: the copy saved on this device, at once (and without signal). Re-checked online after 30 days.
    const saved = savedByCode(clean);
    if (saved && (Date.now() - (saved.savedAt || 0) < SAVED_FRESH_MS || navigator.onLine === false)) { scanned(saved); return; }
    const box = el("div", { class: "notice" }); $("out").replaceChildren(box);
    busy(box, `Looking up barcode ${clean}…`);
    const byName = el("button", { class: "btn small ghost", type: "button", text: "Search by name", onclick: () => { $("q").focus(); $("q").select(); } });
    const retry = el("button", { class: "btn small ghost", type: "button", text: "Try again", onclick: () => barcodeLookup(clean) });
    let offErr = null, offEmpty = null;
    try {
      const res = await withTimeout(fetch(S.offProductUrl(clean)), LOOKUP_MS);
      // Open Food Facts answers an unknown barcode with 404 and status 0; other errors mean it's having trouble.
      if (!res.ok && res.status !== 404) throw Object.assign(new Error("http"), { name: "HttpError", status: res.status });
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const f = S.fromOff(clean, data.product);
        // "No nutrition data" means nothing was reported, not that everything is zero (diet soda, water).
        if (!["cal", "fat", "carb", "pro"].every(k => V.isMissing(f, k))) {
          // Numbers in it look wrong: ask USDA (the brand's own filing) for a second opinion.
          if (S.trouble(f)) { busy(box, "Open Food Facts' numbers look wrong. Checking USDA…"); try { const u = await usdaByUpc(clean); scanned(S.secondOpinion(f, u)); return; } catch { scanned(f); return; } }
          scanned(f); return;
        }
        offEmpty = f.n;
      }
    } catch (e) { offErr = e; }

    busy(box, `${offErr ? "Open Food Facts didn't answer" : offEmpty ? `Open Food Facts has “${offEmpty}” but no nutrition data` : "Not in Open Food Facts"}. Checking USDA Branded Foods…`);
    let usdaErr = null;
    try {
      const f = await usdaByUpc(clean);
      if (f) { scanned(f); return; }
    } catch (e) { usdaErr = e; }

    const offline = navigator.onLine === false;
    // Couldn't reach either database: an older saved copy beats nothing.
    if (saved && (offErr || usdaErr)) { scanned(saved); toast("Couldn't reach the databases, so this is the copy saved on this device."); return; }
    const why = e => !e ? "" : e.name === "TimeoutError" ? "took too long to answer" : e.name === "RateLimit" ? "is out of free searches for now" : e.name === "HttpError" ? `had an error (${e.status})` : "couldn't be reached";
    const lines = offline ? [el("p", { text: "You're offline. Barcode lookup needs a connection." })]
      : !offErr && !usdaErr ? [el("p", { text: offEmpty ? `Found “${offEmpty}”, but neither Open Food Facts nor USDA has its nutrition data.` : `Neither Open Food Facts nor USDA Branded Foods has barcode ${clean}.` }),
          el("p", { class: "muted", text: "Check the number, or search the food by name." })]
      : [el("p", { text: `Couldn't finish the lookup: ${offErr ? `Open Food Facts ${why(offErr)}` : "Open Food Facts doesn't have it"}, and USDA ${usdaErr ? why(usdaErr) : "doesn't have it"}.` }),
          usdaErr && usdaErr.name === "RateLimit" ? el("p", { class: "muted", text: "Add your own free USDA key under Your goals to search more." }) : null];
    const photo = PAGES && LS ? el("button", { class: "btn small", type: "button", text: "Read a photo of the label", onclick: () => askLabelPhoto({ code: clean, name: offEmpty || "" }) }) : null;
    // Comparing: the first product is still there to go back to.
    const back = compareScan === "second" && current ? el("button", { class: "btn small ghost", type: "button", text: `Back to ${current.n}`, onclick: () => { compareScan = null; pick(current); } }) : null;
    box.replaceChildren(...lines.filter(Boolean), el("div", { class: "chiprow", style: "margin:0" }, photo, (offErr || usdaErr) && !offline ? retry : null, back, byName));
  }

  // ---------- comparing two scanned products ----------
  // In the store with two products side by side: scan one, then the other, and the second becomes the comparison for
  // the first. "first": the next scan starts a comparison (then the scanner reopens for the second); "second": the
  // next scan (or typed barcode, or label photo) is compared with the product on screen.
  let compareScan = null;
  function scanned(f) {
    saveLookup(f); addScan(f);
    const mode = compareScan; compareScan = null;
    if (mode === "second" && current && current.c !== "plate") {
      if (current.n === f.n) { toast("That's the same product. Scan the other one."); compareScan = "second"; renderResult(current); openScan(); return; }
      compareWith = f; renderResult(current); showCompare(); return;
    }
    pick(f);
    if (mode === "first") startCompareScan();
  }
  // Opens the scanner for the product to compare with the one on screen.
  function startCompareScan() {
    if (!current) return;
    compareScan = "second";
    showView("check", { history: false });
    openScan();
    $("scanMsg").textContent = `Now scan the second product to compare with ${current.n}.`;
    $("scan").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function startCompareFromHome() {
    compareScan = "first";
    // The installed app may already have the camera running: keep it, just change what the next scan does.
    if (camera && camera.running()) { showView("check", { history: false }); $("scanMsg").textContent = "Scan the first of the two products."; $("scan").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    startScanFromHome(); $("scanMsg").textContent = "Scan the first of the two products.";
  }
  function showCompare() {
    const c = document.querySelector("#out .compare");
    if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); const h = c.querySelector("h3"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
  }

  // ---------- reading a label photo ----------
  // For a barcode the databases don't know, or a food with none: the photo is read on this device (vendor/tesseract/,
  // about 7 MB, loaded the first time) and the person checks the numbers before the verdict. Nothing is uploaded.
  const LS = window.SelfCheckLabelScan, LO = window.SelfCheckLabelOcr;
  let labelCtx = null;
  function askLabelPhoto(ctx) { labelCtx = ctx || {}; $("labelFile").click(); }
  async function readLabelPhoto(file) {
    const ctx = labelCtx || {}; labelCtx = null;
    if (homeMode) { homeMode = false; renderAppHome(); }
    const status = el("p", { role: "status", style: "margin:0", text: "Getting the photo…" });
    const box = el("div", { class: "notice" }, el("h2", { style: "margin:0;font-size:18px", text: "Reading the label" }), status);
    $("out").replaceChildren(box);
    try {
      const r = await LS.read(file, { base: "vendor/tesseract/", onStep: t => { status.textContent = t; } });
      if (r.kind === "supplement" && r.rows.length) { renderSupplement({ name: ctx.name || "Supplement (from a label photo)", ingredients: "" }, { kind: "supplement", rows: r.rows, serving: r.serving }); return; }
      box.replaceChildren(el("h2", { style: "margin:0;font-size:18px", text: "Check the numbers" }),
        LS.form(r, { el, idPrefix: "lp", askName: true, name: ctx.name || "", onCancel: () => { box.remove(); },
          onSubmit: (values, serving, name) => {
            const f = LO.toFood(S, name || (ctx.code ? `Barcode ${ctx.code}` : "Product from a label photo"), serving, values);
            if (ctx.code) f.code = ctx.code;
            scanned(f);
          } }));
      const first = box.querySelector(".check input") || box.querySelector("input[name=cal]"); if (first) first.focus();
    } catch (e) {
      box.replaceChildren(el("p", { style: "margin:0", text: navigator.onLine === false ? "You're offline, and the label reader hasn't been loaded on this device yet. Try again with a connection." : "Couldn't read that photo. Try a sharper, straight-on photo of just the Nutrition Facts." }),
        el("button", { class: "btn small", type: "button", text: "Try another photo", onclick: () => askLabelPhoto(ctx) }));
    }
  }
  const SAVED_FRESH_MS = 30 * 86400000;
  const savedByCode = code => lookups.find(f => S.sameCode(f.code, code) || S.sameCode(f.gtin, code)) || null;
  // USDA Branded Foods by UPC: the search only matches the exact digits stored, so try each likely form.
  async function usdaByUpc(code) {
    const key = (profile.usdaKey || "").trim() || "DEMO_KEY";
    for (const q of S.usdaUpcQueries(code)) {
      const res = await withTimeout(fetch(S.usdaUpcUrl(q, key)), LOOKUP_MS);
      if (res.status === 429) throw Object.assign(new Error("rate"), { name: "RateLimit" });
      if (!res.ok) throw Object.assign(new Error("http"), { name: "HttpError", status: res.status });
      const hit = S.matchUpc((await res.json()).foods, code);
      if (hit) return S.fromUsda(hit);
    }
    return null;
  }

  // Camera scanning (js/camera.js). Created on first use: the Claude version has no scanner.
  let camera = null;
  const cam = () => camera || (camera = window.SelfCheckCamera.create({
    ui: { panel: $("scan"), message: $("scanMsg"), button: $("scanBtn"), code: $("code"), reader: "reader" },
    onCode: code => barcodeLookup(code),
    readyText: () => compareScan === "second" && current ? `Now scan the second product to compare with ${current.n}.` : compareScan === "first" ? "Scan the first of the two products." : "Point your camera at the barcode and move closer until it fills the box.",
    timeouts: { wait: CFG.cameraWaitMs, permission: CAMERA_MS, start: CFG.cameraStartMs } }));
  const openScan = () => cam().open(), closeScan = () => cam().close();

  // Claude lookup (Claude version only), via the page's `sample` capability.
  let sampleFn = null, sampleState = PAGES ? "none" : "pending";
  if (!PAGES) (async () => {
    try { sampleFn = window.claude ? await window.claude.use("sample") : null; } catch { sampleFn = null; }
    sampleState = sampleFn ? "ready" : "none";
  })();
  async function claudeLookup(text, box) {
    if (!sampleFn) return;
    busy(box, `Looking up ${text}…`);
    const prompt = S.claudePrompt(text);
    try {
      const d = await sampleFn.json(prompt, { modelTier: "default", cache: { gcTime: 86400000 } });
      if (!d || d.found === false || !d.name) { box.replaceChildren(el("p", { text: `Claude didn't recognize “${text}” as a food. Try a more common name.` })); return; }
      const f = S.fromClaude(d, text);
      saveLookup(f); pick(f);
    } catch (e) {
      const msg = { not_granted: "Claude lookups weren't allowed for this page, so only built-in foods work.", sampling_disabled: "Claude isn't available for this account.",
        rate_limited: "Too many lookups right now. Try again in a minute.", session_expired: "Sign in to Claude again, then retry.",
        invalid_json: "The answer came back in an unexpected shape. Try again." }[e && e.code] || "The lookup didn't finish. Try again.";
      box.replaceChildren(el("p", { text: msg }));
      if (e && ["not_granted", "sampling_disabled"].includes(e.code)) sampleState = "none";
      else box.append(el("button", { class: "btn ghost", type: "button", text: "Try again", onclick: () => claudeLookup(text, box) }));
    }
  }

  // ---------- goals ----------
  const PF = { cal: "p-cal", pro: "p-pro", sat: "p-sat", na: "p-na", add: "p-add", fib: "p-fib" };
  function syncProfileUI() {
    // A field showing an error keeps what the user typed until they fix it; only valid fields are refreshed.
    for (const [k, id] of Object.entries(PF)) if ($(id).getAttribute("aria-invalid") !== "true") $(id).value = profile[k];
    $("p-skip").value = profile.skip || ""; $("p-mild").checked = !!profile.mild; $("p-usda").value = profile.usdaKey || "";
    if (AL) { for (const x of AL.LIST) { const b = /** @type {HTMLInputElement} */ ($("p-al-" + x.id)); if (b) b.checked = (x.diet ? profile.diets || [] : profile.allergies || []).includes(x.id); } $("p-al-other").value = profile.allergyOther || ""; }
    $("profSummary").textContent = `${profile.cal.toLocaleString("en-US")} cal · ${profile.pro} g protein · ≤${profile.sat} g sat fat`;
    if (AL) {
      const picked = [...AL.LIST.filter(x => !x.diet && (profile.allergies || []).includes(x.id)).map(x => `${AL_ICON[x.id]} ${x.label}`),
        ...String(profile.allergyOther || "").split(",").map(t => t.trim()).filter(Boolean)];
      const diets = AL.LIST.filter(x => x.diet && (profile.diets || []).includes(x.id)).map(x => `${AL_ICON[x.id]} ${x.label}`);
      const parts = [picked.length ? `Avoiding ${picked.join(", ")}` : "", diets.length ? diets.join(", ") : ""].filter(Boolean);
      $("alSummary").replaceChildren(...(parts.length ? [el("b", { text: parts.join(" · ") }), ". Foods that contain them are flagged."] : ["Nothing picked, so foods aren't checked for allergens or diet."]));
    }
  }
  function readProfile() {
    // Only valid numbers are saved; an invalid field keeps its last good value and shows why next to it.
    for (const [k, id] of Object.entries(PF)) if (checkGoal($(id))) profile[k] = Number($(id).value);
    profile.skip = $("p-skip").value; profile.mild = $("p-mild").checked; profile.usdaKey = $("p-usda").value.trim();
    if (AL) {
      const on = x => /** @type {HTMLInputElement} */ ($("p-al-" + x.id)).checked;
      profile.allergies = AL.LIST.filter(x => !x.diet && on(x)).map(x => x.id); profile.diets = AL.LIST.filter(x => x.diet && on(x)).map(x => x.id);
      profile.allergyOther = $("p-al-other").value.slice(0, 200);
    }
    store.set("profile", profile); toast("Saved"); goalsSet = true; $("tabGoalsDot").hidden = true; if (current) renderResult(current); syncProfileUI(); renderBrowse(); renderMeals(); renderChips(); renderList(); renderPlate();
    if (current) renderResult(current);
  }

  // ---------- backup, restore, transfer link (Goals view) ----------
  const B = window.SelfCheckBackup;
  const backupNow = () => B.pack(k => store.get(k, undefined));
  const storageWorks = () => { try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return true; } catch { return false; } };
  async function copyText(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok); return true; }
    catch { $("bkPaste").hidden = false; $("bkText").value = text; $("bkText").select(); toast("Couldn't copy here; the text is selected below to copy by hand."); return false; }
  }
  function downloadBackup() {
    const b = backupNow(), name = `should-i-buy-it-backup-${b.saved.slice(0, 10)}.json`;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 1)], { type: "application/json" }));
      const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Backup downloaded");
    } catch { copyText(JSON.stringify(b), "Downloads aren't available here, so the backup was copied as text"); }
  }
  async function copyTransferLink() {
    const link = `${location.origin}${location.pathname}#import=${await B.encode(backupNow())}`;
    copyText(link, `Transfer link copied (${Math.max(1, Math.round(link.length / 1024))} KB). Open it on your other device.`);
  }
  // Shows what a backup holds and asks before replacing anything.
  function previewBackup(r) {
    const box = $("bkPreview");
    box.replaceChildren();
    if (!r.ok) { box.append(el("div", { class: "bk-preview err", text: r.error })); return; }
    const when = r.saved ? new Date(r.saved).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
    const canSave = storageWorks();
    box.append(el("div", { class: "bk-preview" },
      el("p", { style: "margin:0" }, el("b", { text: `Backup${when ? ` from ${when}` : ""}: ` }), B.summary(r.data).join(", ") + "."),
      el("p", { class: "muted", style: "margin:0", text: canSave ? "Restoring replaces what this browser has saved now (your USDA key stays)." : "This browser isn't letting the page save anything, so it can't restore a backup here." }),
      el("div", { class: "actions" },
        canSave ? el("button", { class: "btn small", type: "button", text: "Restore", onclick: () => restoreBackup(r.data) }) : null,
        el("button", { class: "btn small ghost", type: "button", text: "Cancel", onclick: () => box.replaceChildren() }))));
    showView("goals");
    box.scrollIntoView({ block: "nearest" });
  }
  function restoreBackup(data) {
    const key = profile.usdaKey;
    for (const k of Object.keys(B.KEYS)) { try { localStorage.removeItem(k); } catch {} }
    for (const [k, v] of Object.entries(data)) store.set(k, k === "profile" && key ? { ...v, usdaKey: key } : v);
    try { sessionStorage.setItem("restored", "1"); } catch {}
    if (PAGES) { try { history.replaceState(null, "", location.pathname + location.search); } catch {} }
    location.reload();
  }
  async function readBackupFile(file) {
    if (!file) return;
    if (file.size > 5e6) return previewBackup({ ok: false, error: "That file is too large to be a backup." });
    previewBackup(B.parse(await file.text()));
  }
  function wireBackup() {
    if (!B) return;
    $("bkDownload").addEventListener("click", downloadBackup);
    $("bkCopy").addEventListener("click", () => copyText(JSON.stringify(backupNow()), "Backup copied. Paste it into “Paste backup text” on your other device."));
    $("bkLink").hidden = !PAGES;
    $("bkLink").addEventListener("click", copyTransferLink);
    $("bkFileBtn").addEventListener("click", () => $("bkFile").click());
    $("bkFile").addEventListener("change", e => { readBackupFile(e.target.files[0]); e.target.value = ""; });
    $("bkPasteBtn").addEventListener("click", () => { const open = $("bkPaste").hidden; $("bkPaste").hidden = !open; $("bkPasteBtn").setAttribute("aria-expanded", String(open)); if (open) $("bkText").focus(); });
    $("bkPasteGo").addEventListener("click", () => previewBackup(B.parse($("bkText").value.trim())));
    try { if (sessionStorage.getItem("restored")) { sessionStorage.removeItem("restored"); setTimeout(() => toast("Backup restored"), 300); } } catch {}
  }
  // ---------- Walmart product from the phone bookmarklet (#wm=…) ----------
  const WM = window.SelfCheckWalmart, BM = window.SelfCheckBookmarklet;
  async function openWalmartProduct(token) {
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
    showView("check", { history: false });
    const data = B && await B.decodeProduct(token);
    const prod = data && WM ? WM.product(data) : null;
    const plan = WM ? WM.plan(prod) : { kind: "none" };
    if (plan.kind === "panel") {
      const f = plan.food, cost = WM.servingCost(prod.price, f);
      const storeName = WM.STORES && WM.STORES[data.store] ? WM.STORES[data.store].name : "Walmart";
      if (prod.price && (cost || prod.price.now)) Object.assign(f, { spServing: cost || undefined, spItem: prod.price.now || undefined, spUnit: prod.price.text || undefined, spStore: storeName, spOn: new Date().toISOString().slice(0, 10) });
      saveLookup(f); pick(f); toast(`From the ${storeName} page's Nutrition Facts`); return;
    }
    if (plan.kind === "supplement" && window.SelfCheckSupplement) { renderSupplement(prod, plan); return; }
    if (plan.kind === "name") { const f = WM.byName(plan.query, FOODS); if (f) { pick(f, { closest: prod.name }); return; } if (plan.fallback) { barcodeLookup(plan.fallback); return; } }
    if (plan.kind === "barcode") { barcodeLookup(plan.code); return; }
    toast(prod ? "That page isn't a food the app can check." : "Couldn't read that page. Tap the bookmark again on the product page.");
  }
  // A supplement from a Walmart page: not scored like food. Caffeine against the FDA's 400 mg a day, sodium and sugar,
  // what the label lists, sweeteners, and a note that the app doesn't judge whether it works (js/supplement.js).
  function renderSupplement(prod, plan) {
    const SUP = window.SelfCheckSupplement, C = window.SelfCheckCard;
    const sp = SUP.analyze({ name: prod.name, rows: plan.rows, ingredients: prod.ingredients, serving: plan.serving });
    if (homeMode) { homeMode = false; renderAppHome(); }
    current = null;
    const facts = [
      sp.caffeine && sp.caffeine.mg != null ? `${sp.caffeine.mg} mg caffeine (${Math.round(sp.caffeine.share * 100)}% of the FDA's 400 mg a day)` : sp.caffeine ? "contains caffeine" : null,
      sp.sodium != null ? `${Math.round(sp.sodium)} mg sodium (${Math.round(sp.sodium / profile.na * 100)}% of your limit)` : null,
      sp.added != null ? `${V.fmt(sp.added)} g added sugar` : sp.sugar != null ? `${V.fmt(sp.sugar)} g sugar` : null,
      sp.calories != null ? `${Math.round(sp.calories)} calories` : null].filter(Boolean);
    $("out").replaceChildren(el("div", { class: "head" }, el("h2", { text: prod.name })),
      el("div", { class: "result" }, el("div", { class: "side" },
        el("div", { class: "tag supp" }, el("div", { class: "for", text: "Supplement" }), el("div", { class: "verdict" }, el("span", { "aria-hidden": "true", html: C ? C.icon("supp", 30) : "" }), " Not scored like food"),
          el("p", { class: "why", text: facts.length ? `Per serving${sp.serving ? ` (${sp.serving})` : ""}: ${facts.join(" · ")}.` : "This page has the Supplement Facts only as a photo; check the label for amounts." })),
        el("section", { class: "panel" }, el("h3", { text: "Good to know" }), el("ul", { class: "reasons" }, ...SUP.notes(sp).map(n => el("li", { class: n.k }, el("span", { class: "ic", "aria-hidden": "true", text: n.k === "warn" ? "!" : "i" }), el("span", {}, n.short + ". ", el("span", { class: "muted", text: n.full })))))),
        sp.actives.length ? el("section", { class: "panel" }, el("h3", { text: "What's in a serving, as listed" }), el("ul", { class: "reasons" }, ...sp.actives.map(x => el("li", { class: "note" }, el("span", { class: "ic", "aria-hidden": "true", text: "·" }), el("span", { text: [x.name, x.amount, x.dvp && x.dvp !== "**" ? `${x.dvp} DV` : ""].filter(Boolean).join(" · ") }))))) : null,
        prod.ingredients ? renderIngredients({ n: prod.name, ingredients: prod.ingredients }) : null)));
    toast("A supplement: shown, not scored");
  }
  function wireBookmarklet() {
    if (!BM || !PAGES) { $("phoneBox").remove(); return; }
    const url = BM.url(location.origin + location.pathname);
    $("bmLink").setAttribute("href", url);
    $("bmLink").addEventListener("click", e => { e.preventDefault(); toast("Drag it to your bookmarks bar, then use it on a Walmart product page."); });
    $("bmCopy").addEventListener("click", () => copyText(url, "Bookmark code copied. Paste it as the bookmark's address."));
  }

  // #import=… from a transfer link: decode, then show the same preview (nothing changes until Restore).
  async function importFromHash(hash) {
    const m = String(hash).match(/^#(import|add)=(.+)$/);
    if (!m || !B) return false;
    const r = await B.decode(m[2]);
    if (m[1] === "add" || r.kind === "add") {
      try { history.replaceState(null, "", "#list"); } catch {}
      showView("list", { history: false });
      previewAdd(r);
      return true;
    }
    try { history.replaceState(null, "", "#goals"); } catch {}
    showView("goals", { history: false });
    previewBackup(r);
    return true;
  }
  // Items sent from the browser extension: shown first, then merged into the list (nothing is replaced).
  function previewAdd(r) {
    const box = $("addPreview");
    box.replaceChildren();
    if (!r.ok || r.kind !== "add") { box.append(el("div", { class: "bk-preview err", text: r.ok ? "That link is a full backup, not list items. Open it from Goals → Your data." : r.error })); return; }
    const items = r.data.grocery;
    box.append(el("div", { class: "bk-preview" },
      el("p", { style: "margin:0" }, el("b", { text: `Add ${items.length} item${items.length === 1 ? "" : "s"} from the browser extension?` })),
      el("ul", { style: "margin:0;padding-left:18px" }, ...items.map(i => el("li", { text: `${i.qty > 1 ? i.qty + " × " : ""}${i.n}` }))),
      el("div", { class: "actions" },
        el("button", { class: "btn small", type: "button", text: "Add to my list", onclick: () => {
          const incoming = (r.data.lookups || []).map(f => ({ ...f, c: "lookup", a: Array.isArray(f.a) ? f.a : [], tags: Array.isArray(f.tags) ? f.tags : [], missing: Array.isArray(f.missing) ? f.missing : [] }));
          if (incoming.length) { const names = new Set(incoming.map(f => f.n)); lookups = [...lookups.filter(f => !names.has(f.n)), ...incoming]; store.set("lookups", lookups); }
          let added = 0;
          for (const i of items) { const ex = glist.find(x => x.n === i.n); if (ex) { ex.done = false; if (i.qty) ex.qty = i.qty; } else { glist.push({ n: i.n, done: false, ...(i.qty ? { qty: i.qty } : {}) }); added++; } }
          saveList(); updateCount(); box.replaceChildren();
          toast(added ? `Added ${added} item${added === 1 ? "" : "s"} to your list` : "Those items were already on your list");
        } }),
        el("button", { class: "btn small ghost", type: "button", text: "Cancel", onclick: () => box.replaceChildren() }))));
  }

  // ---------- shared links ----------
  // #avocado opens a built-in food; #usda-171705 and #off-3017620422003 open looked-up foods, fetching them
  // again when this browser hasn't seen them. Returns true when the hash names something to open.
  function openFromHash(hash, first) {
    const link = S.parseLinkId(hash);
    if (!link) return false;
    const already = f => current && f.n === current.n;
    if (link.kind === "slug") {
      const foods = allFoods();
      const f = foods.find(x => V.slug(x.n) === link.slug) || foods.find(x => V.legacySlug(x.n) === link.slug);
      if (f) {
        if (V.slug(f.n) !== link.slug) { try { history.replaceState(null, "", "#" + V.slug(f.n)); } catch {} } // old #jalape-o → #jalapeno
        if (!already(f)) pick(f, { noHash: true, noRecent: first });
        return true;
      }
      // No food has this exact link. Never open a different food silently: label a close match, or say it wasn't found.
      const text = link.slug.replace(/-+/g, " ").trim();
      const r = Q.resolve(text, foods);
      if (r.kind === "open" || r.kind === "closest") pick(r.food, { closest: text, fromLink: link.slug, noHash: true, noRecent: true });
      else offerLookup(text, r.near, r.typo, link.slug);
      return true;
    }
    const cached = lookups.find(x => link.kind === "usda" ? x.src === "usda" && x.fdcId === link.id : x.src === "off" && x.code === link.code);
    if (cached) { if (!already(cached)) pick(cached, { noHash: true, noRecent: first }); return true; }
    if (link.kind === "off") { barcodeLookup(link.code); return true; }
    usdaById(link.id);
    return true;
  }
  async function usdaById(id) {
    const box = el("div", { class: "notice" }); $("out").replaceChildren(box);
    busy(box, `Loading USDA food ${id}…`);
    try {
      const res = await withTimeout(fetch(S.usdaFoodUrl(id, (profile.usdaKey || "").trim())), LOOKUP_MS);
      if (res.status === 404) throw Object.assign(new Error("missing"), { name: "NotFound" });
      if (!res.ok) throw Object.assign(new Error("http"), { name: "HttpError", status: res.status });
      const f = S.fromUsda(await res.json());
      saveLookup(f); pick(f, { noHash: true });
    } catch (e) {
      box.replaceChildren(el("p", { text: e.name === "NotFound" ? `USDA has no food with id ${id}.` : e.status === 429 ? "The shared USDA key is out of searches for now. Add your own free key under Your goals, or try later." : "Couldn't load that USDA food. Check your connection and try again." }),
        el("button", { class: "btn small ghost", type: "button", text: "Try again", onclick: () => usdaById(id) }));
    }
  }

  // ---------- goal inputs: inline validation ----------
  // One state only: an invalid value stays in the field, marked, with a message saying what's still in use.
  // Nothing is saved until it's fixed. Every goal field reserves a line for the message, so the row never shifts.
  const goalKey = input => Object.keys(PF).find(k => PF[k] === input.id);
  function checkGoal(input) {
    const raw = input.value.trim(), v = Number(raw), min = Number(input.min), max = Number(input.max);
    const fmtN = n => n.toLocaleString("en-US");
    const problem = raw === "" ? `Enter a number from ${fmtN(min)} to ${fmtN(max)}.`
      : !Number.isFinite(v) ? "That isn't a number."
      : v < min || v > max ? `Use a number from ${fmtN(min)} to ${fmtN(max)}.` : "";
    const k = goalKey(input);
    const msg = problem && k ? `${problem} Still using ${fmtN(profile[k])}.` : problem;
    let err = input.parentElement.querySelector(".err");
    if (!err) { err = el("span", { class: "err", id: input.id + "-err", "aria-live": "polite" }); input.after(err); }
    err.textContent = msg;
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (msg) input.setAttribute("aria-describedby", err.id); else input.removeAttribute("aria-describedby");
    return !msg;
  }

  // ---------- app feel: scan-first home, recent scans, install ----------
  // On phones and in the installed app, the Check view opens with a big Scan button and the last products scanned.
  const SCANS_KEEP = 20, SCANS_SHOW = 6;
  let scans = store.get("scans", []).filter(x => x && x.n);
  const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || /** @type {any} */ (navigator).standalone === true; } catch { return false; } };
  const phone = () => { try { return matchMedia("(max-width: 720px)").matches; } catch { return false; } };
  const fromApp = PAGES && (new URLSearchParams(location.search).get("source") === "app" || standalone());
  // The scan home is the starting screen; it steps aside once a food is opened and comes back when you tap Check again.
  let homeMode = true;
  function addScan(f) { scans = [{ n: f.n, t: Date.now() }, ...scans.filter(x => x.n !== f.n)].slice(0, SCANS_KEEP); store.set("scans", scans); renderAppHome(); }
  function renderAppHome() {
    if (!PAGES) return;
    $("appHome").hidden = !(homeMode && (fromApp || phone()));
    document.body.classList.toggle("home", !$("appHome").hidden);
    renderInstall();
    const C = window.SelfCheckCard;
    const items = scans.map(x => byName(x.n)).filter(Boolean).slice(0, SCANS_SHOW);
    $("scanRecentBox").hidden = !items.length;
    $("scanRecent").replaceChildren(...items.map(f => {
      const a = V.assess(f, profile);
      const al = a.allergy && (a.allergy.status === "contains" || a.allergy.status === "may") ? a.allergy : null;
      return el("li", {}, el("button", { type: "button", "aria-label": `${f.n}: ${a.word}${al ? `. ${al.title}` : ""}`, onclick: () => pick(f, { scroll: true }) },
        el("span", { "aria-hidden": "true", html: C ? C.icon(a.tier, 20) : "" }), el("span", { class: "sn", text: f.n }), al ? alPill(a) : null, el("span", { class: "sv", text: a.word })));
    }));
  }
  function startScanFromHome() { showView("check", { history: false }); openScan(); $("scan").scrollIntoView({ behavior: "smooth", block: "start" }); }
  function goHome() { homeMode = true; document.body.classList.remove("picked"); renderAppHome(); scrollTo({ top: 0, behavior: "smooth" }); }

  // Installing: a real Install button where the browser offers one (Chrome, Edge, Samsung Internet on Android, and
  // desktop Chrome); on iPhone and iPad, the Share → Add to Home Screen steps. The banner shows on phones only, can be
  // dismissed for 30 days, and the Goals tab always has the full instructions.
  let installEvent = null;
  const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const SHARE_ICON = '<svg class="share-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1"/></svg>';
  async function install() {
    if (!installEvent) return;
    installEvent.prompt();
    try { const c = await installEvent.userChoice; if (c && c.outcome === "accepted") toast("Installed. Find Should I Buy It? on your home screen."); } catch {}
    installEvent = null; renderInstall();
  }
  function renderInstall() {
    if (!PAGES) return;
    const dismissed = Date.now() - (store.get("installDismissed", 0) || 0) < 30 * 864e5;
    const can = !!installEvent, iosHow = ios() && !standalone();
    // Not on a first visit (it would push the app's own content down before it has shown any value), and not over a result.
    const used = recents.length > 0 || scans.length > 0;
    $("installBar").hidden = standalone() || dismissed || !phone() || !(can || iosHow) || !used || !homeMode;
    $("installBtn").hidden = !can;
    $("installTxt").replaceChildren(...(can ? ["Install the app to scan from your home screen."]
      : [el("span", { text: "Add it to your home screen: tap " }), el("span", { html: SHARE_ICON }), el("span", { text: " Share, then " }), el("b", { text: "Add to Home Screen" }), el("span", { text: "." })]));
    const how = $("installHow");
    if (standalone()) how.replaceChildren(el("p", { text: "You're using the installed app." }));
    else how.replaceChildren(...[
      can ? el("p", {}, el("button", { class: "btn", type: "button", text: "Install the app", onclick: install })) : null,
      el("p", { class: "muted", text: "Or by hand:" }),
      el("ol", { class: "install-steps" },
        el("li", {}, el("b", { text: "iPhone or iPad (Safari): " }), "tap ", el("span", { html: SHARE_ICON }), " Share, scroll down, tap ", el("b", { text: "Add to Home Screen" }), ", then ", el("b", { text: "Add" }), "."),
        el("li", {}, el("b", { text: "Android (Chrome): " }), "tap the ⋮ menu, then ", el("b", { text: "Install app" }), " (or ", el("b", { text: "Add to Home screen" }), ")."),
        el("li", {}, el("b", { text: "Computer (Chrome or Edge): " }), "click the install icon at the right end of the address bar."))].filter(Boolean));
  }
  if (PAGES) {
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; renderInstall(); });
    window.addEventListener("appinstalled", () => { installEvent = null; store.set("installDismissed", Date.now()); renderInstall(); });
  }

  // ---------- boot ----------
  function init() {
    updateCount();
    if (!PAGES) document.querySelectorAll("[data-pages-only]").forEach(n => n.remove());
    if (PAGES) $("q").placeholder = "Try avocado, or a product like great value whole milk";
    $("scanBtn").hidden = !PAGES; $("usdaKeyWrap").hidden = !PAGES;

    attachSuggest($("q"), $("suggest"), f => pick(f), PAGES ? text => isBarcode(text) ? { label: `Look up barcode ${text.replace(/[\s-]/g, "")}`, run: () => barcodeLookup(text.replace(/[\s-]/g, "")) }
      : { label: `Search packaged products for “${text}”`, run: () => openPackaged(text) } : null);
    $("shelf").addEventListener("scroll", shelfFade, { passive: true });
    window.addEventListener("resize", shelfFade);
    $("form").addEventListener("submit", e => {
      e.preventDefault();
      const text = $("q").value.trim(); if (!text) return;
      $("suggest").hidden = true;
      if (isBarcode(text) && PAGES) return barcodeLookup(text.replace(/[\s-]/g, ""));
      // "great value whole milk", "marketside caesar kit": a store brand means a packaged product.
      if (PAGES && S.storeBrand(text) && !allFoods().some(f => Q.isExact(f, text))) return openPackaged(text);
      const r = Q.resolve(text, allFoods());
      if (r.kind === "open") return pick(r.food);
      if (r.kind === "closest") return pick(r.food, { closest: text });
      offerLookup(text, r.near, r.typo);
    });
    $("scanBtn").addEventListener("click", () => ($("scan").hidden ? openScan() : closeScan()));
    $("scanClose").addEventListener("click", () => { compareScan = null; closeScan(); });
    $("codeForm").addEventListener("submit", async e => { e.preventDefault(); const c = $("code").value; await closeScan(); barcodeLookup(c); });

    // One checkbox per allergen, built from js/allergens.js so the list can't drift from what's detected.
    // A chip per allergen or diet: the icon is decoration (the label says it), the checkbox inside does the work.
    const box = x => el("label", { class: "tog", title: x.hint }, el("input", { type: "checkbox", id: "p-al-" + x.id }),
      el("span", { class: "tc", "aria-hidden": "true", text: "✓" }), el("span", { class: "ti", "aria-hidden": "true", text: AL_ICON[x.id] || "" }), x.label);
    if (AL) { $("p-al-boxes").replaceChildren(...AL.LIST.filter(x => !x.diet).map(box)); $("p-diet-boxes").replaceChildren(...AL.LIST.filter(x => x.diet).map(box)); }
    else { $("p-allergies").hidden = true; $("p-diets").hidden = true; }
    document.querySelectorAll("#profile input, #alBox input, #prefBox input").forEach(i => i.addEventListener("change", readProfile));
    Object.values(PF).forEach(id => $(id).addEventListener("input", () => checkGoal($(id))));
    syncProfileUI();
    Object.values(PF).forEach(id => checkGoal($(id))); // creates each field's (empty) message line
    // Goals not set yet: a dot on the Goals tab instead of opening the panel.
    $("tabGoalsDot").hidden = !!(savedProfile || CFG.profile);
    renderChips(); renderBrowse(); renderList(); renderPlate(); renderQuiz();
    $("learnReset").addEventListener("click", () => { learn = { asked: 0, correct: 0, streak: 0, missed: [] }; store.set("learn", learn); quizQ = null; renderQuiz(); });
    document.querySelectorAll("#tabs button").forEach((/** @type {HTMLElement} */ b) => b.addEventListener("click", () => {
      // Tapping Check while already there returns to the scan home (phones and the installed app).
      if (PAGES && b.dataset.view === "check" && view === "check" && !homeMode && (fromApp || phone())) return goHome();
      showView(b.dataset.view);
    }));
    $("glistCopy").addEventListener("click", copyList);
    $("glistClear").addEventListener("click", () => { glist = glist.filter(x => !x.done); saveList(); });
    $("glistFavs").addEventListener("click", addGoodFavorites);
    $("plateView").addEventListener("click", showPlate);
    $("plateClear").addEventListener("click", () => { plate = []; afterPlateChange(); });

    wireBackup(); wireBookmarklet();
    if (PAGES) {
      $("scanBig").addEventListener("click", startScanFromHome);
      $("cmpBig").addEventListener("click", startCompareFromHome);
      $("labelBtn").addEventListener("click", () => askLabelPhoto({}));
      $("labelFile").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f && LS) readLabelPhoto(f); });
      $("installBtn").addEventListener("click", install);
      $("installNo").addEventListener("click", () => { store.set("installDismissed", Date.now()); renderInstall(); });
      try { matchMedia("(max-width: 720px)").addEventListener("change", () => { renderAppHome(); renderInstall(); }); } catch {}
      renderAppHome(); renderInstall();
    }
    // "#scan" (the installed app's Scan shortcut): open the scanner, then tidy the address.
    const wantScan = PAGES && location.hash === "#scan";
    if (wantScan) { try { history.replaceState(null, "", location.pathname + location.search); } catch {} }
    const importing = PAGES && /^#(import|add|wm)=/.test(location.hash) ? location.hash : null;
    const startView = PAGES ? viewFromHash(location.hash) : null;
    const opened = PAGES && !startView && !importing && openFromHash(location.hash, true);
    if (!opened) pick((recents.length && byName(recents[0])) || FOODS[0], { noHash: true, noRecent: true, stay: true });
    showView(startView || "check", { history: false, scroll: false });
    if (importing) { if (/^#wm=/.test(importing)) openWalmartProduct(importing.slice(4)); else importFromHash(importing); }
    // Opened from the home screen: straight to the camera when it's already allowed (no surprise permission prompt).
    if (wantScan) openScan();
    else if (fromApp && !location.hash && !importing) (async () => { try { const st = navigator.permissions && await navigator.permissions.query({ name: "camera" }); if (st && st.state === "granted") openScan(); } catch {} })();
    if (PAGES) window.addEventListener("hashchange", () => {
      if (location.hash === "#scan") { try { history.replaceState(null, "", location.pathname + location.search); } catch {} return startScanFromHome(); }
      if (/^#wm=/.test(location.hash)) return openWalmartProduct(location.hash.slice(4));
      if (/^#(import|add)=/.test(location.hash)) return importFromHash(location.hash);
      const v = viewFromHash(location.hash);
      if (v) return showView(v, { history: false });
      showView("check", { history: false });
      if (location.hash) openFromHash(location.hash, false);
    });

    if (PAGES && "serviceWorker" in navigator && location.protocol === "https:") {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }
  init();
})();
