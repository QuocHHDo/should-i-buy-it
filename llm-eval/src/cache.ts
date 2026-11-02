import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./schema.ts";

export const CACHE_DIR = path.join(ROOT, ".cache");

/** What identifies one model output. `input` is everything sent (prompt text, schema, settings), hashed. */
export interface CacheKey {
  mode: "real" | "mock";
  stage: string;
  model: string;
  promptVersion: string;
  caseId: string;
  input: string;
}

/**
 * Model outputs on disk, one JSON file per call, at
 * .cache/<mode>/<stage>/<model>/<promptVersion>/<caseId>-<hash>.json
 * Real and mock outputs never share a file. The hash covers the exact input, so editing a case or a prompt's
 * text gets a fresh call instead of a stale answer.
 */
export class DiskCache {
  constructor(readonly dir: string = CACHE_DIR) {}

  file(key: CacheKey): string {
    const hash = crypto.createHash("sha256").update(key.input).digest("hex").slice(0, 16);
    const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
    return path.join(this.dir, key.mode, safe(key.stage), safe(key.model), safe(key.promptVersion), `${safe(key.caseId)}-${hash}.json`);
  }

  get<T>(key: CacheKey): T | undefined {
    try {
      return (JSON.parse(fs.readFileSync(this.file(key), "utf8")) as { value: T }).value;
    } catch {
      return undefined;
    }
  }

  set<T>(key: CacheKey, value: T): void {
    const file = this.file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { input: _omit, ...meta } = key;
    // Write to a temp file and rename, so a crash mid-write never leaves a half file that parses as a cache hit.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ key: meta, savedAt: new Date().toISOString(), value }, null, 2));
    fs.renameSync(tmp, file);
  }
}
