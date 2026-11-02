import fs from "node:fs";
import path from "node:path";
import type { CaseGrade, ExtractionMetrics } from "./graders/extraction.ts";
import type { VerdictCase, VerdictMetrics } from "./graders/verdict.ts";
import type { Mode } from "./llm.ts";
import type { UsageTotals } from "./runner.ts";
import { ROOT } from "./schema.ts";

export const RESULTS_DIR = path.join(ROOT, "results");

/** "local" = the app's own parser (js/labelocr.js) was graded; no model was called. */
export type RunMode = Mode | "local";

/** One saved run: results/run-<runId>.json. */
export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: RunMode;
  modeReason: string;
  models: string[];
  promptVersion: string;
  caseIds: string[];
  extraction: Record<string, { metrics: ExtractionMetrics; cases: (CaseGrade & { raw: string })[] }>;
  verdict: null | {
    judgeModel: string;
    verdictInput: "expected" | "extracted";
    judgeSeed: string;
    byModel: Record<string, { metrics: VerdictMetrics; cases: VerdictCase[] }>;
  };
  usage: {
    extract: Record<string, UsageTotals>;
    verdict: Record<string, UsageTotals>;
    judge: Record<string, UsageTotals>;
  };
  totals: { calls: number; cacheHits: number; inputTokens: number; outputTokens: number; costUSD: number | null; fullCostUSD: number | null };
}

/** Every saved run, oldest first (run ids are ISO timestamps, so name order is time order). */
export function listRuns(dir = RESULTS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => /^run-.*\.json$/.test(f))
    .sort()
    .map(f => path.join(dir, f));
}

export function loadRun(file: string): RunResult {
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunResult;
}

export function sumUsage(groups: Record<string, UsageTotals>[]): RunResult["totals"] {
  const all = groups.flatMap(g => Object.values(g));
  const add = (k: "costUSD" | "fullCostUSD") => (all.some(u => u[k] === null) ? null : all.reduce((s, u) => s + (u[k] ?? 0), 0));
  return {
    calls: all.reduce((s, u) => s + u.calls, 0),
    cacheHits: all.reduce((s, u) => s + u.cacheHits, 0),
    inputTokens: all.reduce((s, u) => s + u.inputTokens, 0),
    outputTokens: all.reduce((s, u) => s + u.outputTokens, 0),
    costUSD: add("costUSD"),
    fullCostUSD: add("fullCostUSD"),
  };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const usd = (x: number | null) => (x === null ? "unknown" : `$${x.toFixed(4)}`);
