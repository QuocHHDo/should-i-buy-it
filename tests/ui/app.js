// The site as a phone app: the installed app's start page, the scan-first home, recent scans, the install prompt
// (Android's Install button and the iPhone how-to), and the Scan shortcut. Playwright + Chromium at phone size.
//   node tests/ui/app.js
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("SKIP app checks: playwright is not installed"); process.exit(0); }

const ROOT = path.join(__dirname, "..", "..");
const SHOTS = process.env.SHOTS_DIR;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg", ".gz": "application/gzip", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const fixture = n => fs.readFileSync(path.join(ROOT, "tests", "fixtures", n), "utf8");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const serve = () => new Promise(resolve => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(0, () => resolve(srv));
});

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  // A fake camera, so "already allowed" can be tested.
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const open = async (url, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", ...opts });
    const page = await ctx.newPage();
    page.on("pageerror", e => { fails++; console.log("FAIL page error: " + e.message); });
    await page.route("**/world.openfoodfacts.org/**", r => r.fulfill({ contentType: "application/json", body: fixture("off-nutella.json") }));
    await page.route("**/api.nal.usda.gov/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ foods: [] }) }));
    if (opts.seed) await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, opts.seed);
    await page.goto(base + url);
    await page.waitForSelector("#out h2");
    return { ctx, page };
  };
  const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none"; }, sel);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
    ok(manifest.start_url === "./?source=app" && manifest.display === "standalone" && manifest.shortcuts.some(s => s.url === "./?source=app#scan"), "the installed app starts at the app home and has a Scan shortcut");

    // 1. Launched from the home screen: the scan-first home.
    let { ctx, page } = await open("?source=app");
    ok(await visible(page, "#scanBig") && await page.evaluate(() => document.getElementById("scanBig").getBoundingClientRect().top < 400), "the app opens on a big Scan button near the top");
    const hit = await page.evaluate(() => { const r = document.getElementById("scanBig").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    ok(hit[0] >= 300 && hit[1] >= 56, `easy to hit with a thumb (${hit.join(" × ")} px)`);
    ok(!(await visible(page, "#installBar")), "no install prompt inside the installed app's own start (no browser offer, not iPhone)");
    await ctx.close();

    // 2. Camera already allowed: straight to the scanner. Not allowed yet: no surprise permission prompt.
    ({ ctx, page } = await open("?source=app", { permissions: ["camera"] }));
    await page.waitForFunction(() => !document.getElementById("scan").hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await visible(page, "#scan"), "camera already allowed: the app opens with the scanner running");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "app2-scanner.png") });
    await ctx.close();
    ({ ctx, page } = await open("?source=app"));
    await page.waitForTimeout(800);
    ok(!(await visible(page, "#scan")), "camera not allowed yet: it waits for a tap instead of prompting on launch");
    await ctx.close();

    // 3. The Scan shortcut (long-press on the app icon).
    ({ ctx, page } = await open("?source=app#scan", { permissions: ["camera"] }));
    await page.waitForFunction(() => !document.getElementById("scan").hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await visible(page, "#scan"), "the Scan shortcut opens the scanner");
    ok(await page.evaluate(() => !location.hash), "no #scan left in the address");
    await ctx.close();

    // 4. Recent scans, with verdicts; opening one steps the home aside; tapping Check again brings it back.
    const nut = JSON.parse(fixture("off-nutella.json"));
    ({ ctx, page } = await open("?source=app", { seed: {} }));
    // A real scan: the code typed into the scanner's box goes through the same lookup.
    await page.click("#scanBig");
    await page.fill("#code", "3017620422003"); await page.click("#codeForm button[type=submit]");
    await page.waitForFunction(() => /Nutella/i.test((document.querySelector("#out h2") || {}).textContent || ""), null, { timeout: 8000 });
    ok(!(await visible(page, "#appHome")), "after a scan the result comes first: the home steps aside");
    await page.click('#tabs [data-view="check"]');
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#scanRecent button")].map(b => b.getAttribute("aria-label")));
    ok(await visible(page, "#appHome") && rows.length === 1 && /Nutella.*: (Limit it|In moderation|Skip)/i.test(rows[0]), `tapping Check again shows the home with the scan and its verdict (${rows.join(" | ")})`);
    ok(await page.evaluate(() => !!document.querySelector("#scanRecent svg")), "each recent scan shows its verdict icon");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "app1-home.png") });
    await page.click("#scanRecent button");
    ok(/Nutella/i.test(await page.textContent("#out h2")), "tapping a recent scan opens it");
    await ctx.close();

    // 4b. A first visit: no install banner before the app has shown any value.
    ({ ctx, page } = await open(""));
    await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => {}; dispatchEvent(e); });
    ok(!(await visible(page, "#installBar")), "first visit: no install banner yet");
    await ctx.close();

    // 5. Android: the browser offers installing → a real Install button; Not now hides it for 30 days.
    ({ ctx, page } = await open("", { seed: { recents: ["Avocado"] } }));
    await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); dispatchEvent(e); });
    ok(await visible(page, "#installBar") && await visible(page, "#installBtn"), "Android: an install banner with an Install button");
    await page.click("#installBtn");
    ok(await page.evaluate(() => window.__prompted === true), "Install opens the browser's own install prompt");
    await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: "dismissed" }); dispatchEvent(e); });
    await page.click("#installNo");
    ok(!(await visible(page, "#installBar")), "Not now hides the banner");
    await page.reload(); await page.waitForSelector("#out h2");
    await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => {}; dispatchEvent(e); });
    ok(!(await visible(page, "#installBar")), "and it stays hidden after a reload");
    await ctx.close();

    // 6. iPhone Safari: no install button exists there, so the banner shows the Share steps.
    ({ ctx, page } = await open("", { userAgent: IPHONE_UA, seed: { recents: ["Avocado"] } }));
    const t = await page.evaluate(() => document.getElementById("installBar").hidden ? "" : document.getElementById("installTxt").textContent);
    ok(/Add it to your home screen: tap\s+Share, then Add to Home Screen\./.test(t) && !(await visible(page, "#installBtn")), `iPhone: the banner shows the Share → Add to Home Screen steps (${t})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "app3-iphone-banner.png") });
    await page.click('#tabs [data-view="goals"]');
    ok(/iPhone or iPad \(Safari\): tap\s+Share/.test(await page.textContent("#installHow")), "Goals always has the full install steps");
    await ctx.close();

    // 6a. Two products side by side in the store (two milks): scan one, then the other, and see them compared.
    ({ ctx, page } = await open("?source=app", { permissions: ["camera"] }));
    const MILK = {
      "0096619100017": { product_name: "Whole milk", serving_size: "1 cup (240 mL)", serving_quantity: 240, categories_tags: ["en:dairies", "en:milks", "en:whole-milks"],
        nutriments: { "energy-kcal_serving": 150, fat_serving: 8, "saturated-fat_serving": 5, "trans-fat_serving": 0, cholesterol_serving: 0.035, sodium_serving: 0.12, carbohydrates_serving: 12, fiber_serving: 0, sugars_serving: 12, "added-sugars_serving": 0, proteins_serving: 8 } },
      "0096619100024": { product_name: "Reduced fat 2% milk", serving_size: "1 cup (240 mL)", serving_quantity: 240, categories_tags: ["en:dairies", "en:milks", "en:semi-skimmed-milks"],
        nutriments: { "energy-kcal_serving": 120, fat_serving: 5, "saturated-fat_serving": 3, "trans-fat_serving": 0, cholesterol_serving: 0.02, sodium_serving: 0.12, carbohydrates_serving: 12, fiber_serving: 0, sugars_serving: 12, "added-sugars_serving": 0, proteins_serving: 8 } },
    };
    await page.route("**/world.openfoodfacts.org/**", r => { const c = (r.request().url().match(/product\/(\d+)/) || [])[1]; return r.fulfill({ contentType: "application/json", body: JSON.stringify(MILK[c] ? { code: c, status: 1, product: MILK[c] } : { status: 0 }) }); });
    ok(await visible(page, "#cmpBig"), "the home has 'Compare two products'");
    await page.click("#cmpBig");
    await page.waitForFunction(() => /first/.test(document.getElementById("scanMsg").textContent));
    await page.fill("#code", "0096619100017"); await page.click("#codeForm button[type=submit]");
    await page.waitForFunction(() => /Whole milk/.test(document.querySelector("#out h2") && document.querySelector("#out h2").textContent) && !document.getElementById("scan").hidden && /second product to compare with Whole milk/.test(document.getElementById("scanMsg").textContent), null, { timeout: 15000 });
    ok(true, "after the first product, the scanner reopens and asks for the second");
    await page.fill("#code", "0096619100024"); await page.click("#codeForm button[type=submit]");
    await page.waitForSelector("#out .compare .ctable", { timeout: 15000 });
    const cmp = await page.evaluate(() => {
      const t = document.querySelector("#out .compare .ctable"), side = document.querySelector("#out .side");
      const kids = [...side.children].map(c => c.className);
      return { head: [...t.querySelectorAll("thead th")].map(th => th.textContent.replace(/\s+/g, " ").trim()), wins: [...t.querySelectorAll("td.win")].map(td => td.parentElement.firstChild.textContent + "=" + td.textContent),
        nearTop: kids.indexOf("panel compare") > -1 && kids.indexOf("panel compare") <= 3, wide: t.scrollWidth <= t.parentElement.clientWidth + 1, inView: t.getBoundingClientRect().top < innerHeight };
    });
    ok(/Whole milk/.test(cmp.head[1]) && /Reduced fat 2% milk/.test(cmp.head[2]) && cmp.wins.some(w => /^Sat/.test(w) && /3/.test(w)), `the second scan is compared with the first, side by side (${cmp.head.slice(1).join(" | ")}; better: ${cmp.wins.join(", ")})`);
    const sum = await page.textContent("#out .cmpsum");
    ok(/^Reduced fat 2% milk has less saturated fat\. Both: In moderation\.$/.test(sum.trim()), `a one-line answer above the table (${sum.trim()})`);
    ok(cmp.nearTop && cmp.wide, `the comparison sits right under the verdict and fits a phone screen (${JSON.stringify(cmp)})`);
    // Shelf prices: type the two tags, and the table adds the price of a serving and protein per dollar.
    ok(await page.evaluate(() => document.querySelector("#out .compare details.shelf").open), "with no prices yet, the Shelf prices form is open under the table");
    await page.fill("#shp0", "3.99"); await page.fill("#shs0", "1 gal");
    await page.fill("#shp1", "$4.29"); await page.fill("#shs1", "half gallon");
    await page.click("#out .shelf-prices button[type=submit]");
    await page.waitForFunction(() => [...document.querySelectorAll("#out .ctable td")].some(td => td.textContent === "Price"));
    const priceRows = await page.evaluate(() => [...document.querySelectorAll("#out .ctable tr")].filter(r => /^(Price|Protein per \$1)$/.test(r.firstChild.textContent)).map(r => [...r.children].map(c => c.textContent + (c.classList.contains("win") ? "*" : "")).join(" | ")));
    ok(priceRows[0] === "Price | $0.25* | $0.54" && priceRows[1] === "Protein per $1 | 32 g* | 15 g", `shelf prices give the price of a serving and protein per $1, the better one marked (${priceRows.join(" ; ")})`);
    await page.fill("#q", "Avocado"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Avocado/.test(document.querySelector("#out h2").textContent));
    await page.fill("#q", "0096619100017"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Whole milk/.test(document.querySelector("#out h2").textContent));
    ok(/Your price: \$0\.25/.test(await page.textContent("#out")), "the shelf price is kept for the scanned product's own page");
    await page.fill("#q", "Avocado"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Avocado/.test(document.querySelector("#out h2").textContent));
    await page.evaluate(() => { const q = document.getElementById("q"); q.value = "Whole milk"; document.getElementById("form").requestSubmit(); });
    await page.waitForFunction(() => /Whole milk/.test(document.querySelector("#out h2").textContent) && /Typical values/.test(document.getElementById("out").textContent));
    ok(!/Your price/.test(await page.textContent("#out")), "and the built-in 'Whole milk' keeps its typical price: prices go by barcode");
    await page.fill("#q", "0096619100017"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Whole milk/.test(document.querySelector("#out h2").textContent) && /Open Food Facts/.test(document.getElementById("out").textContent));
    await page.fill("#out .compare #cmpq", "Reduced fat 2% milk"); await page.press("#out .compare #cmpq", "Enter");
    await page.waitForSelector("#out .compare .ctable");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "app5-compare.png"), fullPage: true });
    // From the product page too: recent scans are one tap away.
    await page.click("#out .compare button:has-text('Clear comparison')");
    const chips = await page.$$eval("#out .compare [aria-label='Compare with a recent scan'] .chip", b => b.map(x => x.textContent));
    ok(chips.includes("Reduced fat 2% milk") && await page.isVisible("#out .compare button:has-text('Scan to compare')"), `a product's Compare panel offers 'Scan to compare' and recent scans (${chips.join(", ")})`);
    await ctx.close();

    // 6c. A mistyped crowd-sourced record (Kirkland's oat drink on Open Food Facts, Oct 31, 2026): impossible numbers
    // are left out and the card says so, including for a copy saved on the phone before this check existed.
    const OAT = { product_name: "Oat", brands: "Kirkland Signature", serving_size: "240g", serving_quantity: 240, categories_tags: ["en:beverages", "en:dairy-substitutes"],
      nutriments: { "energy-kcal_serving": 120, fat_serving: 5, "saturated-fat_serving": 0.5, "trans-fat_serving": 12, cholesterol_serving: 0.0408, sodium_serving: 240, carbohydrates_serving: 40.8, fiber_serving: 4.8, sugars_serving: 16.8, "added-sugars_serving": 0, proteins_serving: 3 } };
    const oldCopy = { n: "Kirkland Signature Oat", a: [], s: "240g", c: "lookup", tags: [], src: "off", code: "0096619237432", cal: 120, fat: 5, sat: 0.5, trans: 12, chol: 40.8, na: 240000, carb: 40.8, fib: 4.8, sug: 16.8, add: 0, pro: 3, missing: [], categories: ["en:dairy-substitutes"], addLikelyZero: false };
    ({ ctx, page } = await open("", { seed: { lookups: [oldCopy] } }));
    await page.route("**/world.openfoodfacts.org/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ code: "0096619237432", status: 1, product: OAT }) }));
    await page.fill("#q", "Kirkland Signature Oat"); await page.press("#q", "Enter");
    await page.waitForSelector("#out .partial-note > span");
    // A barcode typed in the search box is looked up as a barcode, whether you press Check or tap the suggestion row.
    await page.fill("#q", ""); await page.type("#q", "0096619237432");
    const row = await page.textContent("#suggest li.action");
    await page.click("#suggest li.action");
    // Wait for the card's note, not the words: "…numbers look wrong. Checking USDA…" shows while the second opinion loads.
    await page.waitForSelector("#out .partial-note > span");
    ok(/^Look up barcode 0096619237432$/.test(row.trim()), `typing a barcode offers 'Look up barcode', and it finds the product (${row.trim()})`);
    const oat = await page.evaluate(() => ({ note: document.querySelector("#out .partial-note > span").textContent, more: document.querySelector("#out .issue-more").textContent.replace(/\s+/g, " "), open: document.querySelector("#out .issue-more").open, label: document.querySelector("#out .leftcol").textContent.replace(/\s+/g, " ") }));
    ok(oat.note === "Some numbers look wrong (sodium, trans fat, cholesterol), so they aren't counted. Check the package." && !oat.open && /Sodium 240,000 mg in a 240 g serving/.test(oat.more) && /about 211 calories, not the 120 listed/.test(oat.more) && /Fix it on Open Food Facts/.test(oat.more),
      `a copy saved before the check is fixed on load, and the card says what was wrong (${oat.note})`);
    ok(/Sodium —/.test(oat.label) && !/240,000mg/.test(oat.label) && /Trans Fat —/.test(oat.label), "the label shows those lines as unknown, not the impossible numbers");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "app6-bad-record.png"), fullPage: false });
    ok(await page.$$eval("#out .partial-note", n => n.length) === 1, "the impossible values aren't repeated as 'not reported'");
    // When USDA has the barcode (here a record made up for the test, per 100 g as USDA stores it), its sound numbers
    // replace the broken ones, and the card says why.
    const per100 = { 1008: 50, 1004: 2.08, 1258: 0.21, 1257: 0, 1253: 0, 1093: 41.7, 1005: 6.67, 1079: 0.83, 2000: 2.92, 1235: 0, 1003: 1.25 };
    const USDA_OAT = { fdcId: 999001, description: "OAT BEVERAGE", dataType: "Branded", gtinUpc: "096619237432", brandOwner: "Costco Companies Inc.", brandName: "KIRKLAND SIGNATURE",
      servingSizeUnit: "ml", servingSize: 240, householdServingFullText: "1 cup", foodNutrients: Object.entries(per100).map(([id, value]) => ({ nutrientId: Number(id), value })) };
    await page.route("**/api.nal.usda.gov/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ foods: [USDA_OAT] }) }));
    await page.evaluate(() => { localStorage.removeItem("lookups"); });
    await page.reload(); await page.waitForSelector("#out h2");
    await page.fill("#q", "0096619237432"); await page.press("#q", "Enter");
    await page.waitForFunction(() => /uses the brand's own label data/.test(document.getElementById("out").textContent), null, { timeout: 15000 });
    const second = await page.evaluate(() => ({ notes: document.querySelectorAll("#out .partial-note").length, label: document.querySelector("#out .leftcol").textContent.replace(/\s+/g, " ") }));
    ok(second.notes === 0 && /Sodium 100mg/.test(second.label) && /Trans Fat 0g/.test(second.label), `Open Food Facts' broken record is replaced by USDA's, and the card says why (${second.label.slice(0, 90)}…)`);
    // Scanned once, it's remembered by barcode: the second time needs no network at all.
    let calls = 0; await page.route("**/world.openfoodfacts.org/**", r => { calls++; r.abort(); }); await page.route("**/api.nal.usda.gov/**", r => { calls++; r.abort(); });
    await page.fill("#q", "Avocado"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Avocado/.test(document.querySelector("#out h2").textContent));
    await page.fill("#q", "0096619237432"); await page.press("#q", "Enter");
    await page.waitForFunction(() => /uses the brand's own label data/.test(document.getElementById("out").textContent), null, { timeout: 5000 });
    ok(calls === 0, `a barcode scanned before opens from this device, with no lookup (${calls} requests)`);
    await ctx.close();
    // A missing number gets a sentence only when it could change the verdict.
    const cola = { n: "Test cola", a: [], s: "355 ml", c: "lookup", tags: [], src: "off", code: "1", cal: 140, fat: 0, sat: 0, trans: 0, chol: 0, na: 0, carb: 39, fib: 0, sug: 39, add: 39, pro: 0, missing: ["na", "fib"], checked: 1, addLikelyZero: false };
    const oats = { n: "Test oats", a: [], s: "1 packet (40 g)", c: "lookup", tags: [], src: "off", code: "2", cal: 150, fat: 3, sat: 0.5, trans: 0, chol: 0, na: 0, carb: 27, fib: 4, sug: 1, add: 0, pro: 5, missing: ["na"], checked: 1, addLikelyZero: false };
    ({ ctx, page } = await open("", { seed: { lookups: [cola, oats] } }));
    await page.fill("#q", "Test cola"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Test cola/.test(document.querySelector("#out h2").textContent));
    const colaNote = await page.$$eval("#out .partial-note", n => n.map(x => x.textContent));
    await page.fill("#q", "Test oats"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Test oats/.test(document.querySelector("#out h2").textContent));
    const oatsNote = await page.$$eval("#out .partial-note", n => n.map(x => x.textContent));
    ok(colaNote.length === 0 && oatsNote.length === 1 && oatsNote[0] === "Sodium isn't listed for this product, so the verdict could change. Check the package.",
      `missing sodium: no note on cola (Limit it either way); one plain sentence on oats, where it matters (${JSON.stringify(oatsNote)})`);
    await ctx.close();

    // 6b. A photo of the label (a real one: Skippy peanut butter, Open Food Facts, CC BY-SA 3.0), read on the phone,
    // checked, then scored. Tesseract loads from vendor/tesseract/ only now.
    ({ ctx, page } = await open("?source=app"));
    const tess = []; page.on("request", r => { if (/vendor\/tesseract\//.test(r.url())) tess.push(r.url()); });
    ok(await visible(page, "#labelBtn") && tess.length === 0, "the home offers 'Read a photo of the label', and the reader isn't loaded until it's used");
    const chooser = page.waitForEvent("filechooser");
    await page.click("#labelBtn");
    await (await chooser).setFiles(path.join(ROOT, "tests/fixtures/label-skippy.jpg"));
    await page.waitForSelector("#out .lform input[name=cal]", { timeout: 90000 });
    const vals = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#out .lform input")].map(i => [i.name, i.value])));
    ok(vals.cal === "190" && vals.fat === "16" && vals.pro === "7" && /^2 Tbsp/.test(vals.serving), `the photo is read into a form to check (${JSON.stringify(vals)})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "app4-label-form.png"), fullPage: true });
    await page.addScriptTag({ content: fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const v = await page.evaluate(async () => (await axe.run(document.querySelector("#out .notice"), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(x => `${x.id}: ${x.nodes[0].target}`));
      ok(!v.length, `the form, ${scheme}: no WCAG A/AA violations${v.length ? ": " + v.join(", ") : ""}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.fill("#out .lform input[name=pname]", "Skippy creamy peanut butter");
    await page.click("#out .lform button[type=submit]");
    await page.waitForFunction(() => /From a photo of the label/.test(document.getElementById("out").textContent));
    const card = await page.textContent("#out");
    ok(/Skippy creamy peanut butter/.test(card) && /(Get it|In moderation|Limit it)/.test(card), "checking the numbers shows the verdict card, sourced to the photo");
    ok(tess.some(u => /eng\.traineddata\.gz/.test(u)) && !tess.some(u => !/localhost/.test(u)), "everything it loaded came from this site (no outside servers)");
    await ctx.close();

    // 6d. Goals: "About you" puts a suggestion beside each target; using them saves; the answers aren't kept.
    ({ ctx, page } = await open(""));
    await page.click('#tabs button[data-view="goals"]');
    ok(!(await page.$(".sghint")) && /Fill these in/.test(await page.textContent(".sgstatus")), "before About you is filled in: no suggestions, just a prompt");
    await page.fill("#sg-age", "32"); await page.click("#sg-sex-male"); await page.fill("#sg-ft", "5"); await page.fill("#sg-in", "10"); await page.fill("#sg-lb", "170");
    await page.waitForSelector(".sghint");
    const hint = id => page.evaluate(i => document.getElementById(i).closest(".tcell").querySelector(".sghint").textContent.replace(/\s+/g, " ").trim(), id);
    const hints = { cal: await hint("p-cal"), pro: await hint("p-pro"), fib: await hint("p-fib"), sat: await hint("p-sat"), na: await hint("p-na"), add: await hint("p-add") };
    ok(/2,400/.test(hints.cal) && /60/.test(hints.pro) && /34/.test(hints.fib) && /26/.test(hints.sat) && /✓ Suggested/.test(hints.na) && /60/.test(hints.add), `a suggestion beside each target for a 32-year-old, 5'10", 170 lb man (${JSON.stringify(hints)})`);
    ok(/2,400 cal · 60 g protein/.test(await page.textContent(".sgstatus")), "a one-line summary under About you");
    ok(!/null/.test(await page.textContent("#profile")), "no stray text");
    ok(await page.evaluate(() => !document.querySelector("label .sghint")), "suggestions aren't part of the boxes' labels");
    await page.click(".tcell:has(#p-pro) .sguse");
    await page.waitForFunction(() => document.getElementById("p-pro").value === "60");
    ok(/✓ Suggested/.test(await hint("p-pro")), "using one suggestion fills that box and marks it");
    await page.click("#sgAll"); // the weight box may still be focused: leaving it must not swap the button out
    await page.waitForFunction(() => document.getElementById("p-cal").value === "2400");
    const [saved, allStored] = await page.evaluate(() => [JSON.parse(localStorage.getItem("profile") || "null"), JSON.stringify({ ...localStorage })]);
    ok(saved && saved.cal === 2400 && saved.pro === 60 && saved.fib === 34 && saved.sat === 26 && saved.add === 60 && saved.na === 2300 && !("age" in saved) && !/\b170\b|"age"|"weight"|"height"/.test(allStored),
      "'Use all suggestions' fills and saves the six targets, and nothing about age, height or weight is stored");
    ok(await page.evaluate(() => document.getElementById("sgAll").hidden && document.querySelectorAll(".sgok").length === 6), "once they all match: every target says ✓ and the button goes away");
    await page.click("#sg-preg");
    ok(/pregnancy/.test(await page.textContent(".sgstatus")) && !(await page.$(".sghint")), "pregnant or breastfeeding: no numbers, ask a doctor or dietitian");
    await page.click("#sg-preg"); await page.fill("#sg-age", "16");
    ok(/for adults/.test(await page.textContent(".sgstatus")), "under 18: no numbers");
    await page.fill("#sg-age", "32");
    await page.setViewportSize({ width: 1100, height: 900 });
    if (SHOTS) await page.locator("#profile").screenshot({ path: path.join(SHOTS, "app7-suggest-targets-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    if (SHOTS) await page.locator("#profile").screenshot({ path: path.join(SHOTS, "app7-suggest-targets.png") });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "fits a 390 px phone without sideways scrolling");
    await ctx.close();

    // 7. On a computer the phone home stays out of the way.
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    const pc = await c.newPage(); await pc.goto(base); await pc.waitForSelector("#out h2");
    ok(!(await visible(pc, "#appHome")) && !(await visible(pc, "#installBar")), "on a computer: no scan home and no install banner");
    await c.close();
  } finally { await browser.close(); srv.close(); }
  console.log(fails ? `${fails} app check(s) failed` : "All app checks passed");
  process.exit(fails ? 1 : 0);
})();
