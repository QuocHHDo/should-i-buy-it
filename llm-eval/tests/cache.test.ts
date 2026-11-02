import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskCache, type CacheKey } from "../src/cache.ts";
import { limiter } from "../src/concurrency.ts";
import { cachedCall, decideMode, MockClient, type LlmClient, type LlmRequest, type LlmResponse } from "../src/llm.ts";
import { runExtraction } from "../src/runner.ts";
import { sampleCase, truth } from "./fixtures.ts";

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cache-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const key = (over: Partial<CacheKey> = {}): CacheKey => ({ mode: "mock", stage: "extract", model: "m", promptVersion: "v1", caseId: "c1", input: "in", ...over });

/** A fake client that counts calls and answers with the fixture's ground truth. */
class CountingClient implements LlmClient {
  readonly mode = "mock" as const;
  calls = 0;
  constructor(private readonly fail = false) {}
  async complete(_req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    if (this.fail) return { text: "", stopReason: "error", usage: { inputTokens: 0, outputTokens: 0 }, error: "boom" };
    return { text: JSON.stringify(truth), stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 20 } };
  }
}

const req: LlmRequest = { stage: "extract", model: "m", system: "s", user: "u", maxTokens: 10, mock: { kind: "extract", caseId: "c1", labelText: "x" } };

describe("DiskCache", () => {
  it("round-trips a value and misses on any key change", () => {
    const cache = new DiskCache(dir);
    cache.set(key(), { text: "hello" });
    expect(cache.get(key())).toEqual({ text: "hello" });
    expect(cache.get(key({ model: "other" }))).toBeUndefined();
    expect(cache.get(key({ promptVersion: "v2" }))).toBeUndefined();
    expect(cache.get(key({ caseId: "c2" }))).toBeUndefined();
    expect(cache.get(key({ input: "edited label" }))).toBeUndefined();
  });

  it("keeps real and mock outputs apart", () => {
    const cache = new DiskCache(dir);
    cache.set(key({ mode: "mock" }), 1);
    expect(cache.get(key({ mode: "real" }))).toBeUndefined();
    expect(cache.file(key({ mode: "mock" }))).toContain(`${path.sep}mock${path.sep}`);
  });
});

describe("cachedCall", () => {
  it("calls the model once, then serves from disk", async () => {
    const client = new CountingClient();
    const cache = new DiskCache(dir);
    const k = { stage: "extract", model: "m", promptVersion: "v1", caseId: "c1" };
    const first = await cachedCall(client, cache, req, k);
    const second = await cachedCall(client, cache, req, k);
    expect(client.calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second).toMatchObject({ cached: true, text: first.text });
  });

  it("does not cache failures, so a re-run retries them", async () => {
    const client = new CountingClient(true);
    const cache = new DiskCache(dir);
    const k = { stage: "extract", model: "m", promptVersion: "v1", caseId: "c1" };
    await cachedCall(client, cache, req, k);
    await cachedCall(client, cache, req, k);
    expect(client.calls).toBe(2);
  });
});

describe("runExtraction", () => {
  it("re-running never re-calls the model and counts cache hits at zero cost", async () => {
    const client = new CountingClient();
    const cache = new DiskCache(dir);
    const opts = { models: ["claude-haiku-5-5"], promptVersion: "v1", cases: [sampleCase], client, cache };
    const a = await runExtraction(opts);
    const b = await runExtraction(opts);
    expect(client.calls).toBe(1);
    expect(a.usage["claude-haiku-5-5"]).toMatchObject({ calls: 1, cacheHits: 0, inputTokens: 100 });
    expect(b.usage["claude-haiku-5-5"]).toMatchObject({ calls: 0, cacheHits: 1, inputTokens: 0, costUSD: 0 });
    expect(b.outputs[0].extracted).toEqual(truth);
  });

  it("works end to end with the built-in mock", async () => {
    const { outputs } = await runExtraction({ models: ["m"], promptVersion: "v1", cases: [sampleCase], client: new MockClient(), cache: new DiskCache(dir) });
    expect(outputs[0].error).toBeUndefined();
    expect(outputs[0].extracted?.calories).toBe(230);
  });
});

describe("limiter", () => {
  it("never runs more than the limit at once", async () => {
    const limit = limiter(5);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        limit(async () => {
          peak = Math.max(peak, ++active);
          await new Promise(r => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(5);
  });
});

describe("decideMode", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => (saved === undefined ? delete process.env.ANTHROPIC_API_KEY : (process.env.ANTHROPIC_API_KEY = saved)));

  it("falls back to mock without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await decideMode({ forceMock: false, probeModel: "m" })).toMatchObject({ mode: "mock", reason: "ANTHROPIC_API_KEY is not set" });
  });

  it("falls back to mock when the API is unreachable", async () => {
    process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
    const client = { models: { retrieve: async () => Promise.reject(new Anthropic.APIConnectionError({ message: "offline" })) } } as unknown as Anthropic;
    expect((await decideMode({ forceMock: false, probeModel: "m", client })).mode).toBe("mock");
  });

  it("uses real mode when the API answers", async () => {
    process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
    const client = { models: { retrieve: async () => ({ id: "m" }) } } as unknown as Anthropic;
    expect((await decideMode({ forceMock: false, probeModel: "m", client })).mode).toBe("real");
  });
});
