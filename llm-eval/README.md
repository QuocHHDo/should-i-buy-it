# Nutrition-label extraction eval

Measures how accurately Claude models pull structured numbers out of nutrition-label text, and how good their
"should I buy it?" verdicts are.

## Setup

Node 20 or newer.

```bash
cd llm-eval
npm ci
export ANTHROPIC_API_KEY=...   # optional; without it every run is MOCK
```

The key is read from the environment only. It is never printed, logged, cached or written to `results/`.

## Commands

| Command | What it does |
|---|---|
| `npm run eval -- [flags]` | Runs extraction, grading, verdicts and judging; saves `results/run-<timestamp>.json` |
| `npm run dashboard` | Builds `results/dashboard.html` from every saved run (one file, no CDNs; open it in a browser) |
| `npm run check` | Regression gate: exits 1 if any model's overall accuracy fell by more than 3 points since the previous run (`-- --threshold N` to change) |
| `npm test` | Unit tests (Vitest), all on mock data |
| `npm run typecheck` | `tsc` type check |
| `npm run gen:cases` | Regenerates `cases/` from `scripts/generate-cases.ts` |

`npm run eval` flags:

| Flag | Default | |
|---|---|---|
| `--models a,b` | `claude-opus-5-5` | Models under test |
| `--prompt v1` | `v1` | Extraction prompt version (`src/prompts.ts`) |
| `--limit N` | all 60 | Only the first N cases |
| `--concurrency N` | `5` | Parallel calls |
| `--effort low` | `low` | `output_config.effort` for extraction |
| `--no-verdict` | off | Skip the verdict and judge stages |
| `--judge-model m` | `claude-opus-5-5` | Model that scores verdicts |
| `--verdict-input expected\|extracted` | `expected` | Write verdicts from the ground truth (compares verdict writing alone) or from each model's own extraction (errors carry through) |
| `--judge-seed s` | `0` | Seed for the order verdicts are shown to the judge |
| `--mock` | off | Force MOCK mode |
| `--confirm-large` | off | Required for real runs over 60 case × model extractions |

Start small: `npm run eval -- --limit 10` with one model, then read the printed token count and cost before a larger run.

### REAL and MOCK mode

With `ANTHROPIC_API_KEY` set and the API reachable, the run is **REAL**. If the key is missing or the API can't be
reached, the run falls back to **MOCK** and says so in the console banner, in the results file (`mode`,
`modeReason`) and on the dashboard. MOCK answers are fake: extraction is a regex parser of the label text (it never
sees the ground truth), verdicts are templated, and the judge is rule-based, with a small seeded per-model error
rate so multi-model runs differ. Token counts in MOCK are estimates (~4 characters per token) and the costs shown are
what those tokens would cost, not money spent. A key the API rejects, or an unknown model, stops the run instead of
falling back, so a configuration mistake can't hide behind fake numbers.

### Cache

Every model output is cached under `.cache/<mode>/<stage>/<model>/<prompt>/<case>-<hash>.json`, where the hash
covers the exact input (prompt text, label text, schema, settings). Re-running the same command re-grades from disk
with no API calls; editing a case or prompt text gets a fresh call. Failed calls are not cached. Delete `.cache/` to
start over.

## How it is graded

**Extraction** (`src/graders/extraction.ts`), per field:
- **Exact match.** Numbers must be equal; serving size is compared after normalizing case and spacing.
- **Null handling.** A value for a field the label doesn't print is counted as *invented*; null for a printed field is *missed*.
- **Unit check.** A wrong value that is ×1000 or ÷1000 (mg vs g), ×4.184 (kJ for kcal), or a serving size in different units is flagged as a unit error.

Overall accuracy is the share of all case × field values that are exactly right. Per-field and per-category
accuracy, perfect cases, invented/missed counts and unit errors are reported alongside. A failed or unparseable call
scores every field of that case wrong.

**Verdicts** (`src/graders/verdict.ts`). Each model gets the per-serving data and three fixed criteria (added sugar
≤ 5 g, sodium < 600 mg, protein > 10 g) and writes a 2-3 sentence verdict. A judge model scores each verdict 1-5
on grounded, no invented facts, consistent with the criteria, and clarity, plus an overall score, using the rubric
in `RUBRIC`. The criteria outcomes are computed in code and given to the judge. All models' verdicts for a case
are judged in one call, labelled A/B/C in a seeded random order, so no model sits in the first slot every time;
the slot each verdict got is saved with its score. Sentence count is also checked in code.

Real calls use structured outputs (`output_config.format`) for extraction and judging. Server-side refusal
fallbacks are deliberately **not** enabled: an eval must score the model it names, so a refusal is recorded as a
failed case instead of being answered by another model.

## Adding a case

Either add a product or label to `scripts/generate-cases.ts` and run `npm run gen:cases` (keeps label and ground
truth in sync), or drop a hand-written file into `cases/`:

```json
{
  "id": "messy-16",
  "category": "messy",
  "description": "What makes this case hard",
  "labelText": "Nutrition Facts\nServing size 1 cup (240mL)\n...",
  "expected": {
    "servingSize": "1 cup (240mL)", "servingsPerContainer": 2, "calories": 150,
    "totalFat_g": 8, "satFat_g": 5, "sodium_mg": 125, "totalCarbs_g": 12,
    "fiber_g": 0, "sugars_g": 12, "addedSugars_g": null, "protein_g": 8
  }
}
```

`category` is one of `clean`, `messy`, `missing`, `tricky`, `adversarial`. Every field must be present; use `null`
for anything the label doesn't print. Values follow the conventions below. `npm test` checks that every case loads.
Hand-written files are deleted by `npm run gen:cases`, so add them to the generator if you regenerate.

## Test set

`cases/` holds 60 JSON files, one per case: the label text and the ground-truth extraction.

| Category | Count | What it tests |
|---|---|---|
| clean | 20 | Standard US panels, every field printed |
| messy | 15 | One-line labels, OCR typos (`Sodlum`, `l2g`), `<1g`, `0g`, `1,580mg`, words split across lines |
| missing | 10 | Lines absent or cropped — the right answer is `null` |
| tricky | 10 | Per-serving + per-container columns, per-100g columns, as packaged / as prepared, kJ + kcal, unusual serving units |
| adversarial | 5 | Marketing copy (or instruction-like text) that contradicts the panel — the panel wins |

The schema is `schema/nutrition.schema.json`. Conventions the prompt states and the ground truth follows:

- Values are **per serving** (the per-serving column on dual-column labels; "as packaged" over "as prepared").
- A value not printed on the label is `null`, never estimated. "Servings per container: varies" is `null`.
- `<1g` / "less than 1g" is recorded as `0.5`. "About 8 servings" is `8`.
- `servingSize` is the serving text as printed, with obvious OCR slips corrected (`l/4` → `1/4`).

> **The data is synthetic.** The products and labels were generated by `scripts/generate-cases.ts` from invented
> (but realistic) values, not copied from real packages. Ground truth is derived from the same record the label
> text is rendered from, so the two agree by construction, but the conventions above are judgment calls and some
> labels are deliberately ambiguous. Spot-check the ground truth before reading much into small accuracy differences.

## Layout

```
cases/                 60 test cases (generated)
schema/                JSON schema for one extraction
scripts/generate-cases.ts
src/run.ts             CLI: run + grade + save
src/runner.ts          extraction and verdict stages (concurrency, cache, usage)
src/llm.ts             real client (Anthropic SDK), mock client, mode decision, cached calls
src/mock.ts            MOCK responses
src/graders/           extraction and verdict graders, judge rubric
src/dashboard.ts       CLI: results/dashboard.html
src/check.ts           CLI: regression gate
tests/                 Vitest unit tests
results/               saved runs and the dashboard
```

## Known limitations

- The test set is synthetic and small (60 cases, 5-20 per category), so one case moves a category score by 5-20 points.
- Exact match is strict: "2/3 cup (55 g)" passes but "2/3 cup, 55g" fails. Read failed serving sizes in the dashboard before concluding a model is wrong.
- The judge is itself a model. Its scores are a signal, not ground truth; spot-check rationales in the results file. Using the same model family as judge and writer can flatter it.
- MOCK mode ignores the prompt version, so v1 and v2 mock runs score the same.
- Prices in `src/pricing.ts` are list prices and must be updated by hand.
