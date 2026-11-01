// Quiz questions built from the app's own food data, so practicing teaches the same rules the verdicts use.
// Pure functions (pass in a random-number function) so tests can make them deterministic.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./verdict.js"));
  else root.SelfCheckLearn = factory(root.SelfCheckVerdict);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (V) {
  const NUTRIENTS = [
    { k: "sat", word: "saturated fat", unit: " g", gap: 1.5 },
    { k: "na", word: "sodium", unit: " mg", gap: 100 },
    { k: "add", word: "added sugar", unit: " g", gap: 3 },
    { k: "pro", word: "protein", unit: " g", gap: 4 },
    { k: "fib", word: "fiber", unit: " g", gap: 1.5 },
    { k: "cal", word: "calories", unit: "", gap: 40 },
  ];
  const VERDICTS = ["Get it", "In moderation", "Limit it"];

  // Small seedable random number generator (mulberry32) for repeatable quizzes in tests.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const pickOne = (r, arr) => arr[Math.floor(r() * arr.length)];
  const show = (nu, v) => (nu.k === "na" || nu.k === "cal" ? Math.round(v).toLocaleString("en-US") : V.fmt(v)) + nu.unit;

  function buildMore(a, b, nu, p) {
    const x = a[nu.k], y = b[nu.k];
    const e = V.explain(nu.k, a, p);
    return {
      type: "more", id: `more:${nu.k}:${a.n}|${b.n}`,
      prompt: `Which has more ${nu.word} per serving?`,
      options: [a.n, b.n], foods: [a, b], answer: x > y ? 0 : 1,
      explain: `${a.n}: ${show(nu, x)} per ${a.s}. ${b.n}: ${show(nu, y)} per ${b.s}.`,
      principle: e ? `Why it matters: ${e[2]}` : "",
    };
  }
  // A clear difference only: the gap must be meaningful and the smaller value at most 70% of the larger.
  const clear = (a, b, nu) => { const x = a[nu.k], y = b[nu.k], hi = Math.max(x, y), lo = Math.min(x, y); return hi - lo >= nu.gap && lo <= hi * 0.7; };

  function moreQuestion(foods, p, r) {
    for (let tries = 0; tries < 60; tries++) {
      const nu = pickOne(r, NUTRIENTS);
      const a = pickOne(r, foods);
      const same = foods.filter(f => f.c === a.c && f.n !== a.n);
      const b = pickOne(r, same.length ? same : foods.filter(f => f.n !== a.n));
      if (b && clear(a, b, nu)) return buildMore(a, b, nu, p);
    }
    return null;
  }

  function buildVerdict(f, p) {
    const a = V.assess(f, p);
    const why = a.reasons.filter(x => x.k !== "note").slice(0, 2).map(x => x.t).join(" ");
    return {
      type: "verdict", id: `verdict:${f.n}`,
      prompt: `For your goals, what's the verdict on ${f.n} (${f.s})?`,
      options: VERDICTS, foods: [f], answer: VERDICTS.indexOf(a.word),
      explain: why || a.why, principle: "",
    };
  }
  function verdictQuestion(foods, p, r) {
    const pool = foods.filter(g => VERDICTS.includes(V.assess(g, p).word));
    return pool.length ? buildVerdict(pickOne(r, pool), p) : null;
  }

  // 65% "which has more", 35% "what verdict".
  function makeQuestion(foods, p, r, kind) {
    const k = kind || (r() < 0.65 ? "more" : "verdict");
    return (k === "more" && moreQuestion(foods, p, r)) || verdictQuestion(foods, p, r);
  }

  // Rebuild a question from its id so missed questions can come back later.
  function fromId(id, foods, p) {
    const i = id.indexOf(":");
    const type = id.slice(0, i), rest = id.slice(i + 1);
    const find = n => foods.find(f => f.n === n);
    if (type === "verdict") { const f = find(rest); return f && VERDICTS.includes(V.assess(f, p).word) ? buildVerdict(f, p) : null; }
    if (type === "more") {
      const j = rest.indexOf(":");
      const nu = NUTRIENTS.find(n => n.k === rest.slice(0, j));
      const [n1, n2] = rest.slice(j + 1).split("|");
      const a = find(n1), b = find(n2);
      return nu && a && b ? buildMore(a, b, nu, p) : null;
    }
    return null;
  }

  // Spaced repetition, kept simple: a missed question comes back 3 questions later, then 8, then 20,
  // and leaves the review queue once answered correctly.
  const GAPS = [3, 8, 20];
  function recordAnswer(state, q, correct) {
    const s = { asked: 0, correct: 0, streak: 0, missed: [], ...state };
    s.missed = [...(s.missed || [])];
    s.asked += 1;
    const idx = s.missed.findIndex(m => m.id === q.id);
    if (correct) {
      s.correct += 1; s.streak += 1;
      if (idx >= 0) s.missed.splice(idx, 1);
    } else {
      s.streak = 0;
      const step = idx >= 0 ? Math.min(s.missed[idx].step + 1, GAPS.length - 1) : 0;
      const entry = { id: q.id, step, due: s.asked + GAPS[step] };
      if (idx >= 0) s.missed[idx] = entry; else s.missed.push(entry);
    }
    return s;
  }
  const dueReview = state => (state.missed || []).find(m => m.due <= state.asked) || null;

  return { NUTRIENTS, VERDICTS, seeded, makeQuestion, fromId, recordAnswer, dueReview };
});
