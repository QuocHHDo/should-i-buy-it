import { CATEGORIES, FIELDS, type Category, type Extraction, type Field, type TestCase } from "../schema.ts";

/**
 * Null-handling outcome for one field:
 * - invented: the label doesn't print it (expected null) but the model returned a value — a hallucination.
 * - missed: the label prints it but the model returned null.
 * - ok: the model's null/non-null matches the label's.
 */
export type NullCheck = "ok" | "invented" | "missed";

export interface FieldResult {
  field: Field;
  expected: string | number | null;
  actual: string | number | null;
  correct: boolean;
  nullCheck: NullCheck;
  /** True when a wrong value looks like a unit slip: mg vs g (×1000), kJ for kcal (×4.184), different serving units. */
  unitError: boolean;
}

export interface CaseGrade {
  caseId: string;
  category: Category;
  model: string;
  fields: FieldResult[];
  correct: number;
  total: number;
  schemaErrors: string[];
  error?: string;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Canonical form of a serving size for exact comparison: case, spacing and "fl. oz" vs "fl oz" don't count. */
export function normalizeServing(s: string): string {
  return s
    .toLowerCase()
    .replace(/fl\.\s*oz/g, "fl oz")
    .replace(/\s+/g, " ")
    .replace(/(\d)\s+(g|mg|ml|oz|fl oz)\b/g, "$1$2")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[.\s]+$/, "")
    .trim();
}

const UNIT_WORDS = /\b(?:\d+(?:\.\d+)?\s*)(g|mg|ml|l|oz|fl oz|cups?|tbsp|tsp|slices?|bars?|cans?|pieces?|cookies?|packages?|pouch(?:es)?)\b/g;

/** The units a serving size is stated in, e.g. "2/3 cup (55g)" → ["cup", "g"]. */
export function servingUnits(s: string): string[] {
  const units = [...normalizeServing(s).matchAll(UNIT_WORDS)].map(m => m[1].replace(/(es|s)$/, ""));
  return [...new Set(units)].sort();
}

function looksLikeUnitSlip(field: Field, expected: number, actual: number): boolean {
  if (expected === 0) return false;
  const ratio = actual / expected;
  if (field === "calories") return Math.abs(ratio - 4.184) < 0.05;
  if (field.endsWith("_g") || field.endsWith("_mg")) return Math.abs(ratio - 1000) < 1 || Math.abs(ratio - 0.001) < 1e-6;
  return false;
}

export function gradeField(field: Field, expected: string | number | null, actual: string | number | null): FieldResult {
  let nullCheck: NullCheck = "ok";
  if (expected === null && actual !== null) nullCheck = "invented";
  if (expected !== null && actual === null) nullCheck = "missed";

  let correct = false;
  let unitError = false;
  if (expected === null || actual === null) correct = expected === actual;
  else if (field === "servingSize") {
    correct = typeof actual === "string" && normalizeServing(actual) === normalizeServing(String(expected));
    // A truncated answer ("3") isn't a unit slip; one stated in different units ("30 ml" for "30g") is.
    if (!correct && typeof actual === "string") {
      const got = servingUnits(actual);
      unitError = got.length > 0 && got.join() !== servingUnits(String(expected)).join();
    }
  } else {
    correct = typeof actual === "number" && close(actual, expected as number);
    if (!correct && typeof actual === "number") unitError = looksLikeUnitSlip(field, expected as number, actual);
  }
  return { field, expected, actual, correct, nullCheck, unitError };
}

/** Grades one model's output on one case. A failed or unparseable call scores every field wrong. */
export function gradeCase(c: TestCase, model: string, extracted: Extraction | null, schemaErrors: string[] = [], error?: string): CaseGrade {
  const fields = FIELDS.map(f => {
    if (!extracted) return { field: f, expected: c.expected[f], actual: null, correct: false, nullCheck: "ok" as const, unitError: false };
    return gradeField(f, c.expected[f], extracted[f]);
  });
  const correct = fields.filter(f => f.correct).length;
  return { caseId: c.id, category: c.category, model, fields, correct, total: fields.length, schemaErrors, ...(error ? { error } : {}) };
}

export interface ExtractionMetrics {
  cases: number;
  /** Share of all (case, field) pairs that were exactly right, 0–1. */
  overall: number;
  perField: Record<Field, number>;
  perCategory: Partial<Record<Category, number>>;
  /** Cases where every field was right. */
  perfectCases: number;
  /** Fields that should have been null but got a value, over all fields that should have been null. */
  invented: { count: number; of: number; rate: number };
  missed: number;
  unitErrors: number;
  schemaErrorCases: number;
  failedCalls: number;
}

export function summarizeExtraction(grades: CaseGrade[]): ExtractionMetrics {
  const all = grades.flatMap(g => g.fields);
  const rate = (rs: FieldResult[]) => (rs.length ? rs.filter(r => r.correct).length / rs.length : 0);
  const perField = Object.fromEntries(FIELDS.map(f => [f, rate(all.filter(r => r.field === f))])) as Record<Field, number>;
  const perCategory: Partial<Record<Category, number>> = {};
  for (const cat of CATEGORIES) {
    const gs = grades.filter(g => g.category === cat);
    if (gs.length) perCategory[cat] = rate(gs.flatMap(g => g.fields));
  }
  const shouldBeNull = grades.filter(g => !g.error).flatMap(g => g.fields).filter(r => r.expected === null);
  const invented = shouldBeNull.filter(r => r.nullCheck === "invented").length;
  return {
    cases: grades.length,
    overall: rate(all),
    perField,
    perCategory,
    perfectCases: grades.filter(g => g.correct === g.total).length,
    invented: { count: invented, of: shouldBeNull.length, rate: shouldBeNull.length ? invented / shouldBeNull.length : 0 },
    missed: all.filter(r => r.nullCheck === "missed").length,
    unitErrors: all.filter(r => r.unitError).length,
    schemaErrorCases: grades.filter(g => g.schemaErrors.length > 0).length,
    failedCalls: grades.filter(g => g.error).length,
  };
}
