// The browser extension: its copies of the app code are current, and its manifest points at real files.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));

test("extension/lib matches js/ (run `node scripts/sync-extension.mjs` after changing app code)", () => {
  for (const f of fs.readdirSync(path.join(EXT, "lib"))) {
    assert.equal(fs.readFileSync(path.join(EXT, "lib", f), "utf8"), fs.readFileSync(path.join(ROOT, "js", f), "utf8"), `extension/lib/${f} is out of date`);
  }
});

test("extension/ocr matches vendor/tesseract: the label reader ships inside the extension (no remote code)", () => {
  for (const f of fs.readdirSync(path.join(EXT, "ocr")))
    assert.ok(fs.readFileSync(path.join(EXT, "ocr", f)).equals(fs.readFileSync(path.join(ROOT, "vendor/tesseract", f))), `extension/ocr/${f} is out of date`);
  for (const f of ["tesseract.min.js", "worker.min.js", "tesseract-core-simd-lstm.wasm.js", "eng.traineddata.gz"]) assert.ok(fs.existsSync(path.join(EXT, "ocr", f)), f);
  // WebAssembly needs 'wasm-unsafe-eval' on extension pages; nothing else is loosened.
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
});

test("every file the manifest names exists, in a load order that works", () => {
  const files = [manifest.background.service_worker, manifest.options_page, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(c => c.js)];
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), f);
  const js = manifest.content_scripts[0].js;
  for (const [dep, user] of [["lib/verdict.js", "lib/sources.js"], ["lib/sources.js", "lib/walmart.js"], ["lib/search.js", "lib/walmart.js"], ["lib/walmart.js", "lib/costco.js"], ["lib/costco.js", "content.js"], ["lib/foods.js", "content.js"]])
    assert.ok(js.indexOf(dep) < js.indexOf(user), `${dep} loads before ${user}`);
});

test("permissions stay narrow: storage, the side panel, Walmart, Sam's Club, Costco, Target and Kroger pages, and the two nutrition sources", () => {
  assert.deepEqual(manifest.permissions, ["storage", "sidePanel"]);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(fs.existsSync(path.join(EXT, "sidepanel.html")) && fs.existsSync(path.join(EXT, "sidepanel.js")));
  // Every script the side panel loads exists.
  for (const m of fs.readFileSync(path.join(EXT, "sidepanel.html"), "utf8").matchAll(/src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(EXT, m[1])), m[1]);
  assert.deepEqual(manifest.host_permissions, ["https://world.openfoodfacts.org/*", "https://api.nal.usda.gov/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.walmart.com/*", "https://www.samsclub.com/*", "https://www.costco.com/*", "https://www.target.com/*", "https://www.kroger.com/*"]);
  // Photo hosts that don't serve other sites are asked for when first used, not at install.
  assert.deepEqual(manifest.optional_host_permissions, ["https://gdx-assets.costco.com/*", "https://target.scene7.com/*"]);
  const bg = fs.readFileSync(path.join(EXT, manifest.background.service_worker), "utf8");
  assert.match(bg, /credentials: "omit"/);
});

test("store limits: description at most 132 characters, name at most 75, a version Chrome accepts", () => {
  assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length} characters`);
  assert.ok(manifest.name.length <= 75);
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
});
