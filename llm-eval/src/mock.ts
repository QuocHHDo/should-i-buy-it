// MOCK mode: fake model answers so the whole pipeline (cache, graders, results, dashboard, regression gate) runs
// without an API key. Nothing here is a real model. The "extraction" is a regex parser of the label text (it never
// sees the ground truth), so it fails where a naive parser would: per-container-first columns, OCR swaps, marketing
// numbers. A small, seeded, per-model error rate is layered on top so a multi-model mock run shows differences.
import crypto from "node:crypto";
import { CRITERIA, evaluateCriteria } from "./criteria.ts";
import { FIELDS, NUMERIC_FIELDS, type Extraction, type NumericField } from "./schema.ts";

export type MockHint =
  | { kind: "extract"; caseId: string; labelText: string }
  | { kind: "verdict"; caseId: string; data: Extraction }
  | { kind: "judge"; caseId: string; data: Extraction; responses: { label: string; text: string }[] };

/** Deterministic number in [0, 1) from a string. */
export function seeded(s: string): number {
  return crypto.createHash("sha256").update(s).digest().readUInt32BE(0) / 2 ** 32;
}

function errorRate(model: string): number {
  if (model.includes("haiku")) return 0.06;
  if (model.includes("sonnet")) return 0.03;
  if (model.includes("opus") || model.includes("fable")) return 0.01;
  return 0.03;
}

export function mockRespond(model: string, hint: MockHint): string {
  if (hint.kind === "extract") return JSON.stringify(mockExtract(model, hint.caseId, hint.labelText));
  if (hint.kind === "verdict") return mockVerdict(model, hint.caseId, hint.data);
  return JSON.stringify(mockJudge(hint.data, hint.responses));
}

function mockExtract(model: string, caseId: string, labelText: string): Extraction {
  const out = heuristicExtract(labelText);
  const rate = errorRate(model);
  for (const f of NUMERIC_FIELDS) {
    if (seeded(`${model}|${caseId}|${f}`) >= rate) continue;
    // Either an off-by-one misread, or (for a missing value) an invented one: the failure the null check catches.
    out[f] = out[f] === null ? 0 : out[f]! + 1;
  }
  return out;
}

const NUM = String.raw`(<\s*1|less than 1|\d[\d,]*(?:\.\d+)?)`;
const toNumber = (s: string): number => (/^<|less/.test(s) ? 0.5 : Number(s.replace(/,/g, "")));

/** A plain regex reader of label text. Takes the first number after (or right before) each nutrient name. */
export function heuristicExtract(labelText: string): Extraction {
  const text = labelText.replace(/-\n/g, "").toLowerCase();
  const out = Object.fromEntries(FIELDS.map(f => [f, null])) as Extraction;
  const names: Record<NumericField, string> = {
    servingsPerContainer: "",
    calories: String.raw`calories|energy[^\n(]*\(`,
    totalFat_g: String.raw`total fat|tot\. fat|fat, total|(?<!sat\. |saturated |trans )fat`,
    satFat_g: String.raw`saturated fat|sat\. fat|saturated|sat`,
    sodium_mg: String.raw`sodium`,
    totalCarbs_g: String.raw`total carbohydrate|total carb\.?|carbohydrate|carbs`,
    fiber_g: String.raw`dietary fiber|dietary fibre|fiber`,
    sugars_g: String.raw`total sugars|(?<!added )sugars(?! \d+g added)`,
    addedSugars_g: String.raw`added sugars`,
    protein_g: String.raw`protein`,
  };
  for (const f of NUMERIC_FIELDS) {
    if (f === "servingsPerContainer") continue;
    const after = new RegExp(String.raw`(?:${names[f]})[\s:.]*${NUM}\s*(?:k?cal|mg|g)?`).exec(text);
    if (after) {
      out[f] = toNumber(after[1]);
      continue;
    }
    const before = new RegExp(String.raw`${NUM}\s*(?:mg|g)?\s+(?:includes\s+)?(?:${names[f]})`).exec(text);
    if (before) out[f] = toNumber(before[1]);
  }
  const added = /includes?\.?\s*(\d+(?:\.\d+)?)\s*g\s*added/.exec(text) ?? /incl\.\s*(\d+(?:\.\d+)?)\s*g\s*added/.exec(text);
  if (added) out.addedSugars_g = Number(added[1]);
  const servings = /(\d+(?:\.\d+)?)\s*servings?\s*per/.exec(text) ?? /servings?(?: per (?:container|package))?[:\s]*(?:about\s*)?(\d+(?:\.\d+)?)/.exec(text);
  if (servings) out.servingsPerContainer = Number(servings[1]);
  const serving = /serv(?:ing|\.)\s*size[:\s]*([^\n;|/]+)/i.exec(labelText.replace(/-\n/g, ""));
  if (serving) out.servingSize = serving[1].replace(/\s+servings?.*$/i, "").trim().replace(/[;:]$/, "") || null;
  return out;
}

function mockVerdict(model: string, caseId: string, data: Extraction): string {
  const outcome = evaluateCriteria(data);
  const met = Object.values(outcome).filter(o => o === "met").length;
  const call = met === 3 ? "Buy it" : met === 2 ? "Probably fine" : "Skip it";
  const parts = CRITERIA.map(c => {
    const v = data[c.field];
    const unit = c.field === "sodium_mg" ? "mg" : "g";
    const name = c.id === "lowAddedSugar" ? "added sugar" : c.id;
    return v === null ? `${name} isn't on the label` : `${name} is ${v}${unit} (${outcome[c.id]})`;
  });
  const sentences = [`${call}: it meets ${met} of the 3 criteria.`, `Per serving, ${parts.join(", ")}.`];
  // Weaker mock models sometimes pad with a claim the numbers don't support, which the judge should penalize.
  if (seeded(`${model}|${caseId}|verdict`) < errorRate(model) * 4) sentences.push("It is also a great source of vitamins.");
  return sentences.join(" ");
}

/** Scores a verdict with simple checks: numbers it cites are in the data, sentence count, the call matches. */
function mockJudge(data: Extraction, responses: { label: string; text: string }[]) {
  const known = new Set(NUMERIC_FIELDS.flatMap(f => (data[f] === null ? [] : [String(data[f])])));
  const met = Object.values(evaluateCriteria(data)).filter(o => o === "met").length;
  return {
    scores: responses.map(r => {
      const cited = [...r.text.matchAll(/(\d+(?:\.\d+)?)\s*(?:mg|g)\b/g)].map(m => m[1]);
      const grounded = cited.every(n => known.has(n)) ? 5 : 2;
      const invented = /vitamin|mineral|organic|natural/i.test(r.text) ? 2 : 5;
      const consistent = (met === 3 && /buy/i.test(r.text)) || (met < 3 && !/^buy/i.test(r.text)) ? 5 : 2;
      const n = r.text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      const clear = n >= 2 && n <= 3 ? 5 : 3;
      const overall = Math.round((grounded + invented + consistent + clear) / 4);
      return { label: r.label, grounded, noInventedFacts: invented, criteriaConsistent: consistent, clarity: clear, overall, rationale: "mock judge (rule-based)" };
    }),
  };
}
