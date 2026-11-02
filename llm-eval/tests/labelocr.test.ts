import { describe, expect, it } from "vitest";
import { previousComparable } from "../src/check.ts";
import { gradeCase, summarizeExtraction } from "../src/graders/extraction.ts";
import { labelocrExtract, LABELOCR_FIELDS } from "../src/labelocr.ts";
import type { RunResult } from "../src/results.ts";
import { sampleCase, truth } from "./fixtures.ts";

describe("labelocr adapter", () => {
  it("maps the app parser's output onto the schema", () => {
    const { extracted, flagged } = labelocrExtract(sampleCase.labelText);
    expect(extracted).toMatchObject({ calories: 230, totalFat_g: 8, satFat_g: 1, sodium_mg: 160, totalCarbs_g: 37, fiber_g: 4, sugars_g: 12, protein_g: 3, addedSugars_g: null });
    expect(extracted.servingsPerContainer).toBeNull();
    expect(flagged.calories).toBe(false);
  });

  it("marks values the app would show with a check-it note", () => {
    // "0.59" is an OCR slip for 0.5g (no label prints 0.59 g): the parser corrects it and marks it.
    const { extracted, flagged } = labelocrExtract("Nutrition Facts\nCalories 100\nTotal Fat 3g\nSaturated Fat 0.59\nProtein 3g");
    expect(extracted.satFat_g).toBe(0.5);
    expect(flagged.satFat_g).toBe(true);
    expect(flagged.totalFat_g).toBe(false);
  });

  it("does not grade servings per container, which the parser never reads", () => {
    expect(LABELOCR_FIELDS).not.toContain("servingsPerContainer");
    const { extracted, flagged } = labelocrExtract(sampleCase.labelText);
    const g = gradeCase(sampleCase, "labelocr", extracted, [], undefined, { fields: LABELOCR_FIELDS, flagged });
    expect(g.total).toBe(10);
    expect(g.correct).toBe(10);
    expect(summarizeExtraction([g]).perField.servingsPerContainer).toBeUndefined();
  });
});

describe("flag metrics", () => {
  it("splits wrong values into flagged and silent, and counts missing values as flagged", () => {
    const g = gradeCase(sampleCase, "labelocr", { ...truth, calories: 999, sodium_mg: 1, protein_g: null, fiber_g: 4 }, [], undefined, {
      flagged: { calories: true, sodium_mg: false, fiber_g: true },
    });
    expect(summarizeExtraction([g]).flags).toEqual({ wrongFlagged: 2, wrongSilent: 1, rightFlagged: 1 });
  });

  it("is absent for extractors that don't flag", () => {
    expect(summarizeExtraction([gradeCase(sampleCase, "m", { ...truth })]).flags).toBeUndefined();
  });
});

describe("previousComparable", () => {
  const run = (runId: string, mode: RunResult["mode"], models: string[]) => ({ runId, mode, models }) as RunResult;
  it("skips runs of a different mode or with no model in common", () => {
    const runs = [run("1", "local", ["labelocr"]), run("2", "mock", ["claude-opus-5-5"]), run("3", "local", ["labelocr"])];
    expect(previousComparable(runs)?.runId).toBe("1");
    expect(previousComparable([run("1", "mock", ["a"]), run("2", "local", ["labelocr"])])).toBeUndefined();
  });
});
