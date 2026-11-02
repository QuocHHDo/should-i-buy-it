// Real-browser layout checks (Playwright + Chromium): things jsdom can't measure.
//   node tests/ui/layout.js            (needs `playwright` and a Chromium; skipped with a note if missing)
// Serves the repo on a local port and mocks USDA / Open Food Facts with the test fixtures, so it runs offline.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("SKIP layout checks: playwright is not installed"); process.exit(0); }

const ROOT = path.join(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const fixture = n => fs.readFileSync(path.join(ROOT, "tests", "fixtures", n), "utf8");

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

async function newPage(browser, base, width, height = 800) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.route("**/api.nal.usda.gov/**", r => r.fulfill({ contentType: "application/json", body: fixture("usda-search.json") }));
  await page.route("**/world.openfoodfacts.org/**", r => r.fulfill({ contentType: "application/json", body: fixture("off-nutella.json") }));
  page.on("pageerror", e => { fails++; console.log("FAIL page error: " + e.message); });
  await page.goto(base);
  await page.waitForSelector("#out h2");
  return { ctx, page };
}

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); };

async function openFood(page, name) {
  await page.fill("#q", name);
  await page.press("#q", "Enter");
  await page.waitForFunction(n => document.querySelector("#out h2")?.textContent === n, name);
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 375]) {
      const { ctx, page } = await newPage(browser, base, width);
      await openFood(page, "Ground beef 80/20");
      // 11. Saving must not move the action buttons or the label.
      const boxes = () => page.$$eval("#out .result-head .icon-btn, #out .label", els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; }));
      const before = await boxes();
      await shot(page, `11-before-save-${width}`);
      await page.click("#out .result-head .icon-btn[aria-pressed]");
      await page.waitForFunction(() => document.querySelector("#out .result-head .icon-btn[aria-pressed]").getAttribute("aria-pressed") === "true");
      const after = await boxes();
      await shot(page, `11-after-save-${width}`);
      ok(JSON.stringify(before) === JSON.stringify(after), `${width}px: Save doesn't move the buttons or label (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
      // Saving several more foods keeps the shelf one line high.
      const shelfH = await page.$eval("#shelf", e => e.getBoundingClientRect().height);
      for (const n of ["Avocado", "Eggs", "Shrimp", "Oatmeal, rolled oats", "Instant ramen"]) { await openFood(page, n); await page.click("#out .result-head .icon-btn[aria-pressed]"); }
      ok(Math.abs(await page.$eval("#shelf", e => e.getBoundingClientRect().height) - shelfH) < 1, `${width}px: favorites shelf keeps its height`);
      // Goal validation: -500 then Tab leaves one consistent state, and the row of inputs doesn't shift.
      await page.click('#tabs [data-view="goals"]');
      const goalBoxes = () => page.$$eval(".pgrid input[type=number]", els => { const t0 = document.querySelector(".pgrid").getBoundingClientRect().top; return els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.top - t0), Math.round(r.height)]; }); });
      const g0 = await goalBoxes();
      await page.fill("#p-cal", "-500"); await page.press("#p-cal", "Tab"); await page.waitForTimeout(50);
      const st = await page.evaluate(() => ({ v: document.getElementById("p-cal").value, inv: document.getElementById("p-cal").getAttribute("aria-invalid"), msg: document.getElementById("p-cal-err").textContent }));
      ok(st.v === "-500" && st.inv === "true" && /Still using 2,000/.test(st.msg), `${width}px: -500 + Tab keeps the typed value with its error (${st.v} · ${st.msg})`);
      const g1 = await goalBoxes();
      // Empty error slots take no room (no blank gaps between rows), so only rows below the error may move down to make room for it.
      const row0 = g0[0][0], same = (a, b) => JSON.stringify(a.filter(x => x[0] <= row0)) === JSON.stringify(b.filter(x => x[0] <= row0));
      ok(same(g0, g1) && g1.every((x, i) => x[1] === g0[i][1]), `${width}px: the field with the error and its row don't move, and no input changes size (${JSON.stringify(g0)} → ${JSON.stringify(g1)})`);
      await page.locator("#p-cal").scrollIntoViewIfNeeded(); await shot(page, `r2-6-goal-error-${width}`);
      await page.fill("#p-cal", "2000"); await page.press("#p-cal", "Tab");
      await page.click('#tabs [data-view="check"]');
      await ctx.close();
    }
    // 15. Phones: verdict above the label and above the fold; nothing wider than the screen.
    for (const [width, height] of [[320, 568], [375, 667], [414, 896]]) {
      const { ctx, page } = await newPage(browser, base, width, height);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const states = {
        "result": async () => openFood(page, "Ground beef 80/20"),
        "long name": async () => openFood(page, "Bubble milk tea, regular sugar"),
        "compare": async () => { await page.fill("#cmpq", "chicken breast"); await page.waitForSelector(".compare .suggest li"); await page.dispatchEvent(".compare .suggest li", "mousedown"); await page.waitForSelector(".ctable"); },
        "barcode": async () => { await page.fill("#q", "3017620422003"); await page.press("#q", "Enter"); await page.waitForFunction(() => /Nutella/i.test(document.querySelector("#out h2")?.textContent || "")); },
        "browse": async () => { await page.click('#tabs [data-view="browse"]'); await page.waitForSelector("#blist .bitem"); },
        "quiz": async () => { await page.click('#tabs [data-view="browse"]'); await page.click("#learn > summary"); await page.waitForSelector("#quiz button"); },
        "plate": async () => { await openFood(page, "Brown rice"); await page.click("#out .actions button:nth-child(3)"); await page.click('#tabs [data-view="plate"]'); await page.click("#plateView"); await page.waitForFunction(() => document.querySelector("#out h2")?.textContent === "Your plate"); },
      };
      for (const [name, go] of Object.entries(states)) {
        await go();
        ok(await overflow() <= 0, `${width}px ${name}: no horizontal scroll (overflow ${await overflow()} px)`);
      }
      await openFood(page, "Ground beef 80/20");
      await page.evaluate(() => window.scrollTo(0, 0));
      const pos = await page.evaluate(() => {
        const t = document.querySelector("#out .tag .verdict").getBoundingClientRect(), l = document.querySelector("#out .label").getBoundingClientRect();
        // On phones the tab bar covers the bottom of the screen, so "above the fold" means above the bar.
        return { tagTop: t.top, tagBottom: t.bottom, labelTop: l.top, vh: Math.min(innerHeight, document.getElementById("tabs").getBoundingClientRect().top || innerHeight),
          bar: (() => { const b = document.getElementById("tabs").getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; })(), ih: innerHeight };
      });
      ok(pos.tagTop < pos.labelTop, `${width}px: verdict comes before the label (${Math.round(pos.tagTop)} < ${Math.round(pos.labelTop)})`);
      ok(pos.tagBottom <= pos.vh, `${width}px: verdict is above the fold and the tab bar (bottom ${Math.round(pos.tagBottom)} of ${Math.round(pos.vh)})`);
      ok(Math.abs(pos.bar.bottom - pos.ih) < 1 && pos.bar.h >= 48 && pos.bar.h <= 80, `${width}px: tab bar sits at the bottom of the screen (${Math.round(pos.bar.top)}–${Math.round(pos.bar.bottom)} of ${pos.ih})`);
      // Scrolled to the very end, the last content clears the bar.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const clear = await page.evaluate(() => document.getElementById("tabs").getBoundingClientRect().top - document.querySelector("footer").getBoundingClientRect().bottom);
      ok(clear >= 0, `${width}px: the footer isn't hidden behind the tab bar (${Math.round(clear)} px clear)`);
      const shelf = await page.evaluate(() => { const s = document.getElementById("shelf"); return { h: s.getBoundingClientRect().height, scroll: s.scrollWidth > s.clientWidth, style: getComputedStyle(s).overflowX }; });
      ok(shelf.h < 48 && shelf.style === "auto", `${width}px: recents and favorites stay on one scrolling row (${Math.round(shelf.h)} px tall)`);
      // Every action button is fully on screen, with no sideways scroller hiding one.
      const acts = await page.evaluate(() => {
        const row = document.querySelector("#out .result-head .actions"), W = document.documentElement.clientWidth;
        return { scroll: row.scrollWidth - row.clientWidth, off: [...row.querySelectorAll("button")].filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > W || r.width === 0; }).map(b => b.getAttribute("aria-label") || b.textContent), n: row.querySelectorAll("button").length,
          copyName: (row.querySelector("[aria-label='Copy link']") || {}).getAttribute ? "Copy link" : null };
      });
      ok(acts.scroll <= 0 && acts.off.length === 0 && acts.n === 4 && acts.copyName, `${width}px: all ${acts.n} action buttons visible without scrolling (off-screen: ${acts.off.join(", ") || "none"})`);
      // The chip shelf hides its scrollbar and fades the edge when there's more to scroll.
      for (const n of ["Avocado", "Eggs", "Shrimp", "Salmon", "Oatmeal, rolled oats", "Instant ramen", "Brown rice"]) await openFood(page, n);
      await page.waitForTimeout(50);
      const sh2 = await page.evaluate(() => { const s = document.getElementById("shelf"); return { over: s.scrollWidth > s.clientWidth, sb: s.offsetHeight - s.clientHeight, fade: s.classList.contains("fade-end") }; });
      ok(sh2.over && sh2.sb === 0 && sh2.fade, `${width}px: shelf scrollbar hidden (${sh2.sb} px) and right edge fades`);
      await page.$eval("#shelf", s => { s.scrollLeft = s.scrollWidth; s.dispatchEvent(new Event("scroll")); }); await page.waitForTimeout(50);
      ok(await page.$eval("#shelf", s => s.classList.contains("fade-start") && !s.classList.contains("fade-end")), `${width}px: scrolled to the end, only the left edge fades`);
      await openFood(page, "Ground beef 80/20"); await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `15-mobile-${width}`);
      await ctx.close();
    }
    // New views fit a 320 px phone, and a transfer link copied on one device restores everything on a fresh one.
    {
      const a = await newPage(browser, base, 320, 640);
      const overflow = () => a.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      for (const n of ["Eggs", "Banana", "Bacon"]) { await openFood(a.page, n); await a.page.click("#out .actions button:nth-child(2)"); }
      await a.page.click('#tabs [data-view="list"]'); await a.page.waitForSelector(".ltotal");
      await a.page.click('#glistItems .qty button[aria-label="One more Eggs"]');
      ok(await overflow() <= 0, `320px list (sections, quantities, swap): no horizontal scroll (${await overflow()} px)`);
      await shot(a.page, "f2-list-320");
      await a.page.click('#tabs [data-view="plate"]'); await a.page.waitForSelector("#mealList .idea");
      ok(await overflow() <= 0, `320px meal ideas: no horizontal scroll (${await overflow()} px)`);
      await shot(a.page, "f3-meals-320");
      await a.page.click('#mealList .idea .btn:has-text("Use as my plate")');
      await a.page.click('#tabs [data-view="goals"]');
      ok(await overflow() <= 0, `320px goals and backup: no horizontal scroll (${await overflow()} px)`);
      const link = await a.page.evaluate(async () => location.origin + location.pathname + "#import=" +
        await SelfCheckBackup.encode(SelfCheckBackup.pack(k => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; })));
      const want = await a.page.evaluate(() => ["grocery", "plate", "recents"].map(k => localStorage.getItem(k)));
      await a.ctx.close();
      // Another device: a fresh browser profile opens the link cold.
      const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, serviceWorkers: "block" });
      const page = await ctx.newPage();
      page.on("pageerror", e => { fails++; console.log("FAIL page error: " + e.message); });
      await page.goto(link); await page.waitForSelector("#bkPreview .bk-preview");
      const pv = await page.evaluate(() => ({ t: document.getElementById("bkPreview").textContent, view: document.body.dataset.view, hash: location.hash, list: localStorage.getItem("grocery") }));
      ok(/3 grocery items/.test(pv.t) && pv.view === "goals" && pv.hash === "#goals" && !pv.list, `transfer link opens a preview on Goals and changes nothing yet (${pv.t.slice(0, 70)})`);
      await shot(page, "f1-import-preview-375");
      await Promise.all([page.waitForEvent("load"), page.click('#bkPreview .btn:has-text("Restore")')]);
      await page.waitForSelector("#out h2");
      const got = await page.evaluate(() => ["grocery", "plate", "recents"].map(k => localStorage.getItem(k)));
      ok(JSON.stringify(got) === JSON.stringify(want), "Restore brings over the list (with quantities), plate and recents");
      ok(await page.evaluate(() => document.getElementById("tabListN").textContent === "3" && !location.hash.includes("import")), "after restoring, the List tab shows 3 and the link is cleared");
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(fails ? `${fails} layout check(s) failed` : "All layout checks passed");
  process.exit(fails ? 1 : 0);
})();
