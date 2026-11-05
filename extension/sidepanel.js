// The side panel: the full breakdown for the product in the active tab. The content script works out the product and
// its nutrition (see content.js) and the background keeps it per tab; this page re-scores it with your saved goals, so
// a goal change shows up at once. Order: verdict, daily-limit bars, notes, ingredients, then sources and settings.
(() => {
  "use strict";
  const V = self.SelfCheckVerdict, C = self.SelfCheckCard, ADD = self.SelfCheckAdditives, ING = self.SelfCheckIngredients, B = self.SelfCheckBackup;
  const { FOODS } = self.SelfCheckData;
  const SITE = "https://quochhdo.github.io/should-i-buy-it/";
  const { el, $ } = self.SelfCheckDom; // lib/dom.js, shared with the app
  const get = keys => new Promise(r => chrome.storage.local.get(keys, v => r(v || {})));
  const set = obj => new Promise(r => chrome.storage.local.set(obj, r));
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

  // Which tab this panel follows: the active tab in its window, or a fixed one (?tab=…, when opened as a tab).
  const fixed = Number(new URLSearchParams(location.search).get("tab")) || null;
  let tabId = fixed, winId = null, data = null, profile = V.DEFAULT_PROFILE, toApp = [], openSet = new Set(["ingr"]);

  async function follow() {
    if (fixed) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    if (tab) winId = tab.windowId;
  }
  async function load() {
    const local = await get(["profile", "toApp", "panelSections"]);
    profile = { ...V.DEFAULT_PROFILE, ...(local.profile || {}) };
    toApp = Array.isArray(local.toApp) ? local.toApp : [];
    if (Array.isArray(local.panelSections)) openSet = new Set(local.panelSections);
    const k = "tab:" + tabId;
    data = tabId != null ? (await chrome.storage.session.get(k))[k] || null : null;
    render();
  }

  // ---------- states ----------
  function empty() {
    return el("div", { class: "empty" },
      el("span", { html: C.icon("fine", 36).replace('aria-hidden="true"', 'aria-hidden="true" style="opacity:.5"') }),
      el("p", { class: "big", text: "Open a Walmart, Sam's Club, Costco, Target or Kroger food product to see a verdict." }),
      el("p", { class: "small", text: "On a product page, the verdict sits next to the star rating. Click it to see the details here." }));
  }
  function render() {
    const main = $("main");
    if (!data) return main.replaceChildren(empty());
    if (data.state === "loading") return main.replaceChildren(el("p", { class: "small", role: "status", text: "Checking this product…" }));
    if (data.state === "none") return main.replaceChildren(el("section", {},
      data.product ? el("p", { class: "pname", text: data.product.name }) : null,
      el("p", { class: "headline", text: data.message }),
      el("p", { class: "small" }, "You can still ", el("a", { href: SITE, target: "_blank", rel: "noopener", text: "look it up by name in the app ↗" }), ".")),
      data.product ? photoSection(data, true) : null);
    if (data.state === "supplement") return main.replaceChildren(...supplement(data));
    main.replaceChildren(...ready(data.result, data.product || {}));
  }

  // ---------- reading a label photo ----------
  // When the page has no Nutrition Facts text (Costco, many supplements, products the barcode databases don't know),
  // the label is often one of the product photos. The person picks it (or a photo of their own), it's read on this
  // computer with Tesseract (extension/ocr/), and they check the numbers before anything is scored. Nothing is uploaded.
  const LS = self.SelfCheckLabelScan, LO = self.SelfCheckLabelOcr, SRC = self.SelfCheckSources;
  // Costco's image host doesn't serve other sites, so reading its photos needs permission (asked for on first use).
  // Target's image host (target.scene7.com) is asked for the same way.
  const NEEDS_PERMISSION = /^https:\/\/(gdx-assets\.costco\.com|target\.scene7\.com)\//;
  const big = u => /walmartimages|samsclubimages/.test(u) ? u.split("?")[0] + "?odnHeight=2000&odnWidth=2000" : /target\.scene7\.com/.test(u) ? u.split("?")[0] + "?wid=2000&hei=2000&qlt=90&fmt=pjpeg" : u;
  const thumb = u => /walmartimages|samsclubimages/.test(u) ? u.split("?")[0] + "?odnHeight=180&odnWidth=180" : /target\.scene7\.com/.test(u) ? u.split("?")[0] + "?wid=180&hei=180" : u;
  let photoBusy = false;
  function photoSection(d, open) {
    const prod = d.product || {}, imgs = (prod.images || []).filter(u => /^https:\/\//.test(u));
    const status = el("p", { class: "small", role: "status" });
    const out = el("div", { class: "photoout" });
    const supp = d.state === "supplement";
    const run = async getBlob => {
      if (photoBusy) return;
      photoBusy = true; out.replaceChildren(); status.textContent = "Getting the photo…";
      try {
        const blob = await getBlob();
        const r = await LS.read(blob, { base: chrome.runtime.getURL("ocr/"), onStep: t => { status.textContent = t; } });
        status.textContent = "";
        if (supp || r.kind === "supplement") return out.replaceChildren(suppCheck(r, d));
        out.replaceChildren(LS.form(r, { el, idPrefix: "ph", onSubmit: (values, serving) => usePhoto(d, { food: LO.toFood(SRC, prod.name, serving, values) }), onCancel: () => out.replaceChildren() }));
        const first = out.querySelector(".check input, input"); if (first) first.focus();
      } catch (e) {
        status.textContent = e && e.message && /permission/i.test(e.message) ? e.message : "Couldn't read that photo. Try another one, or a sharper photo of just the label.";
      } finally { photoBusy = false; }
    };
    const fromUrl = u => () => {
      // Chrome only shows a permission prompt right after a click, so ask before anything is awaited.
      const asked = NEEDS_PERMISSION.test(u) ? chrome.permissions.request({ origins: [new URL(u).origin + "/*"] }) : Promise.resolve(true);
      run(async () => {
        if (!(await asked)) throw new Error(`Reading ${/target/.test(u) ? "Target" : "Costco"}'s photos needs permission to load images from ${new URL(u).hostname}. You can still use a photo of your own.`);
        const res = await fetch(big(u), { credentials: "omit" });
        if (!res.ok) throw new Error("photo " + res.status);
        return res.blob();
      });
    };
    const file = el("input", { type: "file", accept: "image/*", class: "vh", id: "phfile", onchange: e => { const f = e.target.files && e.target.files[0]; if (f) run(async () => f); e.target.value = ""; } });
    const body = [
      el("p", { class: "small", text: supp ? "Pick the photo that shows the Supplement Facts. It's read on this computer; nothing is uploaded." : "Pick the photo that shows the Nutrition Facts. It's read on this computer; nothing is uploaded. You check the numbers before the verdict." }),
      imgs.length ? el("div", { class: "thumbs" }, ...imgs.map((u, i) => el("button", { type: "button", class: "thumb", "aria-label": `Read product photo ${i + 1}`, onclick: fromUrl(u) }, el("img", { src: thumb(u), alt: "", loading: "lazy", referrerpolicy: "no-referrer" })))) : null,
      el("p", { class: "small" }, file, el("label", { for: "phfile", class: "linkish", text: imgs.length ? "Or use a photo of your own" : "Use a photo of the label" }), " · first time, it loads the reader (about 7 MB, inside the extension)."),
      status, out];
    const det = disclosure("photo", supp ? "Read the Supplement Facts photo" : "Read the label photo", null, ...body);
    if (open) det.open = true;
    return det;
  }
  // Supplement Facts read from a photo: the lines it found, to check, then the supplement view.
  function suppCheck(r, d) {
    const rows = r.rows.filter(x => x && x.name);
    if (!rows.length) return el("p", { class: "small", text: "Couldn't read the Supplement Facts from this photo. Try another photo, or check the label on the package." });
    return el("div", { class: "lform" },
      el("p", { class: "lsum", text: `Read ${rows.length} line${rows.length === 1 ? "" : "s"}. Check them against the photo: OCR can drop a decimal point (3.2 g read as 32 g).` }),
      el("ul", { class: "alist" }, ...rows.map(x => el("li", {}, el("div", { class: "arow" }, el("span", { class: "an", text: x.name }), el("span", { class: "ar", text: x.amount }))))),
      el("div", { class: "lbtns" }, el("button", { type: "button", class: "primary", text: "Use these", onclick: () => usePhoto(d, { rows, serving: r.serving }) })));
  }
  // Shows the result here at once, and tells the page so its badge matches.
  function usePhoto(d, photo) {
    const prod = d.product || {};
    if (photo.food) data = { ...d, state: "ready", result: { food: photo.food, source: "photo", detail: "The Nutrition Facts photo you checked, read in your browser", note: "Read from a photo and checked by you, so it's as good as those numbers." } };
    else { const SUP = self.SelfCheckSupplement; data = { ...d, state: "supplement", supplement: { ...SUP.analyze({ name: prod.name, rows: photo.rows, ingredients: prod.ingredients, serving: photo.serving || "" }), fromPhoto: true }, detail: "The Supplement Facts photo you picked, read in your browser" }; }
    render();
    try { if (tabId != null && prod.url) chrome.tabs.sendMessage(tabId, { type: "photo", url: prod.url, ...photo }, () => void chrome.runtime.lastError); } catch {}
  }

  // ---------- supplements: their own view, not a food verdict ----------
  function supplement(d) {
    const S = d.supplement, prod = d.product || {}, SUP = self.SelfCheckSupplement;
    const tier = d.skip ? "skip" : "supp";
    const head = el("section", { class: "verdict " + tier, "aria-label": "Verdict" },
      el("div", { class: "vrow" }, el("span", { html: C.icon(tier, 30) }), el("span", { class: "vword", text: d.skip ? "Skip" : "Supplement" })),
      el("p", { class: "headline", text: d.skip ? d.skip.why : "Not scored like food. Here's what a serving holds." }),
      el("p", { class: "pname", text: prod.name || "" }));
    // Per serving: caffeine against the FDA's 400 mg a day, then sodium, sugar and calories when known.
    const rows = [];
    if (S.caffeine && S.caffeine.mg != null) {
      const share = S.caffeine.share, tip = `Caffeine: ${S.caffeine.mg} mg, ${Math.round(share * 100)}% of the 400 mg a day the FDA cites for healthy adults.`;
      rows.push(el("div", { class: "bar", tabindex: "0", role: "group", title: tip, "aria-label": tip }, el("span", { text: "Caffeine" }),
        el("div", { class: "track", "aria-hidden": "true" }, el("span", { class: "zone warn", style: "left:50%;right:0" }), el("span", { class: "fill", style: `width:${(Math.min(1, share) * 100).toFixed(1)}%` })),
        el("span", { class: "val" }, el("b", { text: `${S.caffeine.mg} mg` }), ` · ${Math.round(share * 100)}%`)));
    }
    const line = (label, value, tip) => el("div", { class: "bar", tabindex: "0", role: "group", title: tip, "aria-label": tip }, el("span", { text: label }), el("span", {}), el("span", { class: "val" }, el("b", { text: value })));
    if (S.sodium != null) rows.push(line("Sodium", `${Math.round(S.sodium)} mg · ${Math.round(S.sodium / profile.na * 100)}%`, `Sodium: ${Math.round(S.sodium)} mg, ${Math.round(S.sodium / profile.na * 100)}% of your daily limit.`));
    if (S.added != null) rows.push(line("Added sugar", `${V.fmt(S.added)} g`, `Added sugar: ${V.fmt(S.added)} g.`));
    else if (S.sugar != null) rows.push(line("Sugar", `${V.fmt(S.sugar)} g`, `Sugar: ${V.fmt(S.sugar)} g.`));
    if (S.calories != null) rows.push(line("Calories", String(Math.round(S.calories)), `Calories: ${Math.round(S.calories)}.`));
    const per = rows.length ? el("section", { "aria-labelledby": "hPer" }, el("h2", { id: "hPer", text: `Per serving${S.serving ? ` · ${S.serving}` : ""}` }), el("div", { class: "bars" }, ...rows),
      el("p", { class: "small", text: S.fromPhoto ? "Read from a photo of the Supplement Facts. Check the amounts against the label; a line the photo didn't show counts as 0." : S.fromLabel ? "A Supplement Facts label leaves out nutrients that round to zero, so those show as 0." : S.caffeine && S.caffeine.from === "name" ? "This page has the Supplement Facts only as a photo, so the caffeine amount comes from the product's name. Check the label." : "This page has the Supplement Facts only as a photo; check the label for amounts." }))
      : el("section", {}, el("p", { class: "small", text: "This page has the Supplement Facts only as a photo; check the label for amounts." }));
    // Notes.
    const notes = SUP.notes(S).map(n => {
      const full = el("p", { class: "full", hidden: true }, n.full, n.src ? " " : null, n.src ? el("a", { href: n.src, target: "_blank", rel: "noopener", text: "Source" }) : null);
      const more = el("button", { class: "more", type: "button", "aria-expanded": "false", text: "more",
        onclick: e => { const open = full.hidden; full.hidden = !open; e.target.setAttribute("aria-expanded", String(open)); e.target.textContent = open ? "less" : "more"; } });
      return el("li", { class: n.k }, el("span", { class: "nic", "aria-hidden": "true", text: n.k === "warn" ? "!" : "i" }), el("span", {}, n.short, more), full);
    });
    // What's in it, as the label lists it.
    const actives = S.actives.length ? el("section", { "aria-labelledby": "hAct" }, el("h2", { id: "hAct", text: "What's in a serving, as listed" }),
      el("ul", { class: "alist" }, ...S.actives.map(x => el("li", {}, el("div", { class: "arow" }, el("span", { class: "an", text: x.name }), el("span", { class: "ar", text: [x.amount, x.dvp && x.dvp !== "**" ? `${x.dvp} DV` : ""].filter(Boolean).join(" · ") })))))) : null;
    return [head, per, !S.fromLabel && !S.fromPhoto ? photoSection(d, false) : null, el("section", { "aria-labelledby": "hWhy" }, el("h2", { id: "hWhy", text: "Good to know" }), el("ul", { class: "notes" }, ...notes)),
      actives, S.ingredients ? ingredients(S.ingredients) : null,
      el("section", { class: "foot" }, el("p", {}, el("b", { text: "Source: " }), `${d.detail}.`),
        el("div", { class: "links" }, el("button", { class: "btn", type: "button", text: "Change your goals", onclick: () => chrome.runtime.openOptionsPage() })))].filter(Boolean);
  }

  // ---------- the breakdown ----------
  function ready(r, prod) {
    const f = r.food, a = V.assess(f, profile);
    // The page's own ingredient list counts for allergens even when the numbers came from elsewhere.
    if (prod.ingredients && !f.ingredients) a.allergy = V.assess({ ...f, ingredients: prod.ingredients }, profile).allergy;
    const ingr = ING ? ING.analyze(prod.ingredients || f.ingredients, [prod.name, f.n].filter(Boolean).join(" | ")) : null;
    const adds = ADD && ADD.analyze(f);
    const offerPhoto = r.source !== "this page" && r.source !== "photo" && !r.typical && (prod.images || []).length;
    return [verdict(f, a, prod), bars(f), facts(f, r, prod), notes(f, a, adds), swap(f, a), ingr ? ingredients(ingr) : null, offerPhoto ? photoSection(data, false) : null, foot(r, prod, f)].filter(Boolean);
  }

  function verdict(f, a, prod) {
    const missing = C.uncertain(f, profile);
    return el("section", { class: "verdict " + a.tier, "aria-label": "Verdict" },
      el("div", { class: "vrow" }, el("span", { html: C.icon(a.tier, 30) }), el("span", { class: "vword", text: a.word })),
      el("p", { class: "headline", text: C.headline(f, profile, a) }),
      el("p", { class: "pname", text: prod.name || f.n }),
      allergyBox(a),
      // Only something that changes how far to trust the verdict itself gets a banner.
      missing ? el("p", { class: "banner", role: "note" }, el("b", { text: "⚠ " }), "Some nutrients that decide the verdict aren't listed, so it's less certain.") : null);
  }

  // Your allergens, above everything else. Never "safe": at best, none found in what was checked.
  function allergyBox(a) {
    const al = a.allergy;
    if (!al) return null;
    const lead = { contains: "⚠ ", may: "⚠ ", unknown: "? ", clear: "✓ " }[al.status];
    return el("div", { class: "alflag " + al.status, role: al.status === "contains" ? "alert" : "note" },
      el("p", { class: "alt" }, el("b", { text: lead + al.title })), el("p", { text: al.text }),
      el("p", { class: "alnote", text: "Always read the package." }));
  }

  function bars(f) {
    const list = C.limitBars(f, profile);
    if (!list.length) return null;
    const rows = list.map(b => {
      const [t1, t2] = b.marks, [s1, s2] = b.markShares || [];
      const tip = b.known
        ? `${b.name}: ${b.value} of your daily limit. One serving counts against the verdict from ${Math.round(s1 * 100)}% and counts double from ${Math.round(s2 * 100)}%.`
        : `${b.name}: not listed for this product.`;
      return el("div", { class: "bar", tabindex: "0", role: "group", title: tip, "aria-label": tip },
        el("span", { text: b.name }),
        el("div", { class: "track" + (b.known ? "" : " na"), "aria-hidden": "true" },
          t1 != null ? el("span", { class: "zone warn", style: `left:${(t1 * 100).toFixed(1)}%;right:${t2 != null ? ((1 - t2) * 100).toFixed(1) : 0}%` }) : null,
          t2 != null ? el("span", { class: "zone bad", style: `left:${(t2 * 100).toFixed(1)}%;right:0` }) : null,
          b.known ? el("span", { class: "fill", style: `width:${(b.fill * 100).toFixed(1)}%` }) : null),
        el("span", { class: "val" }, b.known ? el("b", { text: b.value.split(" · ")[0] }) : "not listed", b.known ? ` · ${b.value.split(" · ")[1]}` : null));
    });
    return el("section", { "aria-labelledby": "hLimits" }, el("h2", { id: "hLimits", text: "Your daily limits, one serving" }),
      el("div", { class: "bars" }, ...rows),
      el("div", { class: "zkey", "aria-hidden": "true" }, el("span", {}, el("i", { class: "k0" }), "fine"), el("span", {}, el("i", { class: "k1" }), "counts against"), el("span", {}, el("i", { class: "k2" }), "counts double")));
  }

  function facts(f, r, prod) {
    const itemName = r.typical ? f.n : prod.name || f.n;
    const onList = toApp.some(x => x.n === itemName);
    const listBtn = el("button", { class: "btn" + (onList ? " on" : ""), type: "button", "aria-pressed": onList ? "true" : "false", text: onList ? "✓ On your list" : "+ Add to list",
      onclick: async () => { toApp = onList ? toApp.filter(x => x.n !== itemName) : [...toApp, { n: itemName, qty: 1, food: r.typical ? null : { ...f, n: itemName } }]; await set({ toApp }); } });
    const send = toApp.length ? el("a", { class: "btn primary", href: SITE, target: "_blank", rel: "noopener", text: `Send ${toApp.length} to your list in the app ↗`,
      onclick: () => setTimeout(() => set({ toApp: [] }), 300) }) : null;
    if (send) B.encode(B.packAdd(toApp)).then(t => { send.href = SITE + "#add=" + t; });
    const sp = f.storePrice, per = sp && sp.perServing ? C.perDollar(f, sp.perServing) : null;
    return el("section", { "aria-label": "Serving and price" },
      el("div", { class: "facts" }, el("span", { text: `${V.isMissing(f, "cal") ? "—" : Math.round(f.cal)} cal · ${V.isMissing(f, "pro") ? "—" : V.fmt(f.pro) + " g"} protein · per ${f.s}` }), listBtn),
      sp && sp.perServing ? el("p", { class: "price" }, el("b", { text: `≈ ${C.money(sp.perServing)} a serving` }), ` at the ${sp.store || "store"} price${sp.unitText ? ` (${sp.unitText})` : ""}`, per ? ` · ${per}` : null) : null,
      send);
  }

  const NIC = { pos: "+", neg: "−", warn: "!", note: "i" };
  function notes(f, a, adds) {
    const head = C.headline(f, profile, a);
    // Flagged additives the verdict already explains aren't repeated.
    const flagged = ((adds && adds.flagged) || []).filter(x => !a.reasons.some(r => r.t.toLowerCase().includes(x.name.toLowerCase())))
      .map(x => ({ k: "warn", t: `${x.name}${x.code ? ` (${x.code})` : ""}: ${x.flag.t}` }));
    const list = [...a.reasons, ...flagged].filter(r => r.t !== head);
    if (!list.length) return null;
    const items = list.map(r => {
      const n = C.shortNote(r, f, profile);
      const full = el("p", { class: "full", hidden: true, text: n.full });
      const more = n.more ? el("button", { class: "more", type: "button", "aria-expanded": "false", text: "more",
        onclick: e => { const open = full.hidden; full.hidden = !open; e.target.setAttribute("aria-expanded", String(open)); e.target.textContent = open ? "less" : "more"; } }) : null;
      return el("li", { class: r.k }, el("span", { class: "nic", "aria-hidden": "true", text: NIC[r.k] || "i" }), el("span", {}, n.short, more), more ? full : null);
    });
    return el("section", { "aria-labelledby": "hWhy" }, el("h2", { id: "hWhy", text: "Why" }), el("ul", { class: "notes" }, ...items));
  }

  // "Search Walmart →" or "Search Sam's Club →", for the store the product came from.
  const storeLink = q => { const st = (data && data.product && data.product.store) || { id: "walmart", name: "Walmart" };
    return el("a", { href: self.SelfCheckWalmart ? self.SelfCheckWalmart.storeSearch(q, st.id) : C.walmartSearch(q), target: "_blank", rel: "noopener", "aria-label": `Search ${st.name} for ${q}`, text: `Search ${st.name} →` }); };
  function swap(f, a) {
    if (a.tier === "good" || a.tier === "fine") return null;
    const sw = C.swap(f, FOODS, profile);
    if (!sw) return null;
    return el("section", { class: "swap", "aria-label": sw.lighter ? "A lighter version" : "Try instead" },
      el("h2", { text: sw.lighter ? "A lighter version" : "Try instead" }),
      el("div", { class: "row" }, el("b", { text: sw.food.n }),
        sw.lighter ? null : el("span", { class: "vp " + sw.verdict.tier }, el("span", { html: C.icon(sw.verdict.tier, 14) }), sw.verdict.word),
        storeLink(sw.query)),
      sw.lighter ? el("p", { class: "small", text: `${cap(sw.lighter)}. Same verdict, but it goes further on your limits.` }) : null);
  }

  // A disclosure that reopens as you left it.
  const disclosure = (k, title, summaryExtra, ...kids) => el("details", { class: "disc", open: openSet.has(k) ? true : null,
    ontoggle: e => { if (e.target.open) openSet.add(k); else openSet.delete(k); set({ panelSections: [...openSet] }); } },
    el("summary", {}, el("h2", { text: title }), summaryExtra ? el("span", { class: "small", text: ` · ${summaryExtra}` }) : null), ...kids);

  function ingredients(r) {
    const groups = r.groups.map(g => {
      const conflicts = g.items.filter(i => i.conflict);
      const body = g.key === "additive"
        ? el("ul", { class: "alist" }, ...g.items.map(i => el("li", {},
            el("div", { class: "arow" }, el("span", { class: "an" }, i.name, i.inside ? el("span", { class: "in", text: ` in ${i.inside.toLowerCase()}` }) : null, i.conflict ? el("span", { class: "cw", title: i.conflict, text: " ⚠" }) : null),
              i.additive.statusLabel ? el("span", { class: "ast " + i.additive.status, text: i.additive.statusLabel }) : null),
            i.additive.role || i.additive.what ? el("span", { class: "ar", text: i.additive.role || i.additive.what }) : null,
            ["mixed", "removed"].includes(i.additive.status) && i.additive.note ? el("span", { class: "ar" }, i.additive.note, i.additive.src ? " " : null,
              i.additive.src ? el("a", { href: i.additive.src, target: "_blank", rel: "noopener", text: "Source" }) : null) : null)))
        : el("div", { class: "chips" }, ...g.items.map(i => el("span", { class: "ich" + (i.pos ? "" : " nopos") + (i.conflict ? " conflict" : ""),
            title: [i.pos ? `${ordinal(i.pos)} ingredient${i.minor ? " (2% or less)" : ""}` : i.inside ? `Part of ${i.inside}` : "", i.conflict].filter(Boolean).join(". ") },
            i.pos ? el("span", { class: "pos", text: String(i.pos) }) : null, i.name, i.inside ? el("span", { class: "in", text: ` in ${i.inside.toLowerCase()}` }) : null,
            i.conflict ? el("span", { class: "cw", "aria-label": "conflicts with the product name", text: "⚠" }) : null)));
      return el("div", { class: "ig " + g.tone },
        el("div", { class: "igh" }, el("span", { class: "gdot", "aria-hidden": "true" }), g.label, el("span", { class: "n", text: String(g.items.length) })),
        g.note || g.detail ? el("p", { class: "ign", text: [g.detail, g.note].filter(Boolean).join(" ") }) : null,
        body,
        ...conflicts.map(i => el("p", { class: "cnote" }, el("span", { class: "cw", "aria-hidden": "true", text: "⚠ " }), `${i.name}: ${i.conflict}`)));
    });
    return el("section", {},
      r.contains ? el("p", { class: "allergen" }, el("b", { text: "Label says: " }), `Contains ${r.contains}.`) : null,
      disclosure("ingr", "Ingredients", r.summary,
        el("p", { class: "small", text: "Numbers are each ingredient's place on the label, most to least by weight." }),
        ...groups,
        r.may.length ? el("p", { class: "small", text: r.may.join(" ") }) : null));
  }

  function foot(r, prod, f) {
    const listedAs = !r.typical && f.n && prod.name && !String(prod.name).toLowerCase().includes(String(f.n).toLowerCase()) && r.source !== "this page" ? ` It's listed there as “${f.n}”.` : "";
    return el("section", { class: "foot" },
      el("p", {}, el("b", { text: "Source: " }), `${r.detail}.${listedAs}${r.note ? " " + r.note : ""}`),
      f.issues && f.issues.length ? el("p", { class: "banner", role: "note", title: f.issues.join("; ") }, self.SelfCheckSources.issueSummary(f)) : null,
      disclosure("about", "About this verdict", null,
        el("p", { text: "It doesn't check allergens: read the label if you have a food allergy." }),
        el("p", { text: `Scored against your goals: ${profile.cal.toLocaleString("en-US")} cal, ${profile.pro} g protein, ≤${profile.sat} g saturated fat, ≤${profile.na.toLocaleString("en-US")} mg sodium, ≤${profile.add} g added sugar.` }),
        el("p", { text: "General nutrition guidance, not medical advice." })),
      el("div", { class: "links" },
        el("button", { class: "btn", type: "button", text: "Change your goals", onclick: () => chrome.runtime.openOptionsPage() }),
        r.link ? el("a", { href: SITE + r.link, target: "_blank", rel: "noopener", text: "Open in the app ↗" }) : null,
        el("a", { href: reportUrl(f, prod, r), target: "_blank", rel: "noopener", title: "Opens a prefilled report on GitHub (needs a free account). Nothing is sent until you submit it.", text: "Wrong verdict? Report it ↗" })));
  }
  // A problem report on GitHub, prefilled with what's needed to check it: the product, its page and barcode, where the
  // numbers came from, and the verdict. Nothing about you: no goals, no history. It's only sent if you submit it there.
  const REPORT = "https://github.com/QuocHHDo/should-i-buy-it/issues/new";
  function reportUrl(f, prod, r) {
    const a = V.assess(f, V.DEFAULT_PROFILE), code = f.code || f.gtin || "";
    const body = [`Product: ${prod.name || f.n}`, prod.store ? `Store: ${prod.store.name}` : "", prod.url ? `Page: ${String(prod.url).split("?")[0]}` : "", code ? `Barcode: ${code}` : "",
      `Numbers from: ${r.detail}`, `Serving: ${f.s}`, `Verdict (standard goals): ${a.word}`, f.issues && f.issues.length ? `Flagged: ${f.issues.join("; ")}` : "",
    ].filter(Boolean).concat(["", "What the package label says (a photo helps):", "", "What you expected:", ""]).join("\n");
    return REPORT + "?" + new URLSearchParams({ title: `Wrong verdict or number: ${prod.name || f.n}`.slice(0, 120), body });
  }

  // ---------- staying current ----------
  $("gear").addEventListener("click", () => chrome.runtime.openOptionsPage());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && tabId != null && changes["tab:" + tabId]) { data = changes["tab:" + tabId].newValue || null; render(); }
    if (area === "local" && (changes.profile || changes.toApp)) load();
  });
  if (!fixed) {
    chrome.tabs.onActivated.addListener(info => { if (winId == null || info.windowId === winId) { tabId = info.tabId; winId = info.windowId; load(); } });
    chrome.windows.onFocusChanged.addListener(() => follow().then(load), { windowTypes: ["normal"] });
  }
  follow().then(load);
})();
