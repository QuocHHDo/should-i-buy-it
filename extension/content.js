// Shows a "Should I Buy It?" verdict on Walmart, Sam's Club and Costco product pages (Sam's Club runs on Walmart's
// platform; Costco has its own reader, js/costco.js): a small badge next to the star rating, and the full
// breakdown in the browser's side panel (sidepanel.html), opened by clicking the badge. Nutrition comes from, in order:
// the page's own Nutrition Facts panel; for fresh produce, a name match to the app's built-in foods; otherwise the
// product's barcode in Open Food Facts, then USDA Branded Foods. The verdict is the site's own (lib/verdict.js).
(() => {
  "use strict";
  const V = self.SelfCheckVerdict, S = self.SelfCheckSources, W = self.SelfCheckWalmart, C = self.SelfCheckCard;
  const { FOODS } = self.SelfCheckData;
  const STORE = W.storeOf(location.hostname); // { id, name, search }
  // How to read this store's pages. Costco's pages have no Nutrition Facts text; its reader finds the barcode instead.
  const CO = self.SelfCheckCostco;
  const READ = STORE.id === "costco"
    ? { productId: CO.productId, product: src => CO.product(src), plan: CO.plan }
    : { productId: W.productId, product: src => W.product(W.nextData(src)), plan: W.plan };
  const firstUrl = location.href; // the embedded page data belongs to this URL; later (client-side) pages are fetched
  let lastUrl = null, run = 0;

  const store = keys => new Promise(r => { try { chrome.storage.local.get(keys, v => r(v || {})); } catch { r({}); } });
  const save = obj => { try { chrome.storage.local.set(obj); } catch {} };
  const bg = url => new Promise(r => { try { chrome.runtime.sendMessage({ type: "fetch", url }, res => r(res || { ok: false, status: 0 })); } catch { r({ ok: false, status: 0 }); } });
  // Hands the product to the side panel (through the background script, kept per tab for this browser session).
  const publish = data => { try { chrome.runtime.sendMessage({ type: "product", data }, () => void chrome.runtime.lastError); } catch {} };
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const c of kids) if (c != null && c !== false) e.append(c);
    return e;
  };
  // Shared color tokens (the side panel defines the same names). Verdict colors pass WCAG AA as text on white.
  const VARS = "--ink:#161813;--muted:#5b6157;--line:#dcdfd6;--accent:#2c6a3d;--v-good:#2b7742;--v-fine:#6b7268;--v-mid:#d39a2c;--v-bad:#b23a2f;" +
    "--v-good-ink:#2b7742;--v-fine-ink:#4f554c;--v-mid-ink:#8a5a0f;--v-bad-ink:#b23a2f;";

  // ---------- data ----------
  async function pageProduct(url) {
    if (url === firstUrl) { const p = READ.product(document); if (p) return p; }
    const res = await fetch(url, { credentials: "include" });
    const html = await res.text();
    // The store asked to check for a robot (it can, after many page loads in a row): say so instead of "can't read".
    if (/are-you-human|not a robot/i.test(res.url + html.slice(0, 4000))) throw Object.assign(new Error("challenge"), { challenge: true });
    return READ.product(html);
  }
  // Barcode lookups are cached in this browser: found for 30 days, not found for a day (in case a record gets added).
  const DAY = 864e5, KEEP = 300;
  async function cached(code) {
    const { lookupCache = {} } = await store(["lookupCache"]);
    const hit = lookupCache[code];
    return hit && Date.now() - hit.t < (hit.r ? 30 : 1) * DAY ? hit : null;
  }
  async function remember(code, r) {
    const { lookupCache = {} } = await store(["lookupCache"]);
    lookupCache[code] = { t: Date.now(), r };
    const keys = Object.keys(lookupCache);
    if (keys.length > KEEP) keys.sort((a, b) => lookupCache[a].t - lookupCache[b].t).slice(0, keys.length - KEEP).forEach(k => delete lookupCache[k]);
    save({ lookupCache });
  }
  async function byBarcodeCached(code, key) {
    const hit = await cached(code);
    if (hit) return hit.r;
    const r = await byBarcode(code, key);
    if (!(r && r.failed)) await remember(code, r); // a network failure isn't "not found"
    return r;
  }
  async function byBarcode(code, key) {
    const off = await bg(S.offProductUrl(code));
    let failed = !off.ok && (off.status === 0 || off.status >= 500);
    if (off.ok && off.json && off.json.status === 1 && off.json.product) {
      const f = S.fromOff(code, off.json.product);
      if (!["cal", "fat", "carb", "pro"].every(k => V.isMissing(f, k))) {
        // Numbers in it look wrong: ask USDA (the brand's own filing) for a second opinion.
        if (S.trouble(f)) {
          for (const q of S.usdaUpcQueries(code)) {
            const u = await bg(S.usdaUpcUrl(q, key));
            if (!u.ok) break;
            const hit = S.matchUpc(u.json && u.json.foods, code);
            if (hit) { const g = S.secondOpinion(f, S.fromUsda(hit)); if (g !== f) return { food: g, source: "USDA", detail: `USDA Branded Foods' record for barcode ${code}`, note: "Open Food Facts' record had numbers that look wrong, so this uses the brand's own label data.", link: g.fdcId ? `#usda-${g.fdcId}` : null }; break; }
          }
        }
        return { food: f, source: "Open Food Facts", detail: `Open Food Facts' record for barcode ${code}`, note: "Crowd-sourced, so check the label on the package.", link: `#off-${code}` };
      }
    }
    for (const q of S.usdaUpcQueries(code)) {
      const u = await bg(S.usdaUpcUrl(q, key));
      if (!u.ok) { failed = failed || u.status === 0 || u.status === 429 || u.status >= 500; break; }
      const hit = S.matchUpc(u.json && u.json.foods, code);
      if (hit) { const f = S.fromUsda(hit); return { food: f, source: "USDA", detail: `USDA Branded Foods' record for barcode ${code}`, note: "The brand's own label data.", link: f.fdcId ? `#usda-${f.fdcId}` : null }; }
    }
    return failed ? { failed: true } : null;
  }
  // Label photos read in the side panel, per product page, for as long as this page stays open.
  const photos = new Map();
  function fromPhoto(photo, prod, profile) {
    if (photo.food && typeof photo.food === "object") return { food: photo.food, source: "photo", detail: "The Nutrition Facts photo you checked, read in your browser", note: "Read from a photo and checked by you, so it's as good as those numbers." };
    if (Array.isArray(photo.rows)) {
      const SUP = self.SelfCheckSupplement;
      const supp = { ...SUP.analyze({ name: prod.name, rows: photo.rows.slice(0, 60), ingredients: prod.ingredients, serving: String(photo.serving || "") }), fromPhoto: true };
      return { supplement: supp, skip: null, source: "photo", detail: "The Supplement Facts photo you picked, read in your browser" };
    }
    return null;
  }
  try {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (!msg || msg.type !== "photo" || sender.id !== chrome.runtime.id || typeof msg.url !== "string") return;
      photos.set(msg.url, { food: msg.food, rows: msg.rows, serving: msg.serving });
      if (msg.url === location.href) { lastUrl = null; check(); }
      reply({ ok: true });
    });
  } catch {}

  async function resolve(p, profile) {
    const plan = READ.plan(p);
    // Supplements aren't scored like food: their own view, from the page's label lines, name and ingredients.
    if (plan.kind === "supplement") {
      const SUP = self.SelfCheckSupplement;
      const supp = SUP.analyze({ name: p.name, rows: plan.rows, ingredients: p.ingredients, serving: plan.serving });
      // The skip list still applies ("pre-workout", "sucralose").
      const stub = { n: p.name, a: [], c: "lookup", src: "walmart", s: plan.serving || "1 serving", ingredients: p.ingredients || undefined, missing: [], cal: 0, fat: 0, sat: 0, trans: 0, chol: 0, na: 0, carb: 0, fib: 0, sug: 0, add: 0, pro: 0 };
      const a = V.assess(stub, profile);
      return { supplement: supp, skip: a.tier === "skip" ? a : null, source: "this page",
        detail: plan.rows.length ? `The Supplement Facts on this ${STORE.name} page` : `This ${STORE.name} page's name and ingredients (its Supplement Facts are only in the label photos)` };
    }
    if (plan.kind === "panel") return { food: plan.food, source: "this page", detail: `The Nutrition Facts on this ${STORE.name} page`, note: "" };
    if (plan.kind === "name") {
      const f = W.byName(plan.query, FOODS);
      if (f) return { food: f, source: `typical ${f.n.toLowerCase()}`, detail: `Typical values for “${f.n}” from the app`, note: "Fresh foods have no label here, so this uses the app's typical values.", link: "#" + V.slug(f.n), typical: true };
      if (plan.fallback) { const r = await byBarcodeCached(plan.fallback, profile.usdaKey); if (r && !r.failed) return r; }
      return { none: "No nutrition facts on this page, and it doesn't match a food the app knows." };
    }
    if (plan.kind === "barcode") {
      const r = await byBarcodeCached(plan.code, profile.usdaKey);
      if (r && r.failed) return { none: "Couldn't reach Open Food Facts or USDA just now. Reload the page to try again." };
      return r || { none: "No nutrition facts on this page, and Open Food Facts and USDA don't have its barcode." };
    }
    return null; // not a food: no card
  }

  // ---------- the badge next to the star rating ----------
  // In Walmart's rating row (a wrapping flex row under the title), taking only the space left on that line, so it never
  // wraps, pushes the page down, or touches the price, pack sizes or the buy box. Without that row it falls back to a
  // small pill at the bottom left that moves out of the way of Add to cart, Buy now and checkout.
  const HOST_ID = "should-i-buy-it-badge";
  const BADGE_STYLE = `:host { all: initial; } * { box-sizing: border-box; }
  .bd { ${VARS} all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0;
    height: 24px; padding: 0 10px 0 3px; border-radius: 999px; background: #fff; border: 1px solid var(--line); color: var(--ink);
    font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; white-space: nowrap; }
  .bd:hover { border-color: var(--accent); } .bd:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .mark { display: inline-grid; flex: none; } .ic { display: inline-grid; flex: none; }
  .w { font-weight: 800; flex: none; } .good .w { color: var(--v-good-ink); } .fine .w { color: var(--v-fine-ink); } .supp .w { color: var(--accent); } .mid .w { color: var(--v-mid-ink); } .bad .w, .skip .w { color: var(--v-bad-ink); }
  .sep { color: var(--muted); flex: none; } .r { color: var(--muted); font-weight: 500; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .warn { color: var(--v-mid-ink); font-weight: 800; flex: none; } .wait .r { font-style: italic; }
  .pill { position: fixed; left: 16px; bottom: 24px; z-index: 2147483000; box-shadow: 0 6px 18px rgba(0,0,0,.18); height: 34px; padding: 0 12px 0 6px; max-width: min(360px, calc(100vw - 32px)); }`;
  // The app's mark, so the badge reads as the extension's and not as part of Walmart's page.
  const MARK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#2c6a3d"/><rect x="4" y="7" width="16" height="11" rx="2.5" fill="#fff"/><circle cx="7.4" cy="12.5" r="1.3" fill="#2c6a3d"/><path d="M10.5 12.6l2.2 2.2 4.3-4.6" fill="none" stroke="#2c6a3d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let badgeState = null; // what the badge shows now: { tier, word, reason, warn, label }
  const anchor = () => STORE.id === "costco" ? document.getElementById("CostcoBVReviewContainer") : document.querySelector('[data-testid="reviews-and-ratings"]');
  function hostEl() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = el("span", { id: HOST_ID });
    host.attachShadow({ mode: "open" }).append(el("style", { text: BADGE_STYLE }));
    return host;
  }
  function removeBadge() { const h = document.getElementById(HOST_ID); if (h) h.remove(); badgeState = null; }
  // Puts the host in the rating row (or floating), at most once, and renders the current state into it.
  // Costco's review widget fills in after load: redraw only when the rating block's content changes size.
  let lastSig = "";
  const costcoSig = row => { const r = row.getBoundingClientRect(), f = row.firstElementChild && row.firstElementChild.id !== HOST_ID ? row.firstElementChild.getBoundingClientRect() : null;
    return [r.width, r.height, row.childElementCount, f ? Math.round(f.right) : 0].join(); };
  function drawBadge() {
    if (!badgeState) return;
    const host = hostEl(), row = anchor();
    let floating = true;
    if (row && STORE.id === "costco") {
      // Costco's rating sits in its own full-width block, so the badge floats in the empty space right of the stars
      // (absolutely positioned: nothing on the page moves). The review widget fills in after load; this re-measures.
      if (host.parentElement !== row) row.append(host);
      if (getComputedStyle(row).position === "static") row.style.position = "relative";
      const rr = row.getBoundingClientRect();
      let right = rr.left;
      for (const e of row.querySelectorAll("*")) { if (e === host) continue; const q = e.getBoundingClientRect(); if (q.width > 0 && q.height > 0 && q.width < rr.width - 5) right = Math.max(right, q.right); }
      const left = Math.round(right - rr.left + 12), room = Math.round(rr.right - right - 12);
      lastSig = costcoSig(row);
      // !important inline: the review widget's own reset (`[data-bv-show] div { position: static !important }`) would
      // otherwise put the badge on a new line under the stars (checked on costco.com).
      host.removeAttribute("style");
      for (const [k, v] of Object.entries({ position: "absolute", left: left + "px", top: "50%", height: "0px", width: Math.max(0, room) + "px", display: "flex", "align-items": "center", overflow: "visible", margin: "0", padding: "0" }))
        host.style.setProperty(k, v, "important");
      floating = room < 140 || rr.height === 0;
    } else if (row) {
      if (host.parentElement !== row) row.append(host);
      // Only what's left on the rating line: flex-basis 0 can't force a wrap. Too little room → float instead.
      // A zero-height slot centered on the stars' line: the row keeps its exact height (checked on live pages, where
      // the stars widget is taller than its line), and the button overflows evenly into space that's already there.
      const stars = row.firstElementChild && row.firstElementChild !== host ? row.firstElementChild.getBoundingClientRect() : null;
      const mid = stars ? Math.max(0, Math.round((stars.top + stars.bottom) / 2 - row.getBoundingClientRect().top)) : 8;
      Object.assign(host.style, { display: "inline-flex", flex: "1 1 0", minWidth: "0", marginLeft: "12px", alignItems: "center", height: "0px", overflow: "visible", alignSelf: "flex-start", marginTop: mid + "px" });
      const room = host.getBoundingClientRect().width;
      floating = room < 140; // not even the icon and the verdict word fit on the line
    }
    if (floating) {
      if (host.parentElement !== document.documentElement) document.documentElement.append(host);
      host.removeAttribute("style");
      if (row && STORE.id === "costco" && row.style.position === "relative") row.style.position = "";
    }
    const root = host.shadowRoot;
    [...root.children].forEach(c => { if (c.tagName !== "STYLE") c.remove(); });
    const b = badgeState;
    const ic = el("span", { class: "ic" }); if (b.tier) ic.innerHTML = C.icon(b.tier, 18);
    const mk = el("span", { class: "mark" }); mk.innerHTML = MARK;
    const btn = el("button", { class: `bd ${b.tier || "wait"}${floating ? " pill" : ""}`, type: "button", title: b.label + (b.warn ? `\n⚠ ${b.warn}` : "") + "\nClick for the full breakdown",
      "aria-label": `Should I Buy It? ${b.label}.${b.warn ? ` Warning: ${b.warn}` : ""} Open the full breakdown in the side panel.`,
      onclick: openPanel },
      floating ? mk : null, b.tier ? ic : null, b.word ? el("span", { class: "w", text: b.word }) : null, b.word ? el("span", { class: "sep", text: "·" }) : null,
      el("span", { class: "r", text: b.reason }), b.warn ? el("span", { class: "warn", text: "⚠", "aria-hidden": "true" }) : null);
    root.append(btn);
    // A reason cut to a few characters reads worse than none: show just the verdict (the tooltip and panel have the rest).
    const rs = btn.querySelector(".r");
    if (rs && rs.scrollWidth > rs.clientWidth && rs.clientWidth < 80) { rs.remove(); const sp = btn.querySelector(".sep"); if (sp) sp.remove(); }
    if (floating) placePill(btn);
  }
  // Opens the side panel. Chrome only allows that right after a click, so the message goes out synchronously.
  function openPanel() {
    try {
      if (!chrome.runtime || !chrome.runtime.id) throw new Error("stale");
      chrome.runtime.sendMessage({ type: "openPanel" }, res => {
        const err = chrome.runtime.lastError;
        if (err && /context invalidated|Receiving end does not exist/i.test(err.message || "")) stale();
      });
    } catch { stale(); }
  }
  // The extension was updated while this tab stayed open: this page's copy can't reach it any more.
  function stale() { if (badgeState) { badgeState = { ...badgeState, reason: "reload the page to open details", warn: null }; drawBadge(); } }

  // The fallback pill never covers Walmart's checkout buttons: it lifts above them or moves to the other corner.
  const BUY = /^(?:add to cart|buy now|check ?out|continue to checkout|place order|add to registry)$/i;
  let corner = "left";
  function protectedRects() {
    const rects = [];
    for (const b of document.querySelectorAll("button, a[role=button], [role=button], input[type=submit]")) {
      const t = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim();
      if (!t || t.length > 30 || !BUY.test(t)) continue;
      const r = b.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) rects.push({ left: r.left, right: r.right, top: r.top - (/add to cart|buy now/i.test(t) ? 90 : 0), bottom: r.bottom });
    }
    return rects;
  }
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  function placePill(btn) {
    const w = btn.offsetWidth, h = btn.offsetHeight, prot = protectedRects(), base = { left: 24, right: 88 };
    const rectAt = (side, bottom) => { const x = side === "left" ? 16 : innerWidth - 16 - w; return { left: x, right: x + w, top: innerHeight - bottom - h, bottom: innerHeight - bottom }; };
    const tries = [];
    for (const side of [corner, corner === "left" ? "right" : "left"]) {
      tries.push([side, base[side]]);
      for (const pr of prot) { const b = Math.ceil(innerHeight - pr.top + 12); if (b > base[side] && b + h <= innerHeight - 8) tries.push([side, b]); }
    }
    let best = null;
    for (const [side, bottom] of tries) {
      const cost = prot.reduce((n, pr) => n + overlap(rectAt(side, bottom), pr), 0);
      if (!best || cost < best.cost) best = { side, bottom, cost };
      if (cost === 0) break;
    }
    Object.assign(btn.style, { left: best.side === "left" ? "16px" : "auto", right: best.side === "right" ? "16px" : "auto", bottom: best.bottom + "px" });
    btn.dataset.side = best.side;
  }
  let pending = 0;
  const refloat = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; const host = document.getElementById(HOST_ID); const btn = host && host.shadowRoot.querySelector(".pill"); if (btn) placePill(btn); }); };
  addEventListener("scroll", refloat, { passive: true });
  addEventListener("resize", () => { refloat(); if (badgeState) drawBadge(); });
  // Walmart re-renders parts of the page as it loads and as you pick options; put the badge back if it got removed,
  // or move it into the rating row once that appears.
  let mo = null;
  function watchPage() {
    if (mo) return;
    let queued = false;
    mo = new MutationObserver(() => {
      if (queued || !badgeState) return;
      queued = true;
      setTimeout(() => { queued = false; const host = document.getElementById(HOST_ID), row = anchor();
        if (!host || !host.isConnected || (row && host.parentElement !== row) || (STORE.id === "costco" && row && costcoSig(row) !== lastSig)) drawBadge(); }, 250);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // What the badge says for a product.
  function productBadge(r, p, warn) {
    const a = V.assess(r.food, p);
    const partial = C.uncertain(r.food, p) ? "Some nutrients that decide the verdict aren't listed, so it's less certain." : null;
    const w = [warn && warn + ".", partial].filter(Boolean).join(" ") || null;
    return { tier: a.tier, word: a.word, reason: C.badgeReason(r.food, p, a), warn: w, label: `${a.word}: ${C.headline(r.food, p, a).replace(/\.$/, "")}` };
  }

  // ---------- verdict badges on search and category pages (opt-in) ----------
  // Search results don't include nutrition, so each badge means fetching that product's page. To stay gentle on
  // Walmart (and not look like a bot on your account): only products you scroll to, one request at a time about every
  // 1.5 seconds, at most 40 per page, and each result cached for 7 days.
  const BADGE_GAP = 1500, BADGE_MAX = 40, BADGE_DAYS = 7;
  let badgeQueue = [], badgeBusy = false, badgeCount = 0, badgeObserver = null, badgeMutations = null, badgeProfile = null;
  const BADGE_CSS = `:host{all:initial} .b{${VARS}display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 5px;border-radius:999px;background:#fff;
    box-shadow:0 1px 4px rgba(0,0,0,.18);font:700 11.5px system-ui,sans-serif;color:var(--ink);white-space:nowrap} .b svg{flex:none}
    .good{color:var(--v-good-ink)}.mid{color:var(--v-mid-ink)}.bad,.skip{color:var(--v-bad-ink)}.wait{color:var(--muted);font-weight:600}`;
  const SHORT = { good: "Get it", mid: "In moderation", bad: "Limit it", fine: "Fine", skip: "Skip", supp: "Supplement" };
  function tileId(tile) { const a = tile.querySelector('a[href*="/ip/"]'); return a ? W.productId(new URL(a.getAttribute("href"), location.origin).href) : null; }
  function badgeFor(tile, state) {
    let host = tile.querySelector(".sib-badge");
    if (!host) {
      // On the product photo's bottom-left corner: Walmart uses the top corners for its own flags and the heart.
      const img = tile.querySelector("img"), spot = img && img.parentElement && tile.contains(img.parentElement) ? img.parentElement : tile;
      host = el("div", { class: "sib-badge", style: `position:absolute;${spot === tile ? "top:8px" : "bottom:6px"};left:6px;z-index:5;pointer-events:none` });
      host.attachShadow({ mode: "open" }).append(el("style", { text: BADGE_CSS }), el("span", { class: "b" }));
      if (getComputedStyle(spot).position === "static") spot.style.position = "relative";
      spot.append(host);
    }
    const b = host.shadowRoot.querySelector(".b");
    b.className = "b " + (state.tier || "wait");
    b.setAttribute("role", "img");
    b.setAttribute("aria-label", state.tier ? `Should I Buy It? ${state.word}` : "Should I Buy It? checking");
    const ic = el("span", { class: "d" }); if (state.tier) ic.innerHTML = C.icon(state.tier, 14);
    b.replaceChildren(ic, document.createTextNode(state.tier ? SHORT[state.tier] || state.word : "…"));
    host.title = state.headline || "";
  }
  async function badgeVerdict(id) {
    const { badgeCache = {} } = await store(["badgeCache"]);
    const hit = badgeCache[id];
    if (hit && Date.now() - hit.t < BADGE_DAYS * DAY) return hit;
    const res = await fetch(`/ip/${id}`, { credentials: "include" });
    if (!res.ok) return null;
    const prod = W.product(W.nextData(await res.text()));
    const r = prod ? await resolve(prod, badgeProfile) : null;
    if (r && r.supplement) { badgeCache[id] = { t: Date.now(), tier: r.skip ? "skip" : "supp", word: r.skip ? "Skip" : "Supplement", headline: r.supplement.reason }; }
    else if (!r || r.none) { badgeCache[id] = { t: Date.now(), tier: null }; }
    else { const a = V.assess(r.food, badgeProfile); badgeCache[id] = { t: Date.now(), tier: a.tier, word: a.word, headline: C.headline(r.food, badgeProfile, a) }; }
    const keys = Object.keys(badgeCache);
    if (keys.length > 600) keys.sort((x, y) => badgeCache[x].t - badgeCache[y].t).slice(0, keys.length - 600).forEach(k => delete badgeCache[k]);
    save({ badgeCache });
    return badgeCache[id];
  }
  async function drainBadges() {
    if (badgeBusy) return;
    badgeBusy = true;
    while (badgeQueue.length && badgeCount < BADGE_MAX) {
      const { tile, id } = badgeQueue.shift();
      if (!tile.isConnected) continue;
      const cachedOnly = (await store(["badgeCache"])).badgeCache || {};
      const fresh = cachedOnly[id] && Date.now() - cachedOnly[id].t < BADGE_DAYS * DAY;
      try { const v = await badgeVerdict(id); if (v && v.tier) badgeFor(tile, v); else { const h = tile.querySelector(".sib-badge"); if (h) h.remove(); } } catch {}
      if (!fresh) { badgeCount++; await new Promise(r => setTimeout(r, BADGE_GAP)); }
    }
    badgeBusy = false;
  }
  function watchTiles() {
    if (!badgeObserver) badgeObserver = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        badgeObserver.unobserve(e.target);
        const id = tileId(e.target);
        if (id && !badgeQueue.some(q => q.id === id)) { badgeFor(e.target, {}); badgeQueue.push({ tile: e.target, id }); }
      }
      drainBadges();
    }, { rootMargin: "200px" });
    for (const t of document.querySelectorAll('[data-item-id]:not([data-sib-seen])')) { if (!t.querySelector('a[href*="/ip/"]')) continue; t.setAttribute("data-sib-seen", ""); badgeObserver.observe(t); }
  }
  function startBadges(profile) {
    badgeProfile = profile;
    watchTiles();
    if (!badgeMutations) { badgeMutations = new MutationObserver(() => watchTiles()); badgeMutations.observe(document.body, { childList: true, subtree: true }); }
  }
  function stopBadges() {
    if (badgeMutations) badgeMutations.disconnect(); badgeMutations = null;
    if (badgeObserver) badgeObserver.disconnect(); badgeObserver = null;
    badgeQueue = []; document.querySelectorAll(".sib-badge").forEach(b => b.remove()); document.querySelectorAll("[data-sib-seen]").forEach(t => t.removeAttribute("data-sib-seen"));
  }

  // ---------- page changes ----------
  async function check() {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    if (!READ.productId(url)) {
      removeBadge();
      publish(null);
      const s2 = await store(["profile", "usdaKey", "searchBadges"]);
      badgeCount = 0;
      // Search badges load product pages in the background; Sam's Club checks for robots more readily, so not there.
      if (s2.searchBadges && STORE.id === "walmart") startBadges({ ...V.DEFAULT_PROFILE, ...(s2.profile || {}), usdaKey: s2.usdaKey || "" }); else stopBadges();
      return;
    }
    stopBadges();
    const mine = ++run;
    const saved = await store(["profile", "usdaKey", "corner"]);
    corner = saved.corner === "right" ? "right" : "left";
    const p = { ...V.DEFAULT_PROFILE, ...(saved.profile || {}), usdaKey: saved.usdaKey || "" };
    removeBadge();
    publish({ url, state: "loading" });
    try {
      const prod = await pageProduct(url);
      if (mine !== run) return;
      if (!prod) { publish(null); return; }
      // Non-food pages get no badge; the side panel shows its empty state.
      const pl = READ.plan(prod);
      if (pl.kind === "none" && !/^No nutrition/.test(pl.why)) { publish(null); return; }
      badgeState = { tier: null, word: "", reason: "checking…", warn: null, label: "Checking this product" };
      drawBadge(); watchPage();
      let r = pl.kind === "none" ? { none: "No nutrition facts on this page, and no barcode to look up." } : await resolve(prod, p);
      if (mine !== run) return;
      if (!r) { removeBadge(); publish(null); return; }
      // A label photo the person read and checked in the side panel replaces lookups and names (not a page's own
      // Nutrition Facts, which the panel doesn't offer to replace).
      const photo = photos.get(url);
      if (photo && r.source !== "this page" || photo && r.supplement && !r.supplement.fromLabel) r = fromPhoto(photo, prod, p) || r;
      const product = { name: prod.name, ingredients: prod.ingredients || "", url, store: { id: STORE.id, name: STORE.name }, images: (prod.images || []).slice(0, 12) };
      if (r.supplement) {
        const sp = r.supplement;
        badgeState = r.skip ? { tier: "skip", word: "Skip", reason: "on your skip list", warn: null, label: `Skip: ${r.skip.why}` }
          : { tier: "supp", word: "Supplement", reason: sp.reason, warn: null, label: `Supplement, not scored like food${sp.caffeine && sp.caffeine.mg != null ? `: ${sp.caffeine.mg} mg caffeine per serving` : ""}` };
        drawBadge();
        publish({ url, state: "supplement", supplement: sp, skip: r.skip ? { why: r.skip.why, note: (r.skip.reasons[0] || {}).t } : null, detail: r.detail, product });
        return;
      }
      if (r.none) {
        badgeState = { tier: null, word: "", reason: "no nutrition data", warn: null, label: r.none };
        drawBadge();
        publish({ url, state: "none", message: r.none, product });
        return;
      }
      // Walmart's own price for this item, per serving (from the page's unit price and the serving size).
      const cost = W.servingCost(prod.price, r.food);
      if (prod.price && (cost || prod.price.now)) r.food = { ...r.food, storePrice: { perServing: cost, item: prod.price.now, unitText: prod.price.text, store: STORE.name, on: new Date().toISOString().slice(0, 10) } };
      // An ingredient-list conflict doesn't change the verdict (it's scored on the nutrients), so it shows in the side
      // panel next to that ingredient; the badge's ⚠ is only for missing data that could change the verdict.
      badgeState = productBadge(r, p, null);
      drawBadge();
      publish({ url, state: "ready", result: { food: r.food, source: r.source, detail: r.detail, note: r.note, link: r.link || null, typical: !!r.typical }, product });
    } catch (e) {
      if (mine === run && e && e.challenge) { badgeState = { tier: null, word: "", reason: "reload the page to check", warn: null, label: `${STORE.name} asked to check you're not a robot. Reload the page to see the verdict.` }; drawBadge(); publish({ url, state: "none", message: `${STORE.name} asked to check you're not a robot. Reload the page to see the verdict.` }); return; }
      if (mine === run) { badgeState = { tier: null, word: "", reason: "couldn't read this page", warn: null, label: "Couldn't read this page. Reload it to try again." }; drawBadge(); publish({ url, state: "none", message: "Couldn't read this page. Reload it to try again." }); }
    }
  }
  check();
  // Walmart changes pages without reloading, so watch the address.
  setInterval(check, 700);
  window.addEventListener("popstate", check);
  try { chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.corner) { corner = changes.corner.newValue === "right" ? "right" : "left"; refloat(); }
    // Goals or search settings changed: re-check (the side panel re-scores on its own).
    if (changes.profile || changes.usdaKey || changes.searchBadges) { if (changes.profile) save({ badgeCache: {} }); lastUrl = null; check(); }
  }); } catch {}
})();
