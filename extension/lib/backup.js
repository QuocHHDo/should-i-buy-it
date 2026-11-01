// Back up and restore what this browser has saved (goals, favorites, list, plate, prices, looked-up foods), as a
// file, as text, or as a transfer link. Restored data is checked field by field: a backup can come from anywhere
// (a pasted link), so only known keys with the right shapes are kept. The USDA API key is never included.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckBackup = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  const APP = "should-i-buy-it", VERSION = 1;
  const str = (v, max = 200) => typeof v === "string" && v.length <= max ? v : null;
  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const list = (v, max, each) => Array.isArray(v) ? v.slice(0, max).map(each).filter(x => x != null) : null;
  // Same ranges as the goal inputs.
  const GOALS = { cal: [800, 6000], pro: [20, 400], sat: [5, 40], na: [500, 5000], add: [0, 100], fib: [10, 70] };
  // A looked-up food: plain values only (strings, numbers, booleans, arrays of those), with a name and calories.
  function lookupFood(f) {
    if (!f || typeof f !== "object" || Array.isArray(f) || !str(f.n) || num(f.cal, 0, 20000) == null) return null;
    const out = {};
    for (const [k, v] of Object.entries(f).slice(0, 60)) {
      if (!/^[A-Za-z_]\w{0,30}$/.test(k)) continue;
      if (typeof v === "string") { if (v.length <= 5000) out[k] = v; }
      else if (typeof v === "number") { if (Number.isFinite(v)) out[k] = v; }
      else if (typeof v === "boolean") out[k] = v;
      else if (Array.isArray(v) && v.length <= 200 && v.every(x => ["string", "number", "boolean"].includes(typeof x) && String(x).length <= 200)) out[k] = v;
    }
    return out;
  }
  // Each saved key and how to check it. Anything else in a backup is ignored.
  const KEYS = {
    profile(v) {
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      const out = {};
      for (const [k, [lo, hi]] of Object.entries(GOALS)) { const n = num(v[k], lo, hi); if (n != null) out[k] = n; }
      if (str(v.skip, 500) != null) out.skip = v.skip;
      if (typeof v.mild === "boolean") out.mild = v.mild;
      return Object.keys(out).length ? out : null;
    },
    favorites: v => list(v, 100, x => str(x)),
    recents: v => list(v, 30, x => str(x)),
    grocery: v => list(v, 300, x => x && str(x.n) ? { n: x.n, done: x.done === true, ...(num(x.qty, 1, 99) ? { qty: Math.round(x.qty) } : {}) } : null),
    plate: v => list(v, 50, x => x && str(x.n) && num(x.mult, 0.25, 10) ? { n: x.n, mult: x.mult } : null),
    myPrices(v) {
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      const out = {};
      for (const [n, p] of Object.entries(v).slice(0, 500)) {
        if (!str(n) || !p || typeof p !== "object") continue;
        if (num(p.unit, 0.01, 10000)) out[n] = { unit: p.unit }; else if (num(p.serving, 0.01, 10000)) out[n] = { serving: p.serving };
        // The shelf price and size typed in a comparison, kept so the form shows them again.
        if (out[n] && out[n].serving && p.shelf && typeof p.shelf === "object" && typeof p.shelf.price === "string" && typeof p.shelf.size === "string" && p.shelf.price.length <= 20 && p.shelf.size.length <= 40)
          out[n].shelf = { price: p.shelf.price, size: p.shelf.size };
      }
      return out;
    },
    lookups: v => list(v, 200, lookupFood),
    learn(v) {
      if (!v || typeof v !== "object") return null;
      return { asked: num(v.asked, 0, 1e6) || 0, correct: num(v.correct, 0, 1e6) || 0, streak: num(v.streak, 0, 1e6) || 0, missed: list(v.missed, 200, x => str(x, 400)) || [] };
    },
    browseSort: v => str(v, 20), browseBasis: v => str(v, 20), walmartOnly: v => typeof v === "boolean" ? v : null,
    mealBudget: v => num(v, 0.5, 50), mealProtein: v => v === null ? null : num(v, 5, 200),
  };

  // get(key) reads the stored value (or undefined). Returns the backup object.
  function pack(get, now = new Date()) {
    const data = {};
    for (const k of Object.keys(KEYS)) {
      let v = get(k);
      if (v === undefined || v === null) continue;
      if (k === "profile" && v) { v = { ...v }; delete v.usdaKey; } // a personal API key stays out of backups and links
      data[k] = v;
    }
    return { app: APP, v: VERSION, saved: now.toISOString(), data };
  }

  // Text or an object → { ok, data, saved } with only checked values, or { ok: false, error }.
  function parse(input) {
    let o = input;
    if (typeof input === "string") { try { o = JSON.parse(input); } catch { return { ok: false, error: "That isn't a backup: the text isn't valid." }; } }
    if (!o || o.app !== APP || typeof o.data !== "object" || !o.data) return { ok: false, error: "That isn't a Should I Buy It? backup." };
    if (o.v > VERSION) return { ok: false, error: "This backup is from a newer version of the app. Reload the page and try again." };
    const data = {};
    const empty = v => v == null || (Array.isArray(v) ? !v.length : typeof v === "object" && !Object.keys(v).length);
    for (const [k, check] of Object.entries(KEYS)) if (k in o.data) { const v = check(o.data[k]); if (!empty(v)) data[k] = v; }
    if (!Object.keys(data).length) return { ok: false, error: "This backup is empty." };
    const saved = typeof o.saved === "string" && !Number.isNaN(Date.parse(o.saved)) ? o.saved : null;
    // "add": items for the grocery list (from the browser extension), merged in rather than replacing anything.
    if (o.kind === "add") {
      if (!data.grocery) return { ok: false, error: "That link has no list items in it." };
      return { ok: true, kind: "add", data: { grocery: data.grocery, ...(data.lookups ? { lookups: data.lookups } : {}) }, saved };
    }
    return { ok: true, kind: "backup", data, saved };
  }

  // Grocery items to add to the app's list: [{ n, qty, food? }]. A food is included when the app doesn't have it
  // (a store product read from its label); built-in foods go by name.
  function packAdd(items, now = new Date()) {
    const grocery = [], lookups = [];
    for (const it of items || []) {
      if (!it || !it.n) continue;
      grocery.push({ n: it.n, done: false, ...(it.qty > 1 ? { qty: it.qty } : {}) });
      // A store price travels as plain fields (backups keep only plain values).
      if (it.food) { const { storePrice: sp, ...food } = it.food; lookups.push({ ...food, n: it.n, ...(sp ? { spServing: sp.perServing || undefined, spItem: sp.item || undefined, spUnit: sp.unitText || undefined, spStore: sp.store, spOn: sp.on } : {}) }); }
    }
    return { app: APP, v: VERSION, kind: "add", saved: now.toISOString(), data: { grocery, ...(lookups.length ? { lookups } : {}) } };
  }

  // What a backup holds, in words: ["your goals", "12 favorites", ...].
  function summary(data) {
    const n = (k, one, many) => { const c = Array.isArray(data[k]) ? data[k].length : data[k] ? Object.keys(data[k]).length : 0; return c ? `${c} ${c === 1 ? one : many}` : null; };
    return [data.profile ? "your goals" : null, n("favorites", "favorite", "favorites"), n("grocery", "grocery item", "grocery items"),
      n("plate", "plate item", "plate items"), n("myPrices", "price of yours", "prices of yours"), n("lookups", "looked-up food", "looked-up foods"),
      n("recents", "recent food", "recent foods"), data.learn && data.learn.asked ? `quiz progress (${data.learn.asked} answered)` : null].filter(Boolean);
  }

  // ---- transfer link: #import=z.<deflated, base64url> (or j.<base64url> where compression isn't available) ----
  const b64url = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64url = t => { const s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  async function pipe(bytes, Stream, mode) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new Stream(mode)));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function encode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === "function") return "z." + b64url(await pipe(bytes, CompressionStream, "deflate-raw"));
    return "j." + b64url(bytes);
  }
  async function decode(token) {
    try {
      const [kind, body] = [String(token).slice(0, 2), String(token).slice(2)];
      if (body.length > 400000) return { ok: false, error: "That link is too long to be a backup." };
      let bytes = unb64url(body);
      if (kind === "z.") { if (typeof DecompressionStream !== "function") return { ok: false, error: "This browser can't open compressed links. Use the backup file instead." }; bytes = await pipe(bytes, DecompressionStream, "deflate-raw"); }
      else if (kind !== "j.") return { ok: false, error: "That link isn't a backup." };
      if (bytes.length > 4000000) return { ok: false, error: "That backup is too large." };
      return parse(new TextDecoder().decode(bytes));
    } catch { return { ok: false, error: "That link is damaged or incomplete. Copy it again, or use the backup file." }; }
  }

  // A product read by the phone bookmarklet: { kind: "walmart", data: { product, idml } }, checked by walmart.js.
  async function decodeProduct(token) {
    try {
      const [kind, body] = [String(token).slice(0, 2), String(token).slice(2)];
      if (kind !== "j." || body.length > 200000) return null;
      const o = JSON.parse(new TextDecoder().decode(unb64url(body)));
      return o && o.app === APP && o.kind === "walmart" && o.data && typeof o.data === "object" ? o.data : null;
    } catch { return null; }
  }

  return { pack, packAdd, parse, summary, encode, decode, decodeProduct, KEYS, APP, VERSION };
});
