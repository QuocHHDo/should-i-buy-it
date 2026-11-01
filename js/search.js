// Food-name search: exact, prefix and word matches, plus typo-tolerant ("chiken brest") matching.
// resolve() decides what pressing Enter should do, so the app never silently swaps in a different food.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckSearch = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9/ ]/g, "").replace(/\s+/g, " ").trim();
  const MINOR = new Set(["a", "an", "and", "the", "of", "with", "in", "or", "for"]);
  const words = s => norm(s).split(" ").filter(w => w && !MINOR.has(w));

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
    const nq = norm(q); if (!nq) return [];
    const scored = [];
    for (const f of foods) {
      let best = 0;
      for (const n of [f.n, ...(f.a || [])].map(norm)) {
        if (n === nq) best = Math.max(best, 100);
        else if (n.startsWith(nq)) best = Math.max(best, 80);
        else if (n.split(" ").some(w => w.startsWith(nq))) best = Math.max(best, 60);
        else if (n.includes(nq)) best = Math.max(best, 40);
        else {
          if (nq.length > 3 && (" " + nq + " ").includes(" " + n + " ")) best = Math.max(best, 30);
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
    const typo = top.best > 30 && top.best < 40;
    if (!typo && (top.best === 30 || top.best === 40) && m.filter(x => x.best === top.best).length === 1)
      return { kind: "closest", food: top.f, near: m.slice(1, 4).map(x => x.f) };
    return { kind: "choose", near: m.slice(0, 4).map(x => x.f), typo };
  }

  return { norm, words, editDistance, fuzzyScore, match, isExact, resolve, STRONG };
});
