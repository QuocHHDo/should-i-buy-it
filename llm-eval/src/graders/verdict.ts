import { CRITERIA_TEXT, evaluateCriteria } from "../criteria.ts";
import type { LlmRequest } from "../llm.ts";
import { seeded } from "../mock.ts";
import { parseJsonReply, type Extraction } from "../schema.ts";

// ---- Stage 1: the model under test writes a verdict. -----------------------------------------------------------

export const VERDICT_SYSTEM = `You help a shopper decide whether to buy a food. You get the per-serving numbers from its nutrition label and the shopper's criteria. Write a 2-3 sentence verdict in plain language: lead with the recommendation, then cite the numbers that decide it. Use only the numbers given. If a number needed for a criterion is null (not on the label), say it is unknown rather than guessing.`;

export function verdictRequest(model: string, caseId: string, data: Extraction): LlmRequest {
  return {
    stage: "verdict",
    model,
    system: VERDICT_SYSTEM,
    user: `Shopper's criteria:\n${CRITERIA_TEXT}\n\nNutrition data (per serving, JSON):\n${JSON.stringify(data, null, 2)}\n\nWrite the verdict.`,
    maxTokens: 2000,
    effort: "low",
    mock: { kind: "verdict", caseId, data },
  };
}

/** Counts sentences, a cheap deterministic check on the "2-3 sentences" instruction alongside the judge. */
export function sentenceCount(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .filter(s => /[A-Za-z]/.test(s)).length;
}

// ---- Stage 2: an LLM judge scores verdicts against a written rubric. --------------------------------------------

export const RUBRIC = `Score each response from 1 (poor) to 5 (excellent) on four dimensions, then give an overall score.

grounded — Every number it cites matches the nutrition data exactly, and it cites the numbers that decide the criteria.
  5: all cited numbers correct and the deciding ones present. 3: correct but vague, or one deciding number missing. 1: a cited number is wrong, or no numbers.
noInventedFacts — It says nothing the data doesn't support: no vitamins, ingredients, health claims, or values not in the data.
  5: nothing invented. 3: one mild unsupported generalization. 1: an invented number or fact.
criteriaConsistent — Its conclusion agrees with the CHECKED OUTCOMES (computed in code from the same data). A criterion whose number is null must be called unknown, not met or failed.
  5: fully consistent. 3: right overall call but misstates one criterion. 1: contradicts the outcomes.
clarity — 2-3 plain sentences, recommendation first, easy for a shopper to act on.
  5: clear and the right length. 3: understandable but wordy, hedged or the wrong length. 1: confusing.
overall — Your holistic score. A response that invents a number or contradicts the checked outcomes cannot score above 2.

Judge each response on its own merits against the rubric. The order responses appear in is random and means nothing; do not favor a position or a longer answer.`;

const SCORE = { type: "integer", enum: [1, 2, 3, 4, 5] };
export const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "grounded", "noInventedFacts", "criteriaConsistent", "clarity", "overall", "rationale"],
        properties: {
          label: { type: "string" },
          rationale: { type: "string" },
          grounded: SCORE,
          noInventedFacts: SCORE,
          criteriaConsistent: SCORE,
          clarity: SCORE,
          overall: SCORE,
        },
      },
    },
  },
};

export interface JudgeScore {
  grounded: number;
  noInventedFacts: number;
  criteriaConsistent: number;
  clarity: number;
  overall: number;
  rationale: string;
}

/** Deterministic Fisher–Yates shuffle driven by a string seed, so a given run's order can be reproduced. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(seeded(`${seed}|${i}`) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface JudgeItem {
  model: string;
  text: string;
}

/**
 * Builds one judge call over several models' verdicts for the same case and data. Responses are shuffled (seeded by
 * case and seed) and labelled A, B, C… so the judge can't tell which model wrote which, and no model always sits in
 * the first slot. Returns the request and the label → model map needed to undo the shuffle.
 */
export function judgeRequest(judgeModel: string, caseId: string, data: Extraction, items: JudgeItem[], seed: string) {
  const order = seededShuffle(items, `${seed}|${caseId}`);
  const labelled = order.map((it, i) => ({ label: String.fromCharCode(65 + i), ...it }));
  const outcomes = evaluateCriteria(data);
  const req: LlmRequest = {
    stage: "judge",
    model: judgeModel,
    system: `You are a strict evaluator of short food-buying verdicts.\n\n${RUBRIC}`,
    user: [
      `Shopper's criteria:\n${CRITERIA_TEXT}`,
      `Nutrition data the writer was given (per serving):\n${JSON.stringify(data, null, 2)}`,
      `CHECKED OUTCOMES: ${Object.entries(outcomes).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
      ...labelled.map(l => `<response label="${l.label}">\n${l.text}\n</response>`),
      `Score every response. Return one entry per label.`,
    ].join("\n\n"),
    maxTokens: 4000,
    effort: "medium",
    jsonSchema: JUDGE_SCHEMA,
    mock: { kind: "judge", caseId, data, responses: labelled.map(l => ({ label: l.label, text: l.text })) },
  };
  return { req, labels: Object.fromEntries(labelled.map(l => [l.label, l.model])) as Record<string, string> };
}

/** Maps the judge's reply back to models. Throws if a label is missing or a score is out of range. */
export function parseJudgeReply(text: string, labels: Record<string, string>): Record<string, JudgeScore> {
  const raw = parseJsonReply(text) as { scores?: (JudgeScore & { label: string })[] };
  const out: Record<string, JudgeScore> = {};
  for (const s of raw.scores ?? []) {
    const model = labels[s.label];
    if (!model) continue;
    for (const k of ["grounded", "noInventedFacts", "criteriaConsistent", "clarity", "overall"] as const) {
      if (!Number.isInteger(s[k]) || s[k] < 1 || s[k] > 5) throw new Error(`judge gave ${k}=${s[k]} for ${s.label}`);
    }
    const { label: _l, ...score } = s;
    out[model] = score;
  }
  for (const [label, model] of Object.entries(labels)) if (!out[model]) throw new Error(`judge skipped response ${label}`);
  return out;
}

export interface VerdictCase {
  caseId: string;
  text: string;
  sentences: number;
  /** 1-based slot the verdict occupied in the judge prompt, and how many verdicts were in that prompt. */
  position?: { slot: number; of: number };
  score?: JudgeScore;
  error?: string;
}

export interface VerdictMetrics {
  judged: number;
  meanOverall: number;
  meanBy: Record<"grounded" | "noInventedFacts" | "criteriaConsistent" | "clarity", number>;
  /** Share of verdicts with 2-3 sentences (counted in code). */
  lengthOk: number;
  errors: number;
}

export function summarizeVerdicts(cases: VerdictCase[]): VerdictMetrics {
  const scored = cases.filter(c => c.score);
  const mean = (k: keyof Omit<JudgeScore, "rationale">) => (scored.length ? scored.reduce((s, c) => s + c.score![k], 0) / scored.length : 0);
  const written = cases.filter(c => c.text);
  return {
    judged: scored.length,
    meanOverall: mean("overall"),
    meanBy: { grounded: mean("grounded"), noInventedFacts: mean("noInventedFacts"), criteriaConsistent: mean("criteriaConsistent"), clarity: mean("clarity") },
    lengthOk: written.length ? written.filter(c => c.sentences >= 2 && c.sentences <= 3).length / written.length : 0,
    errors: cases.filter(c => c.error).length,
  };
}
