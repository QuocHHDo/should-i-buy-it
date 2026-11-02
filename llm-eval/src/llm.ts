import Anthropic from "@anthropic-ai/sdk";
import type { CacheKey, DiskCache } from "./cache.ts";
import { mockRespond, type MockHint } from "./mock.ts";

export type Mode = "real" | "mock";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface LlmRequest {
  stage: "extract" | "verdict" | "judge";
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  effort?: Effort;
  /** JSON schema for structured outputs; the reply text is then guaranteed to be JSON matching it. */
  jsonSchema?: Record<string, unknown>;
  /** What the mock needs to fake an answer. Never sent to the API. */
  mock: MockHint;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  text: string;
  stopReason: string;
  usage: Usage;
  /** Set when the call failed after retries; text is then empty. */
  error?: string;
}

export interface LlmClient {
  mode: Mode;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// Models that reject output_config.effort. Everything newer accepts it.
const NO_EFFORT = new Set(["claude-haiku-4-5", "claude-sonnet-4-5"]);

export class RealClient implements LlmClient {
  readonly mode = "real" as const;
  constructor(private readonly client: Anthropic = new Anthropic({ maxRetries: 3 })) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const outputConfig: Anthropic.OutputConfig = {};
    if (req.effort && !NO_EFFORT.has(req.model)) outputConfig.effort = req.effort;
    if (req.jsonSchema) outputConfig.format = { type: "json_schema", schema: req.jsonSchema };
    try {
      // No `fallbacks` on purpose: an eval must score the model it names, not whichever model answered instead.
      // A refusal is recorded as a failed case.
      const res = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      });
      const text = res.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      if (res.stop_reason === "refusal") return { text: "", stopReason: "refusal", usage, error: `refused (${res.stop_details?.category ?? "no category"})` };
      if (res.stop_reason === "max_tokens") return { text, stopReason: "max_tokens", usage, error: "hit max_tokens" };
      return { text, stopReason: res.stop_reason ?? "unknown", usage };
    } catch (err) {
      return { text: "", stopReason: "error", usage: { inputTokens: 0, outputTokens: 0 }, error: describeError(err) };
    }
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.BadRequestError) return `bad request: ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return "authentication failed (check ANTHROPIC_API_KEY)";
  if (err instanceof Anthropic.NotFoundError) return `not found (unknown model?): ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return "rate limited after retries";
  if (err instanceof Anthropic.APIConnectionError) return "API unreachable";
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export class MockClient implements LlmClient {
  readonly mode = "mock" as const;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const text = mockRespond(req.model, req.mock);
    // Token counts are estimates (about 4 characters per token) so the cost columns still exercise end to end.
    const est = (s: string) => Math.ceil(s.length / 4);
    return { text, stopReason: "end_turn", usage: { inputTokens: est(req.system + req.user), outputTokens: est(text) } };
  }
}

export interface ModeDecision {
  mode: Mode;
  reason: string;
}

/**
 * Real mode needs ANTHROPIC_API_KEY and a reachable API. Missing key or no connection → mock, with the reason.
 * A key the API rejects, or a model it doesn't know, is a configuration error and stops the run instead:
 * silently swapping in fake answers there would hide the mistake.
 */
export async function decideMode(opts: { forceMock: boolean; probeModel: string; client?: Anthropic }): Promise<ModeDecision> {
  if (opts.forceMock) return { mode: "mock", reason: "--mock flag" };
  if (!process.env.ANTHROPIC_API_KEY) return { mode: "mock", reason: "ANTHROPIC_API_KEY is not set" };
  const client = opts.client ?? new Anthropic({ maxRetries: 1, timeout: 15_000 });
  try {
    await client.models.retrieve(opts.probeModel);
    return { mode: "real", reason: "API key found and the API answered" };
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionError) return { mode: "mock", reason: `API unreachable (${err.message})` };
    throw new Error(`Cannot start a real run: ${describeError(err)}`);
  }
}

export interface CallResult extends LlmResponse {
  cached: boolean;
}

/** One model call through the disk cache. Failed calls are not cached, so a re-run retries them. */
export async function cachedCall(client: LlmClient, cache: DiskCache, req: LlmRequest, key: Omit<CacheKey, "input" | "mode">): Promise<CallResult> {
  const fullKey: CacheKey = {
    ...key,
    mode: client.mode,
    input: JSON.stringify([req.model, req.system, req.user, req.jsonSchema ?? null, req.effort ?? null, req.maxTokens]),
  };
  const hit = cache.get<LlmResponse>(fullKey);
  if (hit) return { ...hit, cached: true };
  const res = await client.complete(req);
  if (!res.error) cache.set(fullKey, res);
  return { ...res, cached: false };
}
