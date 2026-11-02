// CLI: run the eval and save results/run-<timestamp>.json.
//
//   npm run eval -- --models claude-opus-5-5 --prompt v1 --limit 10
//
// See README.md for every flag.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCases } from "./cases.ts";
import { decideMode, MockClient, RealClient, type Effort } from "./llm.ts";
import { PRICES, costUSD } from "./pricing.ts";
import { getPrompt } from "./prompts.ts";
import { runExtraction } from "./runner.ts";
import { ROOT } from "./schema.ts";

export const RESULTS_DIR = path.join(ROOT, "results");
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
    "confirm-large": { type: "boolean", default: false },
  },
});

const models = args.models.split(",").map(s => s.trim()).filter(Boolean);
getPrompt(args.prompt); // fail fast on an unknown version
const limit = args.limit === undefined ? undefined : Number(args.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
const cases = loadCases().slice(0, limit);
for (const m of models) if (!PRICES[m]) console.warn(`warning: no price entry for ${m}; its cost will show as unknown`);

const decision = await decideMode({ forceMock: args.mock, probeModel: models[0] });
const client = decision.mode === "real" ? new RealClient() : new MockClient();
const banner = decision.mode === "real" ? "REAL mode — calling the Anthropic API" : "MOCK mode — fake responses, no API calls";
console.log(`\n=== ${banner} (${decision.reason}) ===`);
console.log(`models: ${models.join(", ")} | prompt: ${args.prompt} | cases: ${cases.length} | concurrency: ${args.concurrency}\n`);

const total = cases.length * models.length;
if (decision.mode === "real") {
  if (total > MAX_UNCONFIRMED && !args["confirm-large"]) {
    console.error(`Refusing to run ${total} real extractions (> ${MAX_UNCONFIRMED}). Re-run with --confirm-large if you mean it.`);
    process.exit(2);
  }
  // Rough pre-run estimate: ~4 characters per token in, a few hundred tokens out (JSON plus some thinking).
  const prompt = getPrompt(args.prompt);
  for (const m of models) {
    const inTok = cases.reduce((s, c) => s + Math.ceil((prompt.system.length + prompt.user(c.labelText).length) / 4) + 400, 0);
    const est = costUSD(m, inTok, cases.length * 400);
    console.log(`estimated extraction cost for ${m}: ${est === null ? "unknown" : `~$${est.toFixed(4)}`} (before cache hits)`);
  }
}

const startedAt = new Date();
const { outputs, usage } = await runExtraction({
  models,
  promptVersion: args.prompt,
  cases,
  client,
  concurrency: Number(args.concurrency),
  effort: args.effort as Effort,
  onProgress: (d, t) => process.stdout.write(`\rextraction ${d}/${t}`),
});
process.stdout.write("\n");

const run = {
  runId: startedAt.toISOString().replace(/[:.]/g, "-"),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  mode: decision.mode,
  modeReason: decision.reason,
  models,
  promptVersion: args.prompt,
  caseIds: cases.map(c => c.id),
  usage,
  outputs,
};
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const file = path.join(RESULTS_DIR, `run-${run.runId}.json`);
fs.writeFileSync(file, JSON.stringify(run, null, 2) + "\n");

for (const m of models) {
  const u = usage[m];
  console.log(`${m}: ${u.calls} model calls, ${u.cacheHits} cache hits, ${u.errors} errors, ${u.inputTokens} in / ${u.outputTokens} out tokens`);
}
console.log(`\nMode: ${decision.mode.toUpperCase()}. Saved ${path.relative(process.cwd(), file)}`);
