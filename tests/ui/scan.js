// Real-browser barcode scan: Chromium's fake camera plays tests/fixtures/camera-ean13-3017620422003.mjpeg
// (a printed EAN-13 for Nutella) and the app must decode it and open the product.
//   node tests/ui/scan.js     (needs playwright + Chromium; skipped with a note if missing)
// Headless Chromium on Linux has no BarcodeDetector, so this exercises the bundled ZXing decoder.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("SKIP scan check: playwright is not installed"); process.exit(0); }

const ROOT = path.join(__dirname, "..", "..");
const VIDEO = path.join(ROOT, "tests", "fixtures", "camera-ean13-3017620422003.mjpeg");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/`; // localhost counts as a secure context, so the camera API is available
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${VIDEO}`] });
  try {
    const ctx = await browser.newContext({ viewport: { width: Number(process.env.SCAN_WIDTH || 375), height: 800 }, serviceWorkers: "block", permissions: ["camera"] });
    const page = await ctx.newPage();
    let asked = null;
    await page.route("**/world.openfoodfacts.org/**", r => { if (/\/product\//.test(r.request().url())) asked = r.request().url(); r.fulfill({ contentType: "application/json", body: fs.readFileSync(path.join(ROOT, "tests/fixtures/off-nutella.json"), "utf8") }); });
    await page.goto(base); await page.waitForSelector("#out h2");
    const hasDetector = await page.evaluate(() => "BarcodeDetector" in window);
    // On phones the big Scan button on the home replaces the small one; on wider screens it's the small one.
    await page.click((await page.isVisible("#scanBig")) ? "#scanBig" : "#scanBtn");
    await page.waitForFunction(() => /Nutella/i.test(document.querySelector("#out h2")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
    ok(asked && asked.includes("/product/3017620422003"), `camera decoded EAN-13 3017620422003 using ${hasDetector ? "BarcodeDetector" : "the bundled ZXing decoder (no BarcodeDetector)"}`);
    ok(/Nutella/i.test(await page.$eval("#out h2", e => e.textContent).catch(() => "")), "scanned product opens");
    ok(await page.$eval("#scan", e => e.hidden), "scanner closes after a successful scan");
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, "scan-result-375.png") });
  } finally { await browser.close(); srv.close(); }
  console.log(fails ? `${fails} scan check(s) failed` : "Scan check passed");
  process.exit(fails ? 1 : 0);
})();
