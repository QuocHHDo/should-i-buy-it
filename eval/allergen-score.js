// Scores js/allergens.js against real labels. The ground truth is the label's own allergen statement: US law
// (FALCPA, FASTER Act) makes packaged foods name their major allergens, usually in a "Contains: Milk, Soy" line.
// The test hides that line and checks the detector finds the same allergens from the ingredients alone, so the
// truth isn't something we wrote. The statement is read with its own small word list, kept apart from the
// detector's synonyms so a gap in one doesn't hide a gap in the other.
//   const S = require("./allergen-score.js"); S.score(records)  // records: [{ source, id, name, ingredients, offAllergens?, offTraces? }]
"use strict";
const A = require("../js/allergens.js");

// Plain allergen names as they appear in a Contains statement.
const STATEMENT_WORDS = [
  ["milk", /\b(?:milk|dairy|whey|casein|lactose|butter|cream|cheese)\b/i],
  ["egg", /\beggs?\b/i],
  ["fish", /\b(?:fish|anchov(?:y|ies)|tuna|salmon|cod|pollock|tilapia|sardines?|mackerel|haddock|halibut|trout|catfish|bass|swordfish|herring|whitefish|bonito)\b/i],
  ["shellfish", /\b(?:shellfish|crustaceans?|shrimp|crab|lobster|crawfish|crayfish|prawns?|clams?|scallops?|mussels?|oysters?|squid|mollus[ck]s?)\b/i],
  ["treenut", /\b(?:tree ?nuts?|almonds?|cashews?|pecans?|walnuts?|hazelnuts?|filberts?|pistachios?|macadamias?|brazil nuts?|pine nuts?|chestnuts?)\b/i],
  ["peanut", /\bpeanuts?\b/i],
  ["wheat", /\bwheat\b/i],
  ["soy", /\b(?:soy|soya|soybeans?)\b/i],
  ["sesame", /\bsesame\b/i],
];
// "Contains: ...", "Allergens: ...", "Allergen information: contains ..." up to the end of the sentence. Not
// "contains 2% or less of", "contains less than", "contains no", "contains 10% juice".
const STATEMENT = /\b(?:allergens?(?: information| statement)?\s*:\s*(?:contains\s*:?\s*)?|contains\s*:?\s*)(?!(?:\d|less|no\b|none|not|one|two)[^.]*?)([a-z][^.;]{1,200})/gi;
const NOT_A_LIST = /^(?:\d|less than|2%|of the following|the following|natural|added|a |an |trace amounts?)/i;

// The allergens a label's own statement names, and the text with every statement taken out.
function statement(text) {
  const t = String(text || "");
  const ids = new Set(), parts = [];
  let coconutOnly = false;
  for (const m of t.matchAll(STATEMENT)) {
    const body = m[1].trim();
    if (NOT_A_LIST.test(body)) continue;
    const found = STATEMENT_WORDS.filter(([, re]) => re.test(body)).map(([id]) => id);
    // "Contains: Tree Nuts (Coconut)": the FDA stopped calling coconut a tree nut in 2025, and so does the detector.
    if (/\bcoconut\b/i.test(body) && !/\b(?:almond|cashew|pecan|walnut|hazelnut|pistachio|macadamia|brazil|pine nut)/i.test(body) && found.includes("treenut")) { found.splice(found.indexOf("treenut"), 1); coconutOnly = true; }
    if (!found.length) continue;
    found.forEach(id => ids.add(id));
    parts.push(m[0]);
  }
  let rest = t;
  for (const p of parts) rest = rest.replace(p, " ");
  return { ids, rest, statements: parts, coconutOnly };
}

// Same text, minus "may contain" / shared-facility sentences: those name possible cross-contact, not ingredients.
const MAY = /\b(?:may (?:also )?contain|made (?:in|on) (?:a |the )?(?:same |shared )?(?:facility|equipment|line|plant)|(?:processed|produced|manufactured|packaged|packed) (?:in|on) (?:a |the )?(?:same |shared )?(?:facility|equipment|line|plant)|shared (?:equipment|facility|lines?)|traces? of)[^.;]*/gi;

const snippet = (text, words) => {
  const t = String(text);
  for (const w of words || []) { const i = t.toLowerCase().indexOf(String(w).toLowerCase()); if (i >= 0) return "…" + t.slice(Math.max(0, i - 50), i + 60).replace(/\s+/g, " ") + "…"; }
  return t.slice(0, 160).replace(/\s+/g, " ") + (t.length > 160 ? "…" : "");
};

function score(records) {
  const per = Object.fromEntries(A.IDS.map(id => [id, { truth: 0, found: 0, missed: 0, extra: 0 }]));
  const misses = [], extras = [], offMissed = [], offExtra = [], full = [];
  let withStatement = 0, offRecords = 0;
  for (const r of records) {
    const text = String(r.ingredients || "");
    if (text.length < 10) continue;
    const st = statement(text);
    // 1. Hidden statement: find the label's allergens from the ingredients alone.
    if (st.ids.size) {
      withStatement++;
      const rest = st.rest.replace(MAY, " ");
      const got = A.fromText(rest).contains;
      for (const id of A.IDS) {
        const t = st.ids.has(id), g = got.has(id);
        if (t) per[id].truth++;
        if (t && g) per[id].found++;
        if (t && !g) { per[id].missed++; misses.push({ id, source: r.source, ref: r.id, name: r.name, statement: st.statements.join(" | ").trim(), text: snippet(rest) }); }
        if (!t && g) { per[id].extra++; extras.push({ id, source: r.source, ref: r.id, name: r.name, words: got.get(id), statement: st.statements.join(" | ").trim(), text: snippet(rest, got.get(id)) }); }
      }
      // 2. Whole label, statement included: anything the label names must be flagged. Should never fail.
      const all = A.fromText(text).contains;
      for (const id of st.ids) if (!all.has(id)) full.push({ id, source: r.source, ref: r.id, name: r.name, text: snippet(text) });
    }
    // 3. Open Food Facts' own allergen tags against the detector on the whole text. Their tags are partly made by
    // their own parser, so a disagreement is a case to read, not a verdict either way.
    if (Array.isArray(r.offAllergens)) {
      offRecords++;
      const tags = new Set(A.offIds(r.offAllergens));
      const got = A.fromText(text).contains;
      for (const id of tags) if (!got.has(id)) offMissed.push({ id, ref: r.id, name: r.name, tags: r.offAllergens, text: snippet(text) });
      for (const id of got.keys()) if (!tags.has(id)) offExtra.push({ id, ref: r.id, name: r.name, words: got.get(id), text: snippet(text, got.get(id)) });
    }
  }
  const truth = Object.values(per).reduce((s, x) => s + x.truth, 0), found = Object.values(per).reduce((s, x) => s + x.found, 0);
  return { records: records.length, withStatement, offRecords, truth, found, recall: truth ? found / truth : null, per, misses, extras, full, offMissed, offExtra };
}

const pct = x => x == null ? "—" : `${(x * 100).toFixed(1)}%`;
function report(s, title = "Allergen detection on real labels") {
  const L = [`# ${title}`, "",
    `${s.records} labels, ${s.withStatement} with their own allergen statement (${s.truth} allergens named in them), ${s.offRecords} from Open Food Facts with allergen tags.`, "",
    "## Hidden statement: allergens found from the ingredients alone", "",
    `**Recall: ${pct(s.recall)}** (${s.found} of ${s.truth}). **Missed: ${s.truth - s.found}.** Flagged but not in the statement: ${s.extras.length}.`, "",
    "| Allergen | In statements | Found | Missed | Extra flags |", "|---|---:|---:|---:|---:|",
    ...A.IDS.map(id => { const x = s.per[id]; return `| ${A.labelOf(id)} | ${x.truth} | ${x.found} | ${x.missed} | ${x.extra} |`; }), ""];
  L.push("### Missed (the failures that matter)", "");
  if (!s.misses.length) L.push("None.", "");
  for (const m of s.misses) L.push(`- **${A.labelOf(m.id)}** · ${m.name || m.ref} (${m.source} ${m.ref}) · statement: “${m.statement}” · ingredients: ${m.text}`);
  L.push("", "### Whole label still missing a named allergen (should be empty)", "", s.full.length ? "" : "None.", ...s.full.map(m => `- **${A.labelOf(m.id)}** · ${m.name || m.ref}: ${m.text}`), "");
  L.push("### Flagged but not in the statement (read each: a real ingredient the statement left out, or a false flag)", "");
  if (!s.extras.length) L.push("None.", "");
  for (const m of s.extras.slice(0, 80)) L.push(`- **${A.labelOf(m.id)}** (“${(m.words || []).join("”, “")}”) · ${m.name || m.ref} · statement: “${m.statement}” · ${m.text}`);
  if (s.extras.length > 80) L.push(`- …and ${s.extras.length - 80} more in the JSON.`);
  if (s.offRecords) {
    L.push("", "## Open Food Facts allergen tags vs. the detector (whole text)", "",
      `Tagged by Open Food Facts but not flagged: ${s.offMissed.length}. Flagged but not tagged: ${s.offExtra.length}.`, "");
    for (const m of s.offMissed.slice(0, 60)) L.push(`- not flagged **${A.labelOf(m.id)}** · ${m.name || m.ref} (tags ${m.tags.join(", ")}) · ${m.text}`);
    for (const m of s.offExtra.slice(0, 60)) L.push(`- flagged **${A.labelOf(m.id)}** (“${(m.words || []).join("”, “")}”) · ${m.name || m.ref} · ${m.text}`);
  }
  return L.join("\n") + "\n";
}

module.exports = { statement, score, report, STATEMENT_WORDS };
