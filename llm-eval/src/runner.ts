import { DiskCache } from "./cache.ts";
import { limiter } from "./concurrency.ts";
import { cachedCall, type CallResult, type Effort, type LlmClient } from "./llm.ts";
import { costUSD } from "./pricing.ts";
import { getPrompt } from "./prompts.ts";
import { judgeRequest, parseJudgeReply, sentenceCount, verdictRequest, type VerdictCase } from "./graders/verdict.ts";
import { outputSchema, parseJsonReply, validateExtraction, type Extraction, type TestCase } from "./schema.ts";

export interface RunOptions {
  models: string[];
  promptVersion: string;
  cases: TestCase[];
  client: LlmClient;
  cache?: DiskCache;
  concurrency?: number;
  effort?: Effort;
  onProgress?: (done: number, total: number) => void;
}

export interface ExtractionOutput {
  caseId: string;
  model: string;
  raw: string;
  extracted: Extraction | null;
  schemaErrors: string[];
  error?: string;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** Token and cost totals for one model at one stage. Cached outputs cost nothing this run but are counted separately. */
export interface UsageTotals {
  calls: number;
  cacheHits: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  /** Spent this run (API calls only, not cache hits). Null when the model has no price entry. */
  costUSD: number | null;
  /** What all outputs in this run would cost uncached. */
  fullCostUSD: number | null;
}

export function emptyUsage(): UsageTotals {
  return { calls: 0, cacheHits: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUSD: 0, fullCostUSD: 0 };
}

export function addUsage(t: UsageTotals, model: string, r: Pick<CallResult, "cached" | "usage" | "error">): void {
  const cost = costUSD(model, r.usage.inputTokens, r.usage.outputTokens);
  t.fullCostUSD = cost === null || t.fullCostUSD === null ? null : t.fullCostUSD + cost;
  if (r.error) t.errors++;
  if (r.cached) {
    t.cacheHits++;
    return;
  }
  t.calls++;
  t.inputTokens += r.usage.inputTokens;
  t.outputTokens += r.usage.outputTokens;
  t.costUSD = cost === null || t.costUSD === null ? null : t.costUSD + cost;
}

/** Runs every (model, case) extraction, at most `concurrency` at once, through the cache. */
export async function runExtraction(opts: RunOptions): Promise<{ outputs: ExtractionOutput[]; usage: Record<string, UsageTotals> }> {
  const prompt = getPrompt(opts.promptVersion);
  const cache = opts.cache ?? new DiskCache();
  const limit = limiter(opts.concurrency ?? 5);
  const usage: Record<string, UsageTotals> = Object.fromEntries(opts.models.map(m => [m, emptyUsage()]));
  const jobs = opts.models.flatMap(model => opts.cases.map(c => ({ model, c })));
  let done = 0;
  const outputs = await Promise.all(
    jobs.map(({ model, c }) =>
      limit(async (): Promise<ExtractionOutput> => {
        const res = await cachedCall(
          opts.client,
          cache,
          {
            stage: "extract",
            model,
            system: prompt.system,
            user: prompt.user(c.labelText),
            maxTokens: 4000,
            effort: opts.effort ?? "low",
            jsonSchema: outputSchema(),
            mock: { kind: "extract", caseId: c.id, labelText: c.labelText },
          },
          { stage: "extract", model, promptVersion: opts.promptVersion, caseId: c.id },
        );
        addUsage(usage[model], model, res);
        opts.onProgress?.(++done, jobs.length);
        const base = { caseId: c.id, model, raw: res.text, cached: res.cached, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens };
        if (res.error) return { ...base, extracted: null, schemaErrors: [], error: res.error };
        try {
          const { value, errors } = validateExtraction(parseJsonReply(res.text));
          return { ...base, extracted: value, schemaErrors: errors };
        } catch (err) {
          return { ...base, extracted: null, schemaErrors: [], error: `unparseable reply: ${(err as Error).message}` };
        }
      }),
    ),
  );
  return { outputs, usage };
}

export interface VerdictRunOptions {
  models: string[];
  cases: TestCase[];
  extraction: ExtractionOutput[];
  /** "expected": every model writes from the ground truth, so verdicts compare like with like (default).
   *  "extracted": each model writes from its own extraction, so extraction errors carry through. */
  verdictInput: "expected" | "extracted";
  judgeModel: string;
  judgeSeed: string;
  client: LlmClient;
  cache?: DiskCache;
  concurrency?: number;
  onProgress?: (stage: string, done: number, total: number) => void;
}

/** Verdict stage: each model writes a verdict per case, then the judge scores them (shuffled) per case. */
export async function runVerdicts(opts: VerdictRunOptions) {
  const cache = opts.cache ?? new DiskCache();
  const limit = limiter(opts.concurrency ?? 5);
  const usage: Record<string, UsageTotals> = Object.fromEntries(opts.models.map(m => [m, emptyUsage()]));
  const judgeUsage = emptyUsage();
  const byKey = new Map(opts.extraction.map(o => [`${o.model}|${o.caseId}`, o]));
  const results: Record<string, VerdictCase[]> = Object.fromEntries(opts.models.map(m => [m, []]));

  type Job = { model: string; c: TestCase; data: Extraction | null };
  const jobs: Job[] = opts.models.flatMap(model =>
    opts.cases.map(c => ({ model, c, data: opts.verdictInput === "expected" ? c.expected : (byKey.get(`${model}|${c.id}`)?.extracted ?? null) })),
  );
  let done = 0;
  const written = await Promise.all(
    jobs.map(job =>
      limit(async () => {
        if (!job.data) return { ...job, vc: { caseId: job.c.id, text: "", sentences: 0, error: "no extraction to write a verdict from" } as VerdictCase };
        const res = await cachedCall(opts.client, cache, verdictRequest(job.model, job.c.id, job.data), {
          stage: "verdict",
          model: job.model,
          promptVersion: "verdict-v1",
          caseId: job.c.id,
        });
        addUsage(usage[job.model], job.model, res);
        opts.onProgress?.("verdicts", ++done, jobs.length);
        const text = res.text.trim();
        return { ...job, vc: { caseId: job.c.id, text, sentences: sentenceCount(text), ...(res.error ? { error: res.error } : {}) } as VerdictCase };
      }),
    ),
  );

  // One judge call per case and distinct input data (one per case when verdictInput is "expected").
  const groups = new Map<string, typeof written>();
  for (const w of written) {
    if (!w.data || w.vc.error) continue;
    const key = `${w.c.id}|${JSON.stringify(w.data)}`;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  let judged = 0;
  await Promise.all(
    [...groups.values()].map(group =>
      limit(async () => {
        const { c, data } = group[0];
        const { req, labels } = judgeRequest(opts.judgeModel, c.id, data!, group.map(g => ({ model: g.model, text: g.vc.text })), opts.judgeSeed);
        const res = await cachedCall(opts.client, cache, req, {
          stage: "judge",
          model: opts.judgeModel,
          promptVersion: `judge-v1-${opts.verdictInput}`,
          caseId: c.id,
        });
        addUsage(judgeUsage, opts.judgeModel, res);
        opts.onProgress?.("judging", ++judged, groups.size);
        const slots = Object.fromEntries(Object.entries(labels).map(([label, model]) => [model, label.charCodeAt(0) - 64]));
        try {
          if (res.error) throw new Error(res.error);
          const scores = parseJudgeReply(res.text, labels);
          for (const g of group) {
            g.vc.score = scores[g.model];
            g.vc.position = { slot: slots[g.model], of: group.length };
          }
        } catch (err) {
          for (const g of group) g.vc.error = `judge: ${(err as Error).message}`;
        }
      }),
    ),
  );
  for (const w of written) results[w.model].push(w.vc);
  return { results, usage, judgeUsage };
}
