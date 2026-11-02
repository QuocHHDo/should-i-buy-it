import { describe, expect, it } from "vitest";
import { loadCases } from "../src/cases.ts";
import { heuristicExtract } from "../src/mock.ts";
import { CATEGORIES, FIELDS, parseJsonReply, validateExtraction } from "../src/schema.ts";
import { truth } from "./fixtures.ts";

describe("validateExtraction", () => {
  it("accepts a schema-valid object", () => {
    expect(validateExtraction(truth)).toEqual({ value: truth, errors: [] });
  });
  it("coerces numeric strings but reports them, and flags missing or extra keys", () => {
    const { value, errors } = validateExtraction({ ...truth, calories: "230", extra: 1, protein_g: undefined });
    expect(value.calories).toBe(230);
    expect(errors).toEqual(expect.arrayContaining(["calories was a string", "unexpected key extra"]));
  });
  it("parses JSON wrapped in prose or a code fence", () => {
    expect(parseJsonReply('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonReply("no json")).toThrow();
  });
});

describe("test set", () => {
  const cases = loadCases();
  it("has 60 cases in the planned mix", () => {
    const count = (c: string) => cases.filter(x => x.category === c).length;
    expect(cases).toHaveLength(60);
    expect(CATEGORIES.map(count)).toEqual([20, 15, 10, 10, 5]);
  });
  it("every missing-field case expects at least one null", () => {
    for (const c of cases.filter(x => x.category === "missing")) expect(FIELDS.some(f => c.expected[f] === null)).toBe(true);
  });
  it("the mock's regex reader gets every clean case right (sanity check of the clean ground truth)", () => {
    for (const c of cases.filter(x => x.category === "clean")) expect(heuristicExtract(c.labelText)).toEqual(c.expected);
  });
});
