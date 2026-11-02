import { describe, expect, it } from "vitest";
import { evaluateCriteria } from "../src/criteria.ts";
import { judgeRequest, parseJudgeReply, seededShuffle, sentenceCount, summarizeVerdicts } from "../src/graders/verdict.ts";
import { truth } from "./fixtures.ts";

const items = ["opus", "sonnet", "haiku"].map((model, i) => ({ model, text: `Verdict number ${i}. Buy it.` }));
const score = (label: string, overall = 4) => ({ label, grounded: 5, noInventedFacts: 5, criteriaConsistent: 4, clarity: 4, overall, rationale: "r" });

describe("criteria", () => {
  it("evaluates met / not met / unknown in code", () => {
    expect(evaluateCriteria(truth)).toEqual({ lowAddedSugar: "unknown", sodium: "met", protein: "not met" });
    expect(evaluateCriteria({ ...truth, addedSugars_g: 5, sodium_mg: 600, protein_g: 10.5 })).toEqual({ lowAddedSugar: "met", sodium: "not met", protein: "met" });
  });
});

describe("position-bias randomization", () => {
  it("seededShuffle is a deterministic permutation", () => {
    const a = seededShuffle([1, 2, 3, 4, 5], "s");
    expect(seededShuffle([1, 2, 3, 4, 5], "s")).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("no model always lands in slot A across cases", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 30; i++) firsts.add(judgeRequest("judge", `case-${i}`, truth, items, "0").labels.A);
    expect(firsts.size).toBe(3);
  });

  it("the judge prompt hides model names and includes the checked outcomes", () => {
    const { req, labels } = judgeRequest("judge", "c1", truth, items, "0");
    expect(Object.keys(labels)).toEqual(["A", "B", "C"]);
    expect(req.user).toContain("CHECKED OUTCOMES: lowAddedSugar: unknown; sodium: met; protein: not met");
    expect(req.user).not.toMatch(/opus|sonnet|haiku/);
    expect(req.jsonSchema).toBeDefined();
  });
});

describe("parseJudgeReply", () => {
  const labels = { A: "haiku", B: "opus" };
  it("maps shuffled labels back to models", () => {
    const out = parseJudgeReply(JSON.stringify({ scores: [score("B", 5), score("A", 2)] }), labels);
    expect(out.opus.overall).toBe(5);
    expect(out.haiku.overall).toBe(2);
  });
  it("rejects a skipped response or an out-of-range score", () => {
    expect(() => parseJudgeReply(JSON.stringify({ scores: [score("A")] }), labels)).toThrow(/skipped response B/);
    expect(() => parseJudgeReply(JSON.stringify({ scores: [score("A", 7), score("B")] }), labels)).toThrow(/overall=7/);
  });
});

describe("verdict metrics", () => {
  it("counts sentences", () => {
    expect(sentenceCount("Buy it. Sodium is 160mg and protein 3g. Added sugar is unknown.")).toBe(3);
    expect(sentenceCount("Skip it: 1,580mg sodium is 2.5 times the limit.")).toBe(1);
  });
  it("averages judge scores and length compliance", () => {
    const m = summarizeVerdicts([
      { caseId: "a", text: "One. Two.", sentences: 2, score: { ...score("A", 4) } },
      { caseId: "b", text: "One.", sentences: 1, score: { ...score("B", 2) } },
      { caseId: "c", text: "", sentences: 0, error: "refused" },
    ]);
    expect(m.meanOverall).toBe(3);
    expect(m.lengthOk).toBe(0.5);
    expect(m.judged).toBe(2);
    expect(m.errors).toBe(1);
  });
});
