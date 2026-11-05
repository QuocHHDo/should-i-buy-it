// Food-name search: exact, prefix and word matches, plus typo-tolerant ("chiken brest") matching.
// resolve() decides what pressing Enter should do, so the app never silently swaps in a different food.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckSearch = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9/ ]/g, "").replace(/\s+/g, " ").trim();
  const MINOR = new Set(["a", "an", "and", "the", "of", "with", "in", "or", "for"]);
  const words = s => norm(s).split(" ").filter(w => w && !MINOR.has(w));
  // Plurals don't change the food: "granola bars" contains "granola bar", "breasts" is "breast".
  const stem = w => w.length > 3 ? w.replace(/(?<=[^aeiou])ies$/, "y").replace(/(?<=(?:ch|sh|x|ss))es$/, "").replace(/(?<=[^s])s$/, "") : w;

  // ---------- titles copied from store websites ----------
  // "Great Value Whole Vitamin D Milk, Gallon, 128 fl oz" → "Great Value Whole Vitamin D Milk". Sizes, counts,
  // pack sizes and packaging words say how much is in the package, not what the food is, and they keep both the
  // built-in match and a product search from finding it.
  const UNIT = "fl\\.?\\s*oz|fluid\\s+ounces?|oz|ounces?|lbs?|pounds?|g|grams?|kg|mg|ml|l|liters?|litres?|ct|count|counts|pk|pack|packs|pcs|pieces?|servings?|cans?|bottles?|bars?|bags?|pouches?|sticks?|boxes|cartons?|jars?|tubs?";
  const SIZE = new RegExp(`(?:\\b(?:pack|case|box|set)\\s+of\\s+\\d+\\b|\\b\\d+\\s*x\\s*(?=\\d)|(?:^|[\\s(,/-])\\d+(?:[.,]\\d+)?\\s*-?\\s*(?:${UNIT})\\b\\.?)`, "gi");
  const PACKAGING = /\b(?:family|party|value|share|sharing|king|snack|club|jumbo|mega|bulk)[\s-]+(?:size|pack)\b|\b(?:multi[\s-]?pack|variety pack|value pack|half gallon|gallon|quart|pint|bag|box|tub|jar|cans?|bottles?|carton|pouch|loaf|each|bunch|case|container|package|pkg|resealable|new|ea)\b/gi;
  function cleanTitle(text) {
    let s = String(text || "").replace(/[®™©]/g, " ");
    // "(Frozen)", "(Pack of 6)", "(12 Count)": a size or a state, not the food.
    s = s.replace(/\(([^()]*)\)/g, (m, inner) => /\d|frozen|refrigerated|packaging may vary|each/i.test(inner) ? " " : m);
    s = s.replace(SIZE, " ").replace(PACKAGING, " ");
    // Separators store sites use between the name and its options: ", ", " - ", " | ", " – ".
    const parts = s.split(/\s*(?:,|\s[-–—|]\s|\|)\s*/).map(p => p.replace(/\s+/g, " ").trim()).filter(p => /[a-z]{2,}/i.test(p));
    return parts.join(", ").replace(/\s+/g, " ").trim();
  }
  // Does this look pasted from a store page rather than typed? A size or count, packaging words, ®/™, or a long
  // comma-separated title. Typed searches ("chicken breast", "kirkland protein bar") are short and plain.
  function looksLikeProduct(text) {
    const t = String(text || "");
    SIZE.lastIndex = 0; PACKAGING.lastIndex = 0;
    const n = words(t).length;
    return SIZE.test(t) || PACKAGING.test(t) || /[®™]/.test(t) || n >= 6 || (n >= 4 && /,|\s[-–|]\s/.test(t));
  }

  // Edit distance with adjacent swaps (Damerau-Levenshtein, optimal string alignment), stopping early past `max`.
  function editDistance(a, b, max = 2) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  // Typos allowed per word: none under 4 letters, one up to 6, two beyond.
  const allowed = w => (w.length < 4 ? 0 : w.length <= 6 ? 1 : 2);
  // Does query word q (possibly a typo, possibly a prefix of a longer word) match name word n?
  function wordClose(q, n) {
    if (n === q || n.startsWith(q) && q.length >= 3) return true;
    const k = allowed(q);
    if (!k) return false;
    if (editDistance(q, n, k) <= k) return true;
    // Typo in a prefix: "brocc" for "broccoli", "chik" for "chicken".
    return q.length >= 4 && n.length > q.length && editDistance(q, n.slice(0, q.length), 1) <= 1;
  }
  // How well a typo-laden query fits a name: the share of query words matched, and the share of the
  // name's words covered (so "chicken breast" beats "deli chicken breast" for "chiken brest").
  function fuzzyScore(q, name) {
    const qw = words(q), nw = words(name);
    if (!qw.length || !nw.length) return { query: 0, name: 0 };
    const hit = qw.filter(w => nw.some(n => wordClose(w, n))).length;
    const covered = nw.filter(n => qw.some(w => wordClose(w, n))).length;
    return { query: hit / qw.length, name: covered / nw.length };
  }

  // Score bands: 100 exact · 80 name starts with query · 60 a word starts with it · 40 name contains it
  // · 31–35 every query word matches allowing typos ("chiken brest") · 30 the query contains the whole name
  // ("kirkland protein bar" ⊃ "protein bar") · 1–10 some query words match allowing typos.
  const STRONG = 60;
  function match(q, foods) {
    const nq = norm(cleanTitle(q) || q); if (!nq) return [];
    const qs = " " + nq.split(" ").map(stem).join(" ") + " ";
    const scored = [];
    for (const f of foods) {
      let best = 0;
      for (const n of [f.n, ...(f.a || [])].map(norm)) {
        if (n === nq) best = Math.max(best, 100);
        else if (n.startsWith(nq)) best = Math.max(best, 80);
        else if (n.split(" ").some(w => w.startsWith(nq))) best = Math.max(best, 60);
        else if (n.includes(nq)) best = Math.max(best, 40);
        else {
          // The query holds the whole name: the longer the name it holds, the more specific the match
          // ("lays classic potato chips" → Potato chips over Potato), 30.0–30.9.
          const ns = n.split(" ").map(stem).join(" ");
          if (nq.length > 3 && qs.includes(" " + ns + " ")) best = Math.max(best, 30 + Math.min(0.9, 0.15 * n.split(" ").length));
          if (nq.length >= 4) {
            const fz = fuzzyScore(nq, n);
            if (fz.query === 1) best = Math.max(best, 31 + 4 * fz.name);
            else if (fz.query >= 0.5 && words(nq).length > 1) best = Math.max(best, Math.round(fz.query * 10));
          }
        }
      }
      if (best) scored.push({ f, best });
    }
    return scored.sort((x, y) => y.best - x.best || x.f.n.length - y.f.n.length);
  }
  const isExact = (f, text) => [f.n, ...(f.a || [])].map(norm).includes(norm(text));

  // What Enter should do with `text`:
  //   open    — an exact name, or the only strong match: show it
  //   closest — the only good guess is a food whose name is inside the query ("kirkland protein bar" →
  //             Protein bar) or contains it mid-word: show it, clearly labeled, with a way to search instead
  //   choose  — several plausible foods, typo matches ("Did you mean"), or none: list them and offer a search
  function resolve(text, foods) {
    const m = match(text, foods);
    if (!m.length) return { kind: "choose", near: [] };
    const top = m[0];
    if (isExact(top.f, text)) return { kind: "open", food: top.f };
    const strong = m.filter(x => x.best >= STRONG);
    if (strong.length === 1) return { kind: "open", food: strong[0].f };
    if (strong.length > 1) return { kind: "choose", near: strong.slice(0, 4).map(x => x.f) };
    const typo = top.best >= 31 && top.best < 40;
    if (!typo && (Math.floor(top.best) === 30 || top.best === 40) && m.filter(x => x.best === top.best).length === 1)
      return { kind: "closest", food: top.f, near: m.slice(1, 4).map(x => x.f) };
    return { kind: "choose", near: m.slice(0, 4).map(x => x.f), typo };
  }

  return { norm, words, editDistance, fuzzyScore, match, isExact, resolve, cleanTitle, looksLikeProduct, STRONG };
});
