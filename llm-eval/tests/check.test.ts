import { describe, expect, it } from "vitest";
import { compareRuns } from "../src/check.ts";
import { renderDashboard } from "../src/dashboard.ts";
import type { RunResult } from "../src/results.ts";

function run(overall: Record<string, number>, over: Partial<RunResult> = {}): RunResult {
  const models = Object.keys(overall);
  return {
    runId: "r",
    startedAt: "",
    finishedAt: "",
    mode: "mock",
    modeReason: "test",
    models,
    promptVersion: "v1",
    caseIds: ["a"],
    extraction: Object.fromEntries(
      models.map(m => [
        m,
        {
          metrics: { cases: 1, overall: overall[m], perField: {}, perCategory: {}, perfectCases: 0, invented: { count: 0, of: 0, rate: 0 }, missed: 0, unitErrors: 0, schemaErrorCases: 0, failedCalls: 0 },
          cases: [{ caseId: "a", category: "clean", model: m, correct: 0, total: 1, schemaErrors: [], raw: "", fields: [{ field: "calories", expected: 1, actual: "<script>", correct: false, nullCheck: "ok", unitError: false }] }],
        },
      ]),
    ) as unknown as RunResult["extraction"],
    verdict: null,
    usage: { extract: {}, verdict: {}, judge: {} },
    totals: { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, costUSD: 0, fullCostUSD: 0 },
    ...over,
  };
}

describe("compareRuns", () => {
  it("fails when accuracy drops more than 3 points", () => {
    const r = compareRuns(run({ m: 0.9 }), run({ m: 0.86 }));
    expect(r.passed).toBe(false);
    expect(r.models[0].deltaPoints).toBeCloseTo(-4);
  });
  it("passes on a drop of exactly 3 points, or an improvement", () => {
    expect(compareRuns(run({ m: 0.9 }), run({ m: 0.87 })).passed).toBe(true);
    expect(compareRuns(run({ m: 0.5 }), run({ m: 0.9 })).passed).toBe(true);
  });
  it("judges each shared model separately and warns about mismatches", () => {
    const r = compareRuns(run({ a: 0.9, b: 0.9 }), run({ a: 0.9, c: 0.1 }, { mode: "real", promptVersion: "v2" }));
    expect(r.passed).toBe(true);
    expect(r.models.map(m => m.model)).toEqual(["a"]);
    expect(r.warnings.join("\n")).toMatch(/modes differ[\s\S]*prompt versions differ[\s\S]*c is new[\s\S]*b is missing/);
  });
  it("honours a custom threshold", () => {
    expect(compareRuns(run({ m: 0.9 }), run({ m: 0.86 }), 5).passed).toBe(true);
  });
});

describe("renderDashboard", () => {
  it("is self-contained and escapes model output", () => {
    const html = renderDashboard([run({ m: 0.9 })]);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=/i);
    expect(html).not.toContain("<script>\"");
    expect(html).toContain("&quot;&lt;script&gt;&quot;");
    expect(html).toContain("MOCK run");
  });
});
