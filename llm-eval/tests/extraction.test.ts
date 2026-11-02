import { describe, expect, it } from "vitest";
import { gradeCase, gradeField, normalizeServing, servingUnits, summarizeExtraction } from "../src/graders/extraction.ts";
import { sampleCase, truth } from "./fixtures.ts";

describe("gradeField", () => {
  it("exact numeric match", () => {
    expect(gradeField("calories", 230, 230).correct).toBe(true);
    expect(gradeField("calories", 230, 231).correct).toBe(false);
    expect(gradeField("satFat_g", 0.5, 0.5).correct).toBe(true);
  });

  it("serving size ignores case, spacing and unit spacing but not content", () => {
    expect(normalizeServing(" 2/3  Cup ( 55 g ) ")).toBe("2/3 cup (55g)");
    expect(gradeField("servingSize", "2/3 cup (55g)", "2/3 cup (55 g)").correct).toBe(true);
    expect(gradeField("servingSize", "8 fl oz (240mL)", "8 fl. oz (240 ml)").correct).toBe(true);
    expect(gradeField("servingSize", "2/3 cup (55g)", "1 cup (55g)").correct).toBe(false);
  });

  it("null handling: invented, missed, ok", () => {
    expect(gradeField("addedSugars_g", null, null)).toMatchObject({ correct: true, nullCheck: "ok" });
    expect(gradeField("addedSugars_g", null, 0)).toMatchObject({ correct: false, nullCheck: "invented" });
    expect(gradeField("fiber_g", 4, null)).toMatchObject({ correct: false, nullCheck: "missed" });
  });

  it("unit check flags mg/g and kJ/kcal slips but not ordinary misreads", () => {
    expect(gradeField("sodium_mg", 160, 0.16).unitError).toBe(true);
    expect(gradeField("protein_g", 3, 3000).unitError).toBe(true);
    expect(gradeField("calories", 140, 586).unitError).toBe(true);
    expect(gradeField("calories", 230, 231).unitError).toBe(false);
  });

  it("unit check on serving size: different units yes, truncation no", () => {
    expect(servingUnits("2/3 cup (55g)")).toEqual(["cup", "g"]);
    expect(gradeField("servingSize", "2/3 cup (55g)", "2/3 cup (55ml)").unitError).toBe(true);
    expect(gradeField("servingSize", "2/3 cup (55g)", "2").unitError).toBe(false);
  });
});

describe("gradeCase and summarizeExtraction", () => {
  it("scores a perfect extraction 11/11", () => {
    const g = gradeCase(sampleCase, "m", { ...truth });
    expect(g.correct).toBe(11);
    expect(g.total).toBe(11);
  });

  it("a failed call scores every field wrong, even ones expected to be null", () => {
    const g = gradeCase(sampleCase, "m", null, [], "API unreachable");
    expect(g.correct).toBe(0);
    expect(g.error).toBe("API unreachable");
  });

  it("aggregates overall, per-field, invented and unit errors", () => {
    const perfect = gradeCase(sampleCase, "m", { ...truth });
    const bad = gradeCase(sampleCase, "m", { ...truth, addedSugars_g: 10, sodium_mg: 0.16 });
    const m = summarizeExtraction([perfect, bad]);
    expect(m.overall).toBeCloseTo(20 / 22);
    expect(m.perField.sodium_mg).toBe(0.5);
    expect(m.perField.calories).toBe(1);
    expect(m.invented).toEqual({ count: 1, of: 2, rate: 0.5 });
    expect(m.unitErrors).toBe(1);
    expect(m.perfectCases).toBe(1);
    expect(m.perCategory.missing).toBeCloseTo(20 / 22);
  });

  it("invented-value rate leaves out failed calls", () => {
    const failed = gradeCase(sampleCase, "m", null, [], "boom");
    expect(summarizeExtraction([failed]).invented.of).toBe(0);
  });
});
