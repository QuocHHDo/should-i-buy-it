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
  ["milk", /\b(?:milk|dairy|whey|casein|lactose|(?<!cocoa |cacao |shea |peanut |nut |almond )butter|cream|cheese)\b/i],
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
// The statement ends with its sentence, or at a bracket it didn't open: "(Contains: Soy)" mustn't swallow the rest
// of the list, but "Contains: Crustacean Shellfish (Shrimp), Wheat" keeps its own brackets (see bodyAt).
const STATEMENT = /\b(?:allergens?(?: information| statement)?\s*:\s*(?:contains\s*:?\s*)?|contains\s*:?\s*)(?!(?:\d|less|no\b|none|not|one|two)[^.]*?)(?=[a-z])/gi;
function bodyAt(t, from) {
  let depth = 0, i = from;
  for (; i < t.length && i - from < 200; i++) {
    const ch = t[i];
    if (".;|\n".includes(ch)) break;
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) { if (depth === 0) break; depth--; }
  }
  return t.slice(from, i);
}
// Where a statement turns into cross-contact ("Contains wheat. Manufactured in a line that may contain almonds").
const STATEMENT_MAY = /\b(?:may (?:also )?contain|manufactured|processed|produced|packaged|made (?:in|on)|facility|traces?|shared)\b[\s\S]*$/i;
const NOT_A_LIST = /^(?:\d|less than|2%|of the following|the following|natural|added|a |an |trace amounts?)/i;

// The allergens a label's own statement names, and the text with every statement taken out.
function statement(text) {
  const t = String(text || "");
  const ids = new Set(), parts = [];
  let coconutOnly = false;
  for (const m of t.matchAll(STATEMENT)) {
    const raw = bodyAt(t, m.index + m[0].length), whole = m[0] + raw;
    const body = raw.replace(STATEMENT_MAY, "").trim();
    if (NOT_A_LIST.test(body)) continue;
    const found = STATEMENT_WORDS.filter(([, re]) => re.test(body)).map(([id]) => id);
    // "Contains: Tree Nuts (Coconut)": the FDA stopped calling coconut a tree nut in 2025, and so does the detector.
    if (/\bcoconut\b/i.test(body) && !/\b(?:almond|cashew|pecan|walnut|hazelnut|pistachio|macadamia|brazil|pine nut)/i.test(body) && found.includes("treenut")) { found.splice(found.indexOf("treenut"), 1); coconutOnly = true; }
    if (!found.length) continue;
    found.forEach(id => ids.add(id));
    parts.push(whole);
  }
  let rest = t;
  for (const p of parts) rest = rest.replace(p, " ");
  return { ids, rest, statements: parts, coconutOnly };
}

// Same text, minus "may contain" / shared-facility sentences: those name possible cross-contact, not ingredients.
const MAY = /\b(?:may (?:also )?(?:contain|use|be present)|made (?:in|on) (?:a |the )?(?:same |shared )?(?:facility|equipment|line|plant|bakery|kitchen)|(?:processed|produced|manufactured|packaged|packed|baked) (?:in|on) (?:a |the )?(?:same |shared )?(?:facility|equipment|line|plant|bakery|kitchen)|shared (?:equipment|facility|lines?)|traces? of)[^.;]*/gi;

const snippet = (text, words) => {
  const t = String(text);
  for (const w of words || []) { const i = t.toLowerCase().indexOf(String(w).toLowerCase()); if (i >= 0) return "…" + t.slice(Math.max(0, i - 50), i + 60).replace(/\s+/g, " ") + "…"; }
  return t.slice(0, 160).replace(/\s+/g, " ") + (t.length > 160 ? "…" : "");
};

function score(records) {
  // found: flagged "contains"; asMay: flagged only "may contain" (the app still warns); missed: no flag at all.
  const per = Object.fromEntries(A.IDS.map(id => [id, { truth: 0, found: 0, asMay: 0, missed: 0, extra: 0 }]));
  const misses = [], asMay = [], extras = [], offMissed = [], offExtra = [], full = [];
  let withStatement = 0, offRecords = 0;
  for (const r of records) {
    const text = String(r.ingredients || "");
    if (text.length < 10) continue;
    const st = statement(text);
    // 1. Hidden statement: find the label's allergens from the ingredients alone.
    if (st.ids.size) {
      withStatement++;
      const rest = st.rest.replace(MAY, " ");
      const r2 = A.fromText(rest), got = r2.contains;
      for (const id of A.IDS) {
        const t = st.ids.has(id), g = got.has(id);
        if (t) per[id].truth++;
        if (t && g) per[id].found++;
        if (t && !g && r2.may.has(id)) { per[id].asMay++; asMay.push({ id, source: r.source, ref: r.id, name: r.name, words: r2.may.get(id), statement: st.statements.join(" | ").trim(), text: snippet(rest, r2.may.get(id)) }); }
        if (t && !g && !r2.may.has(id)) { per[id].missed++; misses.push({ id, source: r.source, ref: r.id, name: r.name, statement: st.statements.join(" | ").trim(), text: snippet(rest) }); }
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
      const mayToo = A.fromText(text).may;
      for (const id of tags) if (!got.has(id) && !mayToo.has(id)) offMissed.push({ id, ref: r.id, name: r.name, tags: r.offAllergens, text: snippet(text) });
      for (const id of got.keys()) if (A.IDS.includes(id) && !tags.has(id)) offExtra.push({ id, ref: r.id, name: r.name, words: got.get(id), text: snippet(text, got.get(id)) });
    }
  }
  const diets = scoreDiets(records);
  const sum = k => Object.values(per).reduce((s, x) => s + x[k], 0);
  const truth = sum("truth"), found = sum("found"), warned = found + sum("asMay");
  return { records: records.length, withStatement, offRecords, truth, found, warned, recall: truth ? found / truth : null, warnedRate: truth ? warned / truth : null,
    per, misses, asMay, extras, full, offMissed, offExtra, diets };
}

// Diets against Open Food Facts' own reading of each label: their vegan / vegetarian analysis and their gluten
// tag. The detector sees only the name and ingredient text (as for a label with no tags), so the two are independent.
// Their analysis is a parser too: a disagreement is a case to read, not a verdict.
function scoreDiets(records) {
  const out = {};
  for (const d of ["gluten", "vegetarian", "vegan"]) out[d] = { compared: 0, agree: 0, warnedOnly: 0, missed: [], falseFlags: [] };
  for (const r of records) {
    const text = String(r.ingredients || "");
    if (text.length < 10 || r.source !== "off") continue;
    const det = A.detect({ n: r.name || "", a: [], src: "eval", ingredients: text });
    const flag = d => det.contains.has(d) ? "contains" : det.may.has(d) ? "may" : "none";
    const refs = {};
    const an = Array.isArray(r.offAnalysis) ? r.offAnalysis : null;
    if (an) for (const d of ["vegan", "vegetarian"]) {
      if (an.includes(`en:non-${d}`)) refs[d] = "has"; else if (an.includes(`en:${d}`)) refs[d] = "free";
    }
    if (Array.isArray(r.offAllergens)) refs.gluten = r.offAllergens.includes("en:gluten") ? "has" : (r.offTraces || []).includes("en:gluten") ? null : "free";
    for (const [d, ref] of Object.entries(refs)) {
      if (!ref) continue;
      const o = out[d], f = flag(d), words = (det.contains.get(d) || det.may.get(d) || []).slice(0, 2);
      o.compared++;
      if ((ref === "has" && f === "contains") || (ref === "free" && f === "none")) o.agree++;
      else if (ref === "has" && f === "may") o.warnedOnly++;
      else if (ref === "has") o.missed.push({ ref: r.id, name: r.name, text: snippet(text) });
      else if (f === "contains") o.falseFlags.push({ ref: r.id, name: r.name, why: words, text: snippet(text, words.map(w => (String(w).match(/“([^”]+)”/) || [])[1]).filter(Boolean)) });
      else o.agree++; // "free" and only a "may": a cautious flag, not counted against it
    }
  }
  return out;
}

const pct = x => x == null ? "—" : `${(x * 100).toFixed(1)}%`;
function report(s, title = "Allergen detection on real labels") {
  const L = [`# ${title}`, "",
    `${s.records} labels, ${s.withStatement} with their own allergen statement (${s.truth} allergens named in them), ${s.offRecords} from Open Food Facts with allergen tags.`, "",
    "## Hidden statement: allergens found from the ingredients alone", "",
    `**Warned: ${pct(s.warnedRate)}** (${s.warned} of ${s.truth} flagged “contains” or “may contain”). **Missed with no flag at all: ${s.misses.length}.** Flagged “contains”: ${pct(s.recall)}. Flagged but not in the statement: ${s.extras.length}.`, "",
    "| Allergen | In statements | Contains | Only “may” | Missed | Extra flags |", "|---|---:|---:|---:|---:|---:|",
    ...A.IDS.map(id => { const x = s.per[id]; return `| ${A.labelOf(id)} | ${x.truth} | ${x.found} | ${x.asMay} | ${x.missed} | ${x.extra} |`; }), ""];
  L.push("### Missed (the failures that matter)", "");
  if (!s.misses.length) L.push("None.", "");
  for (const m of s.misses) L.push(`- **${A.labelOf(m.id)}** · ${m.name || m.ref} (${m.source} ${m.ref}) · statement: “${m.statement}” · ingredients: ${m.text}`);
  if (s.asMay.length) { L.push("", "### Flagged only as “may contain” (the label says contains)", ""); for (const m of s.asMay) L.push(`- **${A.labelOf(m.id)}** (“${(m.words || []).join("”, “")}”) · ${m.name || m.ref} · statement: “${m.statement}” · ${m.text}`); }
  L.push("", "### Whole label still missing a named allergen (should be empty)", "", s.full.length ? "" : "None.", ...s.full.map(m => `- **${A.labelOf(m.id)}** · ${m.name || m.ref}: ${m.text}`), "");
  L.push("### Flagged but not in the statement (read each: a real ingredient the statement left out, or a false flag)", "");
  if (!s.extras.length) L.push("None.", "");
  for (const m of s.extras.slice(0, 80)) L.push(`- **${A.labelOf(m.id)}** (“${(m.words || []).join("”, “")}”) · ${m.name || m.ref} · statement: “${m.statement}” · ${m.text}`);
  if (s.extras.length > 80) L.push(`- …and ${s.extras.length - 80} more in the JSON.`);
  if (s.offRecords) {
    L.push("", "## Open Food Facts allergen tags vs. the detector (whole text)", "",
      `Tagged by Open Food Facts but not flagged at all from the text: ${s.offMissed.length}. Flagged “contains” but not tagged: ${s.offExtra.length}. In the app their tags count too, so these are about the text alone; their tags include traces and their own parser's mistakes, so read each.`, "");
    for (const m of s.offMissed.slice(0, 60)) L.push(`- not flagged **${A.labelOf(m.id)}** · ${m.name || m.ref} (tags ${m.tags.join(", ")}) · ${m.text}`);
    for (const m of s.offExtra.slice(0, 60)) L.push(`- flagged **${A.labelOf(m.id)}** (“${(m.words || []).join("”, “")}”) · ${m.name || m.ref} · ${m.text}`);
  }
  if (s.diets) {
    L.push("", "## Diets vs. Open Food Facts' own analysis (name and ingredient text only)", "",
      "| Diet | Compared | Agree | They say it has it, we only say “may” | They say it has it, we don't flag | We say “contains”, they say it's free |", "|---|---:|---:|---:|---:|---:|",
      ...Object.entries(s.diets).map(([d, o]) => `| ${A.labelOf(d)} | ${o.compared} | ${o.agree} | ${o.warnedOnly} | ${o.missed.length} | ${o.falseFlags.length} |`), "");
    for (const [d, o] of Object.entries(s.diets)) {
      for (const m of o.missed.slice(0, 40)) L.push(`- not flagged **${A.labelOf(d)}** · ${m.name || m.ref} (${m.ref}) · ${m.text}`);
      for (const m of o.falseFlags.slice(0, 40)) L.push(`- flagged **${A.labelOf(d)}** (${m.why.join("; ")}) · ${m.name || m.ref} (${m.ref}) · ${m.text}`);
    }
  }
  return L.join("\n") + "\n";
}

module.exports = { statement, score, report, STATEMENT_WORDS };
