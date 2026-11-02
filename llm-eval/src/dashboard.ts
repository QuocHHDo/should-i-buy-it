// CLI: build results/dashboard.html from every saved run. One self-contained file: inline CSS, inline SVG, a few
// lines of inline JS for the failed-case filter. No CDNs, no network.
//
//   npm run dashboard
import fs from "node:fs";
import path from "node:path";
import { listRuns, loadRun, pct, RESULTS_DIR, usd, type RunResult } from "./results.ts";
import { FIELDS } from "./schema.ts";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const show = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "string" ? `"${v}"` : String(v));

/** Horizontal bars, one per row, labelled directly; value text sits right of the bar. */
function barChart(rows: { label: string; value: number; note?: string }[]): string {
  const rowH = 30;
  const labelW = 170;
  const barW = 360;
  const h = rows.length * rowH + 24;
  const bars = rows
    .map((r, i) => {
      const y = i * rowH + 4;
      const w = Math.max(2, r.value * barW);
      return `<g class="bar"><title>${esc(r.label)}: ${pct(r.value)}${r.note ? ` — ${esc(r.note)}` : ""}</title>
        <rect class="hit" x="0" y="${y - 3}" width="${labelW + barW + 70}" height="${rowH}" />
        <text class="lbl" x="${labelW - 8}" y="${y + 15}" text-anchor="end">${esc(r.label)}</text>
        <rect class="fill" x="${labelW}" y="${y + 4}" width="${w}" height="16" rx="4" />
        <text class="val" x="${labelW + w + 6}" y="${y + 17}">${pct(r.value)}</text></g>`;
    })
    .join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(t => `<line class="grid" x1="${labelW + t * barW}" x2="${labelW + t * barW}" y1="0" y2="${h - 20}" /><text class="tick" x="${labelW + t * barW}" y="${h - 6}" text-anchor="middle">${t * 100}%</text>`)
    .join("");
  return `<svg class="chart" viewBox="0 0 ${labelW + barW + 70} ${h}" role="img" aria-label="Accuracy by model">${ticks}${bars}</svg>`;
}

/** Per-field accuracy as a shaded table: one row per field, one column per model. Light → dark blue = low → high. */
function fieldTable(run: RunResult): string {
  const head = run.models.map(m => `<th scope="col">${esc(m)}</th>`).join("");
  const rows = FIELDS.map(f => {
    const cells = run.models
      .map(m => {
        const v = run.extraction[m].metrics.perField[f];
        if (v === undefined) return `<td class="num muted" title="${esc(m)} doesn't read ${f}">not graded</td>`;
        const step = v >= 0.95 ? 4 : v >= 0.85 ? 3 : v >= 0.7 ? 2 : v >= 0.5 ? 1 : 0;
        return `<td class="num heat h${step}" title="${esc(m)} · ${f}: ${pct(v)}">${pct(v)}</td>`;
      })
      .join("");
    return `<tr><th scope="row"><code>${f}</code></th>${cells}</tr>`;
  }).join("");
  return `<table><thead><tr><th scope="col">Field</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function categoryTable(run: RunResult): string {
  const cats = [...new Set(run.models.flatMap(m => Object.keys(run.extraction[m].metrics.perCategory)))];
  const head = run.models.map(m => `<th scope="col">${esc(m)}</th>`).join("");
  const rows = cats
    .map(c => `<tr><th scope="row">${esc(c)}</th>${run.models.map(m => `<td class="num">${pct(run.extraction[m].metrics.perCategory[c as keyof RunResult["extraction"][string]["metrics"]["perCategory"]] ?? 0)}</td>`).join("")}</tr>`)
    .join("");
  const extra = [
    ["Perfect cases", (m: string) => `${run.extraction[m].metrics.perfectCases}/${run.extraction[m].metrics.cases}`],
    ["Invented values (should be null)", (m: string) => `${run.extraction[m].metrics.invented.count}/${run.extraction[m].metrics.invented.of}`],
    ["Missed values (printed, returned null)", (m: string) => String(run.extraction[m].metrics.missed)],
    ["Unit errors", (m: string) => String(run.extraction[m].metrics.unitErrors)],
    ["Failed or unparseable calls", (m: string) => String(run.extraction[m].metrics.failedCalls)],
    ["Wrong, flagged for checking", (m: string) => (run.extraction[m].metrics.flags ? String(run.extraction[m].metrics.flags.wrongFlagged) : "—")],
    ["Wrong and NOT flagged (silent)", (m: string) => (run.extraction[m].metrics.flags ? String(run.extraction[m].metrics.flags.wrongSilent) : "—")],
    ["Right but flagged anyway", (m: string) => (run.extraction[m].metrics.flags ? String(run.extraction[m].metrics.flags.rightFlagged) : "—")],
  ] as const;
  const extraRows = extra.map(([label, fn]) => `<tr><th scope="row">${label}</th>${run.models.map(m => `<td class="num">${fn(m)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr><th scope="col">Category</th>${head}</tr></thead><tbody>${rows}${extraRows}</tbody></table>`;
}

function verdictTable(run: RunResult): string {
  if (!run.verdict)
    return run.mode === "local"
      ? `<p class="muted">Not run for the app's parser: the app computes verdicts in code, not with a model.</p>`
      : `<p class="muted">Verdict stage was skipped for this run (--no-verdict).</p>`;
  const v = run.verdict;
  const rows = run.models
    .map(m => {
      const x = v.byModel[m].metrics;
      return `<tr><th scope="row">${esc(m)}</th><td class="num">${x.meanOverall.toFixed(2)}</td><td class="num">${x.meanBy.grounded.toFixed(2)}</td><td class="num">${x.meanBy.noInventedFacts.toFixed(2)}</td><td class="num">${x.meanBy.criteriaConsistent.toFixed(2)}</td><td class="num">${x.meanBy.clarity.toFixed(2)}</td><td class="num">${pct(x.lengthOk)}</td><td class="num">${x.judged}</td><td class="num">${x.errors}</td></tr>`;
    })
    .join("");
  return `<p class="muted">Judge: <code>${esc(v.judgeModel)}</code> · verdicts written from the ${v.verdictInput === "expected" ? "ground-truth" : "model's own extracted"} data · responses shuffled per case (seed ${esc(v.judgeSeed)}).</p>
  <table><thead><tr><th scope="col">Model</th><th scope="col">Overall</th><th scope="col">Grounded</th><th scope="col">No invented facts</th><th scope="col">Criteria</th><th scope="col">Clarity</th><th scope="col">2–3 sentences</th><th scope="col">Judged</th><th scope="col">Errors</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function failedTable(run: RunResult): string {
  const rows = run.models.flatMap(m =>
    run.extraction[m].cases.flatMap(c => {
      if (c.error) return [`<tr data-model="${esc(m)}"><td><code>${esc(c.caseId)}</code></td><td>${esc(c.category)}</td><td>${esc(m)}</td><td colspan="3">call failed</td><td><span class="tag">${esc(c.error)}</span></td></tr>`];
      return c.fields
        .filter(f => !f.correct)
        .map(f => {
          const tag = f.nullCheck === "invented" ? "invented" : f.nullCheck === "missed" ? "missed" : f.unitError ? "unit" : "wrong";
          const flag = f.flagged === undefined || f.nullCheck === "missed" ? "" : f.flagged ? ` <span class="tag">flagged</span>` : ` <span class="tag silent">silent</span>`;
          return `<tr data-model="${esc(m)}"><td><code>${esc(c.caseId)}</code></td><td>${esc(c.category)}</td><td>${esc(m)}</td><td><code>${f.field}</code></td><td><code>${esc(show(f.expected))}</code></td><td><code>${esc(show(f.actual))}</code></td><td><span class="tag ${tag}">${tag}</span>${flag}</td></tr>`;
        });
    }),
  );
  if (!rows.length) return `<p class="muted">No failed fields in this run.</p>`;
  const options = run.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  return `<div class="filters"><label>Model <select id="modelFilter"><option value="">All models</option>${options}</select></label> <span class="muted" id="failCount">${rows.length} failed fields</span></div>
  <div class="scroll"><table id="failed"><thead><tr><th scope="col">Case</th><th scope="col">Category</th><th scope="col">Model</th><th scope="col">Field</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Type</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function runsTable(runs: RunResult[]): string {
  const rows = [...runs]
    .reverse()
    .map(r => {
      const acc = r.models.map(m => `${esc(m)} ${pct(r.extraction[m].metrics.overall)}`).join("<br>");
      const t = r.totals;
      return `<tr><td><code>${esc(r.runId)}</code></td><td><span class="mode ${r.mode}">${r.mode.toUpperCase()}</span></td><td>${esc(r.promptVersion)}</td><td class="num">${r.caseIds.length}</td><td>${acc}</td><td class="num">${t.calls} / ${t.cacheHits}</td><td class="num">${t.inputTokens.toLocaleString("en-US")} / ${t.outputTokens.toLocaleString("en-US")}</td><td class="num">${usd(t.costUSD)}${r.mode === "mock" ? " <span class=\"muted\">(simulated)</span>" : ""}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table><thead><tr><th scope="col">Run</th><th scope="col">Mode</th><th scope="col">Prompt</th><th scope="col">Cases</th><th scope="col">Overall accuracy</th><th scope="col">Calls / cached</th><th scope="col">Tokens in / out</th><th scope="col">Cost this run</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function usageTable(run: RunResult): string {
  const rows = (Object.entries(run.usage) as [string, RunResult["usage"]["extract"]][]).flatMap(([stage, group]) =>
    Object.entries(group).map(
      ([m, u]) =>
        `<tr><td>${stage}</td><td>${esc(m)}</td><td class="num">${u.calls}</td><td class="num">${u.cacheHits}</td><td class="num">${u.inputTokens.toLocaleString("en-US")}</td><td class="num">${u.outputTokens.toLocaleString("en-US")}</td><td class="num">${usd(u.costUSD)}</td><td class="num">${usd(u.fullCostUSD)}</td></tr>`,
    ),
  );
  return `<table><thead><tr><th scope="col">Stage</th><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">Cached</th><th scope="col">Tokens in</th><th scope="col">Tokens out</th><th scope="col">Cost this run</th><th scope="col">Cost uncached</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

export function renderDashboard(runs: RunResult[]): string {
  if (!runs.length) throw new Error("no runs in results/ yet — run `npm run eval` first");
  const latest = runs[runs.length - 1];
  const modeNote =
    latest.mode === "mock"
      ? `<p class="banner mock"><strong>MOCK run.</strong> These numbers come from fake responses (a regex parser and a rule-based judge), not from Claude. They prove the pipeline works; they say nothing about model quality. Reason: ${esc(latest.modeReason)}.</p>`
      : latest.mode === "local"
        ? `<p class="banner real"><strong>LOCAL run</strong> of the app's own label parser (<code>js/labelocr.js</code>) on the label text. Real results, no model, no cost. Servings per container isn't read by the parser, so it isn't graded. "Flagged" values are the ones the app shows with a "check it" note.</p>`
        : `<p class="banner real"><strong>REAL run</strong> against the Anthropic API.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Label Extraction Eval</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--panel:#ffffff;--border:#e4e3df;--text:#0b0b0b;--text2:#52514e;--muted:#6f6e69;--series1:#2a78d6;--grid:#ecebe7;
--h0:#eef4fc;--h1:#d3e3f8;--h2:#a9c8f0;--h3:#6fa3e3;--h4:#2a78d6;--h4text:#ffffff;--warn-bg:#fff4dc;--warn-text:#6b4a00;--ok-bg:#e3f4ea;--ok-text:#14532d;--tag-bg:#f1f0ec}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--surface:#1a1a19;--panel:#222221;--border:#3a3a37;--text:#f0efec;--text2:#c3c2b7;--muted:#9c9b93;--series1:#3987e5;--grid:#2e2e2b;
--h0:#1f2a38;--h1:#22406a;--h2:#2a5a96;--h3:#3473c2;--h4:#5b9cf0;--h4text:#0b0b0b;--warn-bg:#3d3112;--warn-text:#f5d68a;--ok-bg:#16301f;--ok-text:#a7e3bd;--tag-bg:#2e2e2b}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#1a1a19;--panel:#222221;--border:#3a3a37;--text:#f0efec;--text2:#c3c2b7;--muted:#9c9b93;--series1:#3987e5;--grid:#2e2e2b;
--h0:#1f2a38;--h1:#22406a;--h2:#2a5a96;--h3:#3473c2;--h4:#5b9cf0;--h4text:#0b0b0b;--warn-bg:#3d3112;--warn-text:#f5d68a;--ok-bg:#16301f;--ok-text:#a7e3bd;--tag-bg:#2e2e2b}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
.muted{color:var(--muted)}section{min-width:0;overflow-x:auto;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:16px}
section h2{margin-top:0}.banner{padding:10px 14px;border-radius:8px}.banner.mock{background:var(--warn-bg);color:var(--warn-text)}.banner.real{background:var(--ok-bg);color:var(--ok-text)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
thead th{color:var(--text2);font-weight:600}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.heat.h0{background:var(--h0)}.heat.h1{background:var(--h1)}.heat.h2{background:var(--h2)}.heat.h3{background:var(--h3)}.heat.h4{background:var(--h4);color:var(--h4text)}
.scroll{overflow-x:auto;max-height:560px;overflow-y:auto}code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.tag{display:inline-block;padding:0 6px;border-radius:4px;background:var(--tag-bg);font-size:12px}.tag.silent{background:var(--warn-bg);color:var(--warn-text);font-weight:600}
.mode{font-size:12px;font-weight:600;padding:1px 6px;border-radius:4px}.mode.mock{background:var(--warn-bg);color:var(--warn-text)}.mode.real,.mode.local{background:var(--ok-bg);color:var(--ok-text)}
.chart{width:100%;max-width:600px;height:auto}.chart .fill{fill:var(--series1)}.chart .lbl,.chart .val{fill:var(--text);font-size:13px}.chart .tick{fill:var(--muted);font-size:11px}
.chart .grid{stroke:var(--grid);stroke-width:1}.chart .hit{fill:transparent}.chart .bar:hover .hit{fill:var(--grid)}
.filters{margin-bottom:8px}select{font:inherit;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:2px 6px}
.grid2{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:860px){.grid2{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<h1>Nutrition-label extraction eval</h1>
<p class="muted">Latest run <code>${esc(latest.runId)}</code> · prompt <code>${esc(latest.promptVersion)}</code> · ${latest.caseIds.length} cases · ${runs.length} run(s) on file · generated ${esc(new Date().toISOString())}</p>
${modeNote}
<section><h2>Overall extraction accuracy by model</h2>
<p class="muted">Share of all case × field values that exactly match the ground truth.</p>
${barChart(latest.models.map(m => ({ label: m, value: latest.extraction[m].metrics.overall, note: `${latest.extraction[m].metrics.perfectCases}/${latest.extraction[m].metrics.cases} perfect cases` })))}
</section>
<div class="grid2">
<section><h2>Per-field accuracy</h2>${fieldTable(latest)}</section>
<section><h2>By category, and error types</h2>${categoryTable(latest)}</section>
</div>
<section><h2>Verdict quality (LLM judge, 1–5)</h2>${verdictTable(latest)}</section>
<section><h2>Failed cases — expected vs actual</h2>${failedTable(latest)}</section>
<section><h2>Tokens and cost, latest run</h2>${usageTable(latest)}</section>
<section><h2>All runs</h2>${runsTable(runs)}</section>
</main>
<script>
const sel = document.getElementById("modelFilter");
if (sel) sel.addEventListener("change", () => {
  let n = 0;
  for (const tr of document.querySelectorAll("#failed tbody tr")) {
    const show = !sel.value || tr.dataset.model === sel.value;
    tr.hidden = !show; if (show) n++;
  }
  document.getElementById("failCount").textContent = n + " failed fields";
});
</script>
</body></html>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = listRuns().map(loadRun);
  const out = path.join(RESULTS_DIR, "dashboard.html");
  fs.writeFileSync(out, renderDashboard(runs));
  console.log(`Wrote ${path.relative(process.cwd(), out)} from ${runs.length} run(s).`);
}
