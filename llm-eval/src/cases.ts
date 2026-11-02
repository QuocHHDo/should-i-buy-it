import fs from "node:fs";
import path from "node:path";
import { CATEGORIES, FIELDS, ROOT, type TestCase } from "./schema.ts";

export const CASES_DIR = path.join(ROOT, "cases");

/** Loads every case, sorted by id within the category order clean → messy → missing → tricky → adversarial. */
export function loadCases(dir = CASES_DIR): TestCase[] {
  const cases = fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as TestCase);
  for (const c of cases) assertCase(c);
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return cases.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.id.localeCompare(b.id));
}

export function assertCase(c: TestCase): void {
  if (!c.id || !c.labelText) throw new Error(`case ${c.id ?? "?"} needs id and labelText`);
  if (!CATEGORIES.includes(c.category)) throw new Error(`case ${c.id}: unknown category ${c.category}`);
  for (const f of FIELDS) {
    if (!(f in c.expected)) throw new Error(`case ${c.id}: expected.${f} missing (use null for "not on the label")`);
    const v = c.expected[f];
    if (v !== null && typeof v !== (f === "servingSize" ? "string" : "number")) throw new Error(`case ${c.id}: expected.${f} has the wrong type`);
  }
}
