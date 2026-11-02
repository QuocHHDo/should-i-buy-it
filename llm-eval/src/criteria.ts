import type { Extraction } from "./schema.ts";

/** The fixed example criteria the verdict stage judges a product against. All per serving. */
export const CRITERIA = [
  { id: "lowAddedSugar", text: "Low added sugar: 5 g or less of added sugars per serving", field: "addedSugars_g", test: (v: number) => v <= 5 },
  { id: "sodium", text: "Sodium under 600 mg per serving", field: "sodium_mg", test: (v: number) => v < 600 },
  { id: "protein", text: "Protein over 10 g per serving", field: "protein_g", test: (v: number) => v > 10 },
] as const;

export type CriterionOutcome = "met" | "not met" | "unknown";

/** Checks the criteria in code, so the judge has the right answer to compare a verdict against. */
export function evaluateCriteria(data: Extraction): Record<string, CriterionOutcome> {
  return Object.fromEntries(
    CRITERIA.map(c => {
      const v = data[c.field];
      return [c.id, v === null ? "unknown" : c.test(v) ? "met" : "not met"];
    }),
  );
}

export const CRITERIA_TEXT = CRITERIA.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
