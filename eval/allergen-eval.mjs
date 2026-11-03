// How often does js/allergens.js miss an allergen on real US labels? (Scoring rules: eval/allergen-score.js.)
//   node eval/allergen-eval.mjs --fetch 300   collect labels from Open Food Facts and USDA Branded Foods into
//                                             eval/allergen-labels.json (needs network; USDA_API_KEY for USDA)
//   node eval/allergen-eval.mjs               score eval/allergen-labels.json (or, without it, the real labels
//                                             saved in tests/fixtures/) → eval/allergen-report.md + .json
// Run from the Actions tab: .github/workflows/allergen-eval.yml.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./allergen-score.js");

const ROOT = new URL("..", import.meta.url).pathname;
const DATA = path.join(ROOT, "eval/allergen-labels.json");
const args = process.argv.slice(2);
const fetchN = args.includes("--fetch") ? Number(args[args.indexOf("--fetch") + 1]) || 300 : 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Open Food Facts asks API clients to name themselves; no personal contact details here.
const UA = "should-i-buy-it-allergen-eval/1.0 (+https://github.com/QuocHHDo/should-i-buy-it)";

async function getJson(url, opts = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { "user-agent": UA, ...(opts.headers || {}) } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      if (res.status === 429 && i >= 1) { console.error("Rate limited; skipping."); return null; }
      console.error(`HTTP ${res.status} ${url.replace(/api_key=[^&]+/, "api_key=…")}`);
    } catch (e) { console.error(String(e)); }
    await sleep(3000 * (i + 1));
  }
  return null;
}
const norm = s => String(s || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

// Open Food Facts: the most-scanned US products with an English ingredient list. Uses the older /cgi/search.pl
// endpoint: /api/v2/search answered 503 for days in Nov 2026 while this one worked. Searches are limited to about
// 10 a minute, so pages are spaced out.
async function fromOff(want) {
  const out = [];
  for (let page = 1; out.length < want && page <= 20; page++) {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?action=process&tagtype_0=countries&tag_contains_0=contains&tag_0=united-states&sort_by=unique_scans_n&page_size=100&page=${page}&json=1&fields=code,product_name,brands,ingredients_text_en,ingredients_text,allergens_tags,traces_tags`;
    const r = await getJson(url);
    if (!r || !Array.isArray(r.products)) break;
    for (const p of r.products) {
      // English only: the text in ingredients_text can be in any language.
      const ing = String(p.ingredients_text_en || "").trim();
      if (ing.length < 20 || !/[a-z]/i.test(ing) || /[Ѐ-ӿ؀-ۿ぀-ヿ一-鿿]/.test(ing)) continue;
      out.push({ source: "off", id: String(p.code), name: [p.brands && String(p.brands).split(",")[0], p.product_name].filter(Boolean).join(" ").slice(0, 100),
        ingredients: ing.slice(0, 3000), offAllergens: Array.isArray(p.allergens_tags) ? p.allergens_tags : [], offTraces: Array.isArray(p.traces_tags) ? p.traces_tags : [] });
    }
    console.error(`Open Food Facts page ${page}: ${out.length} labels`);
    await sleep(7000);
  }
  return out.slice(0, want);
}

// USDA Branded Foods: the brand's own label text, across the aisles where allergens hide.
const AISLES = ["cookies", "crackers", "cereal", "bread", "ice cream", "chocolate candy", "chips", "frozen meal", "frozen pizza", "pasta sauce",
  "salad dressing", "soup", "granola bar", "protein bar", "snack mix", "sausage", "breaded chicken", "fish sticks", "seasoning mix", "noodles",
  "cake mix", "pancake mix", "yogurt", "cheese spread", "pesto", "curry sauce", "dumplings", "spring rolls", "trail mix", "baked beans"];
async function fromUsda(want) {
  const key = process.env.USDA_API_KEY || "DEMO_KEY";
  const out = [], per = Math.max(5, Math.ceil(want / AISLES.length));
  for (const q of AISLES) {
    if (out.length >= want) break;
    const r = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, dataType: ["Branded"], pageSize: per * 2 }) });
    let n = 0;
    for (const f of (r && r.foods) || []) {
      const ing = String(f.ingredients || "").trim();
      if (ing.length < 20 || n >= per) continue;
      out.push({ source: "usda", id: String(f.fdcId), name: [f.brandName || f.brandOwner, f.description].filter(Boolean).join(" ").slice(0, 100), ingredients: ing.slice(0, 3000) });
      n++;
    }
    console.error(`USDA “${q}”: ${out.length} labels`);
    await sleep(key === "DEMO_KEY" ? 4000 : 400);
  }
  return out.slice(0, want);
}

// The real labels already saved as test fixtures (a handful; enough to run the scorer offline).
function fromFixtures() {
  const dir = path.join(ROOT, "tests/fixtures"), out = [];
  const walk = (o, file) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(x => walk(x, file));
    const ing = typeof o.ingredients === "string" ? o.ingredients : typeof o.ingredients_text_en === "string" ? o.ingredients_text_en : o.ingredients && typeof o.ingredients.value === "string" ? o.ingredients.value : null;
    if (ing && ing.length >= 20) out.push({ source: "fixture", id: file, name: String(o.product_name || o.description || o.name || "").slice(0, 100), ingredients: ing,
      ...(Array.isArray(o.allergens_tags) ? { offAllergens: o.allergens_tags, offTraces: o.traces_tags || [] } : {}) });
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, file);
  };
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) { try { walk(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), f); } catch {} }
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(r => { const k = norm(r.ingredients); if (seen.has(k)) return false; seen.add(k); return true; });
}

if (fetchN) {
  const off = await fromOff(Math.ceil(fetchN * 0.6));
  const usda = await fromUsda(fetchN - off.length);
  const labels = dedupe([...off, ...usda]);
  if (!labels.length) { console.error("No labels collected (network blocked?). Nothing written."); process.exit(1); }
  fs.writeFileSync(DATA, JSON.stringify({ collected: new Date().toISOString(), note: "Real label text from Open Food Facts (ODbL) and USDA FoodData Central Branded Foods (public domain), for eval/allergen-eval.mjs.", labels }, null, 1) + "\n");
  console.error(`Wrote ${labels.length} labels to eval/allergen-labels.json (${off.length} Open Food Facts, ${usda.length} USDA)`);
}

const records = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, "utf8")).labels : dedupe(fromFixtures());
const from = fs.existsSync(DATA) ? "eval/allergen-labels.json" : "the real labels in tests/fixtures/ (run with --fetch for a proper sample)";
const s = S.score(records);
fs.writeFileSync(path.join(ROOT, "eval/allergen-report.md"), S.report(s) + `\nLabels from ${from}.\n`);
fs.writeFileSync(path.join(ROOT, "eval/allergen-report.json"), JSON.stringify(s, null, 1) + "\n");
console.log(`${s.records} labels, ${s.withStatement} with an allergen statement · recall ${s.recall == null ? "—" : (s.recall * 100).toFixed(1) + "%"} · missed ${s.truth - s.found} · extra flags ${s.extras.length} · whole-label misses ${s.full.length}`);
console.log("Report: eval/allergen-report.md");
