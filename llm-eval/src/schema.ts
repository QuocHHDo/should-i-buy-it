import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every field the extractor must return, in a fixed order (used for tables and accuracy rows). */
export const FIELDS = [
  "servingSize",
  "servingsPerContainer",
  "calories",
  "totalFat_g",
  "satFat_g",
  "sodium_mg",
  "totalCarbs_g",
  "fiber_g",
  "sugars_g",
  "addedSugars_g",
  "protein_g",
] as const;

export type Field = (typeof FIELDS)[number];
export type NumericField = Exclude<Field, "servingSize">;
export const NUMERIC_FIELDS = FIELDS.filter((f): f is NumericField => f !== "servingSize");

export type Extraction = { servingSize: string | null } & { [K in NumericField]: number | null };

export const CATEGORIES = ["clean", "messy", "missing", "tricky", "adversarial"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface TestCase {
  id: string;
  category: Category;
  description: string;
  labelText: string;
  expected: Extraction;
}

export const SCHEMA: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(ROOT, "schema", "nutrition.schema.json"), "utf8"),
);

/** The schema minus the JSON-Schema metadata keys, in the shape structured outputs accepts. */
export function outputSchema(): Record<string, unknown> {
  const { $schema: _s, $id: _i, title: _t, ...rest } = SCHEMA;
  return rest;
}

export interface Validated {
  value: Extraction;
  /** Problems found while validating (wrong types, missing keys, unparseable JSON). Empty means schema-valid. */
  errors: string[];
}

/**
 * Validates a model reply against the schema. Lenient where a reader would be (a numeric string "12" becomes 12,
 * but is still reported as a schema error) so one formatting slip doesn't zero every field.
 */
export function validateExtraction(raw: unknown): Validated {
  const errors: string[] = [];
  const value = Object.fromEntries(FIELDS.map(f => [f, null])) as Extraction;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { value, errors: ["reply is not a JSON object"] };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!(FIELDS as readonly string[]).includes(key)) errors.push(`unexpected key ${key}`);
  for (const f of FIELDS) {
    if (!(f in obj)) {
      errors.push(`missing key ${f}`);
      continue;
    }
    const v = obj[f];
    if (v === null) continue;
    if (f === "servingSize") {
      if (typeof v === "string") value.servingSize = v;
      else errors.push(`servingSize should be a string or null`);
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) value[f] = v;
    else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      value[f] = Number(v);
      errors.push(`${f} was a string`);
    } else errors.push(`${f} should be a number or null`);
  }
  return { value, errors };
}

/** Pulls the first JSON object out of a reply that may be wrapped in prose or a ```json fence. */
export function parseJsonReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(body.slice(start, end + 1));
}
