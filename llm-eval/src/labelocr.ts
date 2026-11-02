// Adapter for the app's own label parser, js/labelocr.js: the code that turns OCR text from a label photo into
// numbers. Running it on the test set costs nothing and needs no API key.
import { createRequire } from "node:module";
import path from "node:path";
import { FIELDS, ROOT, type Extraction, type Field } from "./schema.ts";

const require = createRequire(import.meta.url);
export const LABELOCR_PATH = path.join(ROOT, "..", "js", "labelocr.js");

interface ParseResult {
  values: Record<string, number | undefined>;
  how: Record<string, string | number | undefined>;
  serving: string;
}
const L = require(LABELOCR_PATH) as { parse: (text: string) => ParseResult };

/** labelocr.js key → schema field. It doesn't read servings per container, so that field isn't graded. */
const MAP: Partial<Record<Field, string>> = {
  calories: "cal",
  totalFat_g: "fat",
  satFat_g: "sat",
  sodium_mg: "na",
  totalCarbs_g: "carb",
  fiber_g: "fib",
  sugars_g: "sug",
  addedSugars_g: "add",
  protein_g: "pro",
};
export const LABELOCR_FIELDS: Field[] = FIELDS.filter(f => f !== "servingsPerContainer");

export interface LocalExtraction {
  extracted: Extraction;
  /** Values the app would show with a "check it" note (corrected, worked out from %DV, or contradicted by the label). */
  flagged: Partial<Record<Field, boolean>>;
  raw: string;
}

export function labelocrExtract(labelText: string): LocalExtraction {
  const r = L.parse(labelText);
  const extracted = Object.fromEntries(FIELDS.map(f => [f, null])) as Extraction;
  const flagged: Partial<Record<Field, boolean>> = { servingSize: false };
  extracted.servingSize = r.serving || null;
  for (const [field, key] of Object.entries(MAP) as [Exclude<Field, "servingSize">, string][]) {
    const v = r.values[key];
    extracted[field] = typeof v === "number" ? v : null;
    flagged[field] = v != null && r.how[key] !== "read";
  }
  return { extracted, flagged, raw: JSON.stringify({ values: r.values, how: r.how, serving: r.serving }) };
}
