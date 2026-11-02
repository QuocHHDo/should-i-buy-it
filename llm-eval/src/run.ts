// CLI: run the eval and save results/run-<timestamp>.json.
//
//   npm run eval -- --models claude-opus-5-5 --prompt v1 --limit 10
//
// See README.md for every flag.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCases } from "./cases.ts";
import { gradeCase, summarizeExtraction } from "./graders/extraction.ts";
import { summarizeVerdicts } from "./graders/verdict.ts";
import { decideMode, MockClient, RealClient, type Effort } from "./llm.ts";
import { PRICES, costUSD } from "./pricing.ts";
import { getPrompt } from "./prompts.ts";
import { pct, RESULTS_DIR, sumUsage, usd, type RunMode, type RunResult } from "./results.ts";
import { runExtraction, runVerdicts } from "./runner.ts";
import { labelocrExtract, LABELOCR_FIELDS } from "./labelocr.ts";
import { emptyUsage, type ExtractionOutput } from "./runner.ts";
import { FIELDS, type Field } from "./schema.ts";

/** Real runs above this many (case × model) extractions need --confirm-large. */
export const MAX_UNCONFIRMED = 60;

const { values: args } = parseArgs({
  options: {
    models: { type: "string", default: "claude-opus-5-5" },
    prompt: { type: "string", default: "v1" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "5" },
    effort: { type: "string", default: "low" },
    mock: { type: "boolean", default: false },
    "no-verdict": { type: "boolean", default: false },
    "judge-model": { type: "string", default: "claude-opus-5-5" },
    "verdict-input": { type: "string", default: "expected" },
    "judge-seed": { type: "string", default: "0" },
    "confirm-large": { type: "boolean", default: false },
    extractor: { type: "string", default: "claude" },
  },
});

if (!["claude", "labelocr"].includes(args.extractor)) throw new Error("--extractor must be claude or labelocr");
/** --extractor labelocr: grade the app's own parser (js/labelocr.js). Free, no API key, no verdict stage. */
const local = args.extractor === "labelocr";
const models = local ? ["labelocr"] : [...new Set(args.models.split(",").map(s => s.trim()).filter(Boolean))];
if (!models.length) throw new Error("--models needs at least one model id");
const prompt = getPrompt(args.prompt);
const limit = args.limit === undefined ? undefined : Number(args.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
if (!["expected", "extracted"].includes(args["verdict-input"])) throw new Error("--verdict-input must be expected or extracted");
const verdictInput = args["verdict-input"] as "expected" | "extracted";
const withVerdict = !args["no-verdict"] && !local;
const judgeModel = args["judge-model"];
const concurrency = Number(args.concurrency);
const cases = loadCases().slice(0, limit);
if (!local) for (const m of [...models, ...(withVerdict ? [judgeModel] : [])]) if (!PRICES[m]) console.warn(`warning: no price entry for ${m}; its cost will show as unknown`);

const decision: { mode: RunMode; reason: string } = local
  ? { mode: "local", reason: "the app's own label parser, js/labelocr.js; no model and no API calls" }
  : await decideMode({ forceMock: args.mock, probeModel: models[0] });
const client = decision.mode === "real" ? new RealClient() : new MockClient();
const banner =
  decision.mode === "real" ? "REAL mode — calling the Anthropic API" : decision.mode === "local" ? "LOCAL mode — grading js/labelocr.js" : "MOCK mode — fake responses, no API calls";
const promptVersion = local ? "labelocr" : args.prompt;
console.log(`\n=== ${banner} (${decision.reason}) ===`);
console.log(`models: ${models.join(", ")} | prompt: ${promptVersion} | cases: ${cases.length}${local ? "" : ` | concurrency: ${concurrency}`}`);
if (withVerdict) console.log(`verdicts: on (input: ${verdictInput}, judge: ${judgeModel})`);
console.log("");

const total = cases.length * models.length;
if (decision.mode === "real") {
  if (total > MAX_UNCONFIRMED && !args["confirm-large"]) {
    console.error(`Refusing to run ${total} real extractions (> ${MAX_UNCONFIRMED}). Re-run with --confirm-large if you mean it.`);
    process.exit(2);
  }
  // Rough, before cache hits: ~4 characters per token in; a few hundred tokens out per call (JSON or prose, plus thinking).
  let est = 0;
  let unknown = false;
  const add = (m: string, inTok: number, outTok: number) => {
    const c = costUSD(m, inTok, outTok);
    if (c === null) unknown = true;
    else est += c;
  };
  for (const m of models) {
    add(m, cases.reduce((s, c) => s + Math.ceil((prompt.system.length + prompt.user(c.labelText).length) / 4) + 400, 0), cases.length * 400);
    if (withVerdict) add(m, cases.length * 450, cases.length * 300);
  }
  if (withVerdict) add(judgeModel, cases.length * (900 + 150 * models.length), cases.length * (500 + 150 * models.length));
  console.log(`estimated cost if nothing is cached: ~$${est.toFixed(4)}${unknown ? " (plus models with unknown prices)" : ""}\n`);
}

const progress = (stage: string, d: number, t: number) => {
  if (process.stdout.isTTY) process.stdout.write(`\r${stage} ${d}/${t}   ${d === t ? "\n" : ""}`);
  else if (d === t) console.log(`${stage} ${d}/${t}`);
};
const startedAt = new Date();
const flags = new Map<string, Partial<Record<Field, boolean>>>();
const ext = local
  ? {
      outputs: cases.map((c): ExtractionOutput => {
        const r = labelocrExtract(c.labelText);
        flags.set(c.id, r.flagged);
        return { caseId: c.id, model: "labelocr", raw: r.raw, extracted: r.extracted, schemaErrors: [], cached: false, inputTokens: 0, outputTokens: 0 };
      }),
      usage: { labelocr: emptyUsage() },
    }
  : await runExtraction({
  models,
  promptVersion: args.prompt,
  cases,
  client,
  concurrency,
  effort: args.effort as Effort,
  onProgress: (d, t) => progress("extraction", d, t),
});

const byId = new Map(cases.map(c => [c.id, c]));
const extraction: RunResult["extraction"] = {};
for (const m of models) {
  const graded = ext.outputs
    .filter(o => o.model === m)
    .map(o => {
      const opts = local ? { fields: LABELOCR_FIELDS, flagged: flags.get(o.caseId) } : {};
      return { ...gradeCase(byId.get(o.caseId)!, m, o.extracted, o.schemaErrors, o.error, opts), raw: o.raw };
    });
  extraction[m] = { metrics: summarizeExtraction(graded), cases: graded };
}

let verdict: RunResult["verdict"] = null;
let verdictUsage = {};
let judgeUsage = {};
if (withVerdict) {
  const v = await runVerdicts({ models, cases, extraction: ext.outputs, verdictInput, judgeModel, judgeSeed: args["judge-seed"], client, concurrency, onProgress: progress });
  verdict = {
    judgeModel,
    verdictInput,
    judgeSeed: args["judge-seed"],
    byModel: Object.fromEntries(models.map(m => [m, { metrics: summarizeVerdicts(v.results[m]), cases: v.results[m] }])),
  };
  verdictUsage = v.usage;
  judgeUsage = { [judgeModel]: v.judgeUsage };
}

const usage = { extract: ext.usage, verdict: verdictUsage, judge: judgeUsage };
const run: RunResult = {
  runId: startedAt.toISOString().replace(/[:.]/g, "-"),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  mode: decision.mode,
  modeReason: decision.reason,
  models,
  promptVersion,
  caseIds: cases.map(c => c.id),
  extraction,
  verdict,
  usage,
  totals: sumUsage([usage.extract, usage.verdict, usage.judge]),
};
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const file = path.join(RESULTS_DIR, `run-${run.runId}.json`);
fs.writeFileSync(file, JSON.stringify(run, null, 2) + "\n");

// ---- Report. -------------------------------------------------------------------------------------------------
console.log("\nExtraction accuracy");
for (const m of models) {
  const x = extraction[m].metrics;
  console.log(`  ${m}: overall ${pct(x.overall)} | perfect cases ${x.perfectCases}/${x.cases} | invented ${x.invented.count}/${x.invented.of} | unit errors ${x.unitErrors} | failed calls ${x.failedCalls}`);
  console.log(`    ${FIELDS.map(f => `${f} ${x.perField[f] === undefined ? "not graded" : pct(x.perField[f])}`).join(", ")}`);
  if (x.flags) console.log(`    wrong values flagged for checking ${x.flags.wrongFlagged}, wrong and NOT flagged ${x.flags.wrongSilent}, right but flagged ${x.flags.rightFlagged}`);
}
if (verdict) {
  console.log(`\nVerdict quality (judge ${judgeModel}, 1-5)`);
  for (const m of models) {
    const v = verdict.byModel[m].metrics;
    console.log(`  ${m}: overall ${v.meanOverall.toFixed(2)} | grounded ${v.meanBy.grounded.toFixed(2)} | no invented facts ${v.meanBy.noInventedFacts.toFixed(2)} | criteria ${v.meanBy.criteriaConsistent.toFixed(2)} | clarity ${v.meanBy.clarity.toFixed(2)} | 2-3 sentences ${pct(v.lengthOk)} | errors ${v.errors}`);
  }
}
console.log("\nTokens and cost");
for (const [stage, group] of Object.entries(usage)) {
  for (const [m, u] of Object.entries(group as RunResult["usage"]["extract"])) {
    console.log(`  ${stage.padEnd(8)} ${m.padEnd(20)} ${u.calls} calls, ${u.cacheHits} cached, ${u.inputTokens} in / ${u.outputTokens} out tokens, ${usd(u.costUSD)}`);
  }
}
const t = run.totals;
const costNote = decision.mode === "local" ? " (local parser: free)" : decision.mode === "mock" ? " (simulated: token counts are estimates and no money was spent)" : "";
console.log(`  total    ${t.calls} calls, ${t.cacheHits} cached, ${t.inputTokens} in / ${t.outputTokens} out tokens, ${usd(t.costUSD)} this run${costNote}`);
console.log(`\nMode: ${decision.mode.toUpperCase()}. Saved ${path.relative(process.cwd(), file)}`);
