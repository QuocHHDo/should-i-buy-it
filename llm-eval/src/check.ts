// CLI: regression gate. Compares the latest run with the previous comparable run (same mode, at least one model in
// common) and exits 1 if any model's overall extraction accuracy dropped by more than the threshold (default 3
// percentage points). So a parser run is checked against the last parser run, never against a mock or API run.
//
//   npm run check                 # latest vs previous
//   npm run check -- --threshold 5
import { parseArgs } from "node:util";
import { listRuns, loadRun, pct, type RunResult } from "./results.ts";

export interface ModelComparison {
  model: string;
  previous: number;
  latest: number;
  /** Change in percentage points (latest − previous). */
  deltaPoints: number;
  regressed: boolean;
}

export interface Comparison {
  models: ModelComparison[];
  warnings: string[];
  passed: boolean;
}

/** The most recent run before the last one that has the same mode and shares a model with it, if any. */
export function previousComparable(runs: RunResult[]): RunResult | undefined {
  const latest = runs[runs.length - 1];
  if (!latest) return undefined;
  return runs
    .slice(0, -1)
    .reverse()
    .find(r => r.mode === latest.mode && r.models.some(m => latest.models.includes(m)));
}

/** Compares overall accuracy for the models present in both runs. */
export function compareRuns(previous: RunResult, latest: RunResult, thresholdPoints = 3): Comparison {
  const warnings: string[] = [];
  if (previous.mode !== latest.mode) warnings.push(`modes differ (${previous.mode} → ${latest.mode}); the comparison is not like for like`);
  if (previous.promptVersion !== latest.promptVersion) warnings.push(`prompt versions differ (${previous.promptVersion} → ${latest.promptVersion})`);
  if (previous.caseIds.join() !== latest.caseIds.join()) warnings.push(`case sets differ (${previous.caseIds.length} → ${latest.caseIds.length} cases)`);
  const shared = latest.models.filter(m => previous.models.includes(m));
  for (const m of latest.models) if (!shared.includes(m)) warnings.push(`${m} is new in the latest run; nothing to compare`);
  for (const m of previous.models) if (!shared.includes(m)) warnings.push(`${m} is missing from the latest run`);
  if (!shared.length) warnings.push("no model appears in both runs");
  const models = shared.map(model => {
    const p = previous.extraction[model].metrics.overall;
    const l = latest.extraction[model].metrics.overall;
    const deltaPoints = (l - p) * 100;
    // Round to avoid flagging 3.0000000001 from floating-point noise.
    return { model, previous: p, latest: l, deltaPoints, regressed: Math.round(-deltaPoints * 1e6) / 1e6 > thresholdPoints };
  });
  return { models, warnings, passed: models.every(m => !m.regressed) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { threshold: { type: "string", default: "3" } } });
  const threshold = Number(values.threshold);
  const runs = listRuns().map(loadRun);
  const latest = runs[runs.length - 1];
  const previous = previousComparable(runs);
  if (!latest || !previous) {
    console.log(`No earlier ${latest?.mode ?? ""} run with the same model(s) in results/; nothing to compare. Passing.`);
    process.exit(0);
  }
  const result = compareRuns(previous, latest, threshold);
  console.log(`Regression check: ${latest.runId} (${latest.mode}) vs ${previous.runId} (${previous.mode}), threshold ${threshold} points`);
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  for (const m of result.models) {
    const sign = m.deltaPoints >= 0 ? "+" : "";
    console.log(`  ${m.regressed ? "FAIL" : "ok  "} ${m.model}: ${pct(m.previous)} → ${pct(m.latest)} (${sign}${m.deltaPoints.toFixed(1)} points)`);
  }
  console.log(result.passed ? "PASSED" : `FAILED: overall accuracy dropped by more than ${threshold} points`);
  process.exit(result.passed ? 0 : 1);
}
