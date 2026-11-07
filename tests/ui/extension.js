// Real-browser check of the extension (Playwright + Chromium with the unpacked extension loaded).
//   node tests/ui/extension.js
// walmart.com pages are served from captured page data, inside a copy of the real product page's layout around the
// title (h1#main-title, the wrapping reviews-and-ratings row, pack sizes, and the buy box on the right), so the badge's
// placement is checked against the same structure. Open Food Facts and USDA are served from fixtures; it runs offline.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("SKIP extension check: playwright is not installed"); process.exit(0); }

const ROOT = path.join(__dirname, "..", "..");
const EXT = path.join(ROOT, "extension");
const SHOTS = process.env.SHOTS_DIR;
const { build } = require(path.join(ROOT, "tests/fixtures/walmart-compact.js"));
const PAGES = require(path.join(ROOT, "tests/fixtures/walmart-pages.json")).pages;
// The four pages the redesign was tested on, captured from walmart.com (Oct 26, 2026).
const LIVE = require(path.join(ROOT, "tests/fixtures/walmart-live.json")).pages;
for (const [k, v] of Object.entries(LIVE)) PAGES[k] = { props: { pageProps: { initialData: { data: build(v) } } } };
// Sam's Club pages, captured from samsclub.com (Oct 26, 2026); the site runs on Walmart's platform.
const SAMS = require(path.join(ROOT, "tests/fixtures/samsclub-live.json")).pages;
for (const [k, v] of Object.entries(SAMS)) PAGES["sams-" + k] = { props: { pageProps: { initialData: { data: build(v) } } } };
const SAMS_ID = { "1600043509": "sams-cheerios", "18638953319": "sams-bananas", "15390012477": "sams-towels", "18691360382": "sams-redcon1" };
// Costco pages, rebuilt from live costco.com pages (Oct 26, 2026): JSON-LD and the item's record, no Nutrition Facts.
// Its layout: the title, then a full-width review block whose stars widget renders after load, then price and Add to cart.
const CO = require(path.join(ROOT, "tests/fixtures/costco-live.js"));
const CO_ID = Object.fromEntries(Object.entries(CO.ITEMS).map(([k, v]) => [v.pageId, k]));
const costcoHtml = k => CO.html(k, { layout: `<style>body{margin:0;font:14px Arial,sans-serif} .wrap{display:grid;grid-template-columns:700px 539px;gap:40px;padding:120px 20px 0}
.gallery{height:520px;background:#eee} button{display:block;width:100%;height:44px;margin-top:8px;border:0;background:#005dab;color:#fff;font-weight:700}</style>
<div class="wrap"><div class="gallery">photos</div><div><h1 style="font-size:24px;margin:4px 0">${CO.ITEMS[k].name}</h1>
<div id="CostcoBVReviewContainer" data-bv-show="rating_summary" style="height:28px"></div>
<style>[data-bv-show=rating_summary] div, [data-bv-show=rating_summary] span { position: static !important; display: block !important; margin: 0 !important }</style>
<div id="price" style="font-size:28px;font-weight:700;margin-top:12px">$${CO.ITEMS[k].price}</div><button id="atc">Add to Cart</button><section style="height:900px"></section></div></div>
<script>setTimeout(() => { document.getElementById("CostcoBVReviewContainer").innerHTML = '<span style="display:inline-flex;gap:6px;height:28px;align-items:center;width:316px;white-space:nowrap">★★★★★ 4.8 (512) <a href="#">Write a review</a></span>'; }, 600);</script>` });
// A pre-workout (Supplement Facts), built from the label on the real page the user checked.
const SUPPS = require(path.join(ROOT, "tests/fixtures/walmart-supplements.json")).pages;
for (const [k, v] of Object.entries(SUPPS)) PAGES["supp-" + k] = { props: { pageProps: { initialData: { data: build(v) } } } };
const BY_ID = { "363183524": "cheerios", "5072512866": "oikos", "10315479": "peanut-butter", "51259338": "banana",
  "12166733": "coke", "12166734": "dietcokecf", "16435600213": "supp-labeled", "16435600214": "supp-photo", "10295207": "honeybuns", "345611875": "reseller", "683540269": "tv" };
const C_ID = u => (String(u).match(/\/p\/-\/[^/?#]+\/(\d+)/) || [])[1];
const nameOf = k => { const d = PAGES[k].props.pageProps.initialData.data.product; return d.name; };
// Walmart's layout around the title: the rating row is a wrapping flex row 486 px wide whose stars take 183 px; pack sizes
// follow below it; the buy box (price, You save, Add to cart, Buy now) is a column on the right. `noRating` drops the row.
const pageHtml = (k, { noRating = false } = {}) => `<!doctype html><html><head><meta charset="utf-8"><title>${k}</title>
<style>body{margin:0;font:14px Arial,sans-serif} .wrap{display:grid;grid-template-columns:780px 486px 360px;gap:40px;padding:120px 20px 0}
.gallery{height:520px;background:#eee} .flex{display:flex} .flex-wrap{flex-wrap:wrap} .buy{background:#f6f6f6;padding:16px;border-radius:8px}
.buy button{display:block;width:100%;height:40px;margin-top:8px;border-radius:20px;border:0;background:#0071dc;color:#fff;font-weight:700}
.pack button{width:90px;height:56px;margin-right:6px}</style></head><body>
<div class="wrap"><div class="gallery">photos</div>
<div><section><a href="#">${nameOf(k).split(" ")[0]}</a></section><section><h1 id="main-title" itemprop="name" style="font-size:20px;margin:4px 0">${nameOf(k)}</h1></section>
${noRating ? "" : `<div><div data-testid="reviews-and-ratings" class="flex flex-wrap" style="padding-bottom:16px;align-items:center"><div style="width:183px;height:25px;margin-bottom:-9px;white-space:nowrap;font-size:12px;line-height:25px">★★★★★ (4.7) | 6,103 ratings</div></div></div>`}
<hr><div class="pack"><div>Pack Size: 12 Pack</div><button id="pack">12 Pack $7.77</button><button>2 Pack</button></div>
<section style="height:900px"><h2>Ingredients</h2></section></div>
<div><div class="buy" style="position:sticky;top:120px"><div style="font-size:28px;font-weight:700">$7.77</div><div id="yousave">You save $0.89</div><button id="atc">Add to cart</button><button id="bn">Buy now</button></div></div></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(PAGES[k])}</script></body></html>`;
// Open Food Facts: the Diet Coke record (a crowd-sourced one that leaves out added sugar) and the peanut butter record.
const OFF = {
  // A cola record that leaves out sodium (a daily limit), so the verdict could change once it's known.
  "049000028904": { status: 1, product: { product_name: "Coca-Cola", serving_size: "355 ml", serving_quantity: 355, categories_tags: ["en:beverages", "en:sodas"],
    nutriments: { "energy-kcal_serving": 140, fat_serving: 0, "saturated-fat_serving": 0, carbohydrates_serving: 39, sugars_serving: 39, "added-sugars_serving": 39, proteins_serving: 0 } } },
  "049000029345": { status: 1, product: { product_name: "Diet Coke caffeine free", serving_size: "355 ml", serving_quantity: 355, categories_tags: ["en:beverages", "en:carbonated-drinks", "en:sodas", "en:diet-sodas"],
    nutriments: { "energy-kcal_serving": 0, fat_serving: 0, "saturated-fat_serving": 0, sodium_serving: 0.04, carbohydrates_serving: 0, sugars_serving: 0, proteins_serving: 0 } } },
  // Cheerios as Costco sells them (the 2-count box's barcode).
  "016000435094": { status: 1, product: { product_name: "Cheerios", serving_size: "1.5 cup (39 g)", serving_quantity: 39, categories_tags: ["en:breakfast-cereals"],
    nutriments: { "energy-kcal_serving": 140, fat_serving: 2.5, "saturated-fat_serving": 0.5, "trans-fat_serving": 0, sodium_serving: 0.19, carbohydrates_serving: 29, fiber_serving: 4, sugars_serving: 2, "added-sugars_serving": 2, proteins_serving: 5 } } },
  "078742370033": { status: 1, product: { product_name: "Hannaford Peanut butter", serving_size: "2 tbsp. (32 g)", serving_quantity: 32,
    nutriments: { "energy-kcal_serving": 180, fat_serving: 16, "saturated-fat_serving": 3, "trans-fat_serving": 0, cholesterol_serving: 0, sodium_serving: 0.135, carbohydrates_serving: 7, fiber_serving: 2, sugars_serving: 3, "added-sugars_serving": 2, proteins_serving: 7 },
    categories_tags: ["en:spreads", "en:nut-butters", "en:peanut-butters"], ingredients_text: "Roasted Peanuts, Sugar, Hydrogenated Vegetable Oil (Rapeseed, Cottonseed, Soybean), Salt, Molasses, Mono-and Diglycerides." } },
};

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sib-ext-"));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(dir, { channel: "chromium", headless: true, viewport: { width: 1910, height: 912 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  } catch (e) { console.log("SKIP extension check: this Chromium can't load extensions (" + e.message.split("\n")[0] + ")"); process.exit(0); }
  try {
    const hits = { ip: [], off: 0 };
    const SEARCH = `<!doctype html><title>search</title><div style="display:grid;grid-template-columns:repeat(4,240px);gap:12px">${[["Oikos-Pro", "5072512866"], ["Cheerios", "363183524"], ["Bananas", "51259338"], ["HDMI-Cable", "683540269"]]
      .map(([n, id]) => `<div data-item-id="T${id}" role="group" style="height:300px;border:1px solid #ddd"><div style="height:200px;background:#eee"><img alt="" width="200" height="200" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><a href="/ip/${n}/${id}">${n}</a></div>`).join("")}</div>`;
    let variant = {};
    await ctx.route("https://www.walmart.com/**", r => {
      if (/\/search\?/.test(r.request().url())) return r.fulfill({ contentType: "text/html", body: SEARCH });
      const id = (r.request().url().match(/\/ip\/(?:[^/?#]+\/)?(\d+)/) || [])[1];
      if (id) hits.ip.push({ id, t: Date.now() });
      return BY_ID[id] ? r.fulfill({ contentType: "text/html", body: pageHtml(BY_ID[id], variant) }) : r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Walmart</title><p>home</p>" });
    });
    await ctx.route("https://www.samsclub.com/**", r => {
      if (/\/search\?/.test(r.request().url())) { hits.samsSearch = (hits.samsSearch || 0) + 1; return r.fulfill({ contentType: "text/html", body: SEARCH.replace(/\/ip\/[^"]+\/(\d+)/g, (m, id) => m) }); }
      const id = (r.request().url().match(/\/ip\/(?:[^/?#]+\/)?(\d+)/) || [])[1];
      if (id) hits.samsIp = (hits.samsIp || 0) + 1;
      return SAMS_ID[id] ? r.fulfill({ contentType: "text/html", body: pageHtml(SAMS_ID[id]) }) : r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Sam's Club</title><p>home</p>" });
    });
    await ctx.route("https://gdx-assets.costco.com/**", r => r.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(path.join(ROOT, "tests/fixtures/label-skippy.jpg")), headers: { "access-control-allow-origin": "*" } }));
    await ctx.route("https://www.costco.com/**", r => {
      const id = C_ID(r.request().url());
      if (/gdx-assets\.costco\.com\/test\/pb-label\.jpg/.test(r.request().url())) return r.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(path.join(ROOT, "tests/fixtures/label-skippy.jpg")), headers: { "access-control-allow-origin": "*" } });
      return CO_ID[id] ? r.fulfill({ contentType: "text/html", body: costcoHtml(CO_ID[id]) }) : r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Costco</title><p>home</p>" });
    });
    await ctx.route("https://world.openfoodfacts.org/**", r => { hits.off++; const code = (r.request().url().match(/product\/(\d+)/) || [])[1]; return r.fulfill({ contentType: "application/json", body: JSON.stringify(OFF[code] || { status: 0 }) }); });
    await ctx.route("https://api.nal.usda.gov/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ foods: [] }) }));
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 10000 });
    ok(!!sw, "extension loads (background service worker running)");
    const extId = sw.url().split("/")[2];

    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const HOST = "should-i-buy-it-badge";
    const badge = async (wait = /./) => {
      try { await page.waitForFunction(re => { const h = document.getElementById("should-i-buy-it-badge"); const b = h && h.shadowRoot.querySelector("button"); return b && !/checking/.test(b.textContent) && new RegExp(re).test(b.textContent); }, wait.source, { timeout: 10000 }); }
      catch (e) { console.log("badge state:", await page.evaluate(() => { const h = document.getElementById("should-i-buy-it-badge"); return h ? (h.parentElement && h.parentElement.tagName) + " | " + h.shadowRoot.textContent.slice(-160) : "no badge"; }), errors.join(" | ")); throw e; }
      return page.evaluate(() => {
        const host = document.getElementById("should-i-buy-it-badge"), b = host.shadowRoot.querySelector("button"), r = b.getBoundingClientRect();
        const hit = ["atc", "bn", "pack", "yousave"].map(id => document.getElementById(id)).filter(Boolean).some(x => { const q = x.getBoundingClientRect(); return r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; });
        return { text: b.textContent.replace(/\s+/g, " ").trim(), label: b.getAttribute("aria-label"), inRow: host.parentElement && host.parentElement.dataset.testid === "reviews-and-ratings",
          floating: b.classList.contains("pill"), left: r.left, bottom: innerHeight - r.bottom, top: r.top, height: r.height, hit, hosts: document.querySelectorAll("#should-i-buy-it-badge").length, tag: b.tagName, side: b.dataset.side };
      });
    };
    const sessionKeys = () => sw.evaluate(() => chrome.storage.session.get(null).then(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.state]))));

    // ---- 1. Caffeine-Free Diet Coke: badge in the rating row, nothing moved, the conflict as a small ⚠ ----
    const packTop = async () => page.evaluate(() => document.getElementById("pack").getBoundingClientRect().top);
    await page.goto("https://www.walmart.com/ip/Caffeine-Free-Diet-Coke-12-fl-oz-12-pack/12166734");
    let b = await badge(/Fine/);
    ok(b.inRow && !b.floating && b.tag === "BUTTON" && b.hosts === 1, `Diet Coke: one badge, a button in the rating row next to the stars (${b.text})`);
    ok(/^Fine\s*·\s*nothing to flag$/.test(b.text) && !/Warning/.test(b.label), `the caffeine conflict doesn't change the verdict, so the badge has no ⚠ (${b.label})`);
    const withBadge = await packTop();
    const without = await page.evaluate(() => { const h = document.getElementById("should-i-buy-it-badge"); h.style.display = "none"; const t = document.getElementById("pack").getBoundingClientRect().top; h.style.display = "inline-flex"; return t; });
    const rowH = await page.evaluate(() => document.querySelector('[data-testid="reviews-and-ratings"]').getBoundingClientRect().height);
    ok(!b.hit && withBadge === without && rowH === 32, `nothing moves or is covered: the rating row stays ${rowH} px tall, pack sizes stay at ${Math.round(without)} px`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ext7-badge.png"), clip: { x: 780, y: 100, width: 1130, height: 320 } });
    await page.keyboard.press("Tab");
    ok(await page.evaluate(async () => { const h = document.getElementById("should-i-buy-it-badge"); for (let i = 0; i < 12 && document.activeElement !== h; i++) await new Promise(r => setTimeout(r, 10)); return true; }), "the badge is a real button, so it's in the keyboard order");

    // Missing data gets a ⚠ only when it could change the verdict: cola is "Limit it" for its sugar whatever its sodium.
    await page.goto("https://www.walmart.com/ip/Coca-Cola-Fridge-Pack/12166733");
    b = await badge(/Limit it/);
    ok(!/⚠/.test(b.text) && !/Warning/.test(b.label), `missing sodium that can't change the verdict: no ⚠ (${b.text})`);
    await page.goto("https://www.walmart.com/ip/Caffeine-Free-Diet-Coke-12-fl-oz-12-pack/12166734"); b = await badge(/Fine/);

    // ---- 2. The side panel: what the click opens ----
    const keys = await sessionKeys();
    const tabKey = Object.keys(keys).find(k => keys[k] === "ready");
    ok(!!tabKey, `the product is handed to the side panel through session storage (${JSON.stringify(keys)})`);
    const tabId = Number(tabKey.split(":")[1]);
    // A real click (Chrome opens the side panel only in response to one).
    const bb = await page.evaluate(() => { const r = document.getElementById("should-i-buy-it-badge").shadowRoot.querySelector("button").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(bb.x, bb.y);
    await page.waitForTimeout(800);
    const last = await sw.evaluate(() => chrome.storage.session.get("lastOpen").then(o => o.lastOpen));
    ok(last && last.tabId === tabId && ["panel", "tab"].includes(last.via), `clicking the badge opens the breakdown for this tab (via ${last && last.via})`);
    for (const pg of ctx.pages()) if (/sidepanel\.html/.test(pg.url())) await pg.close();

    const panel = await ctx.newPage();
    await panel.setViewportSize({ width: 380, height: 900 });
    panel.on("pageerror", e => errors.push("panel: " + e.message));
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
    const ptext = async (re) => { if (re) await panel.waitForFunction(s => new RegExp(s).test(document.body.innerText), re.source, { timeout: 10000 }); return panel.evaluate(() => document.body.innerText.replace(/\s+/g, " ")); };
    let pt = await ptext(/Fine/);
    ok(/^SHOULD I BUY IT\? Fine No calories and nothing to flag, so it barely affects your day\. Diet Coke Caffeine-Free Soda Pop/i.test(pt), `panel opens on the verdict, then the reason and the product (${pt.slice(0, 120)})`);
    const shape = await panel.evaluate(() => { const s = document.querySelector(".verdict svg"); return s && /<circle[^>]*r="9.5"[^>]*fill="var\(--v-fine\)"/.test(s.innerHTML) && (s.innerHTML.match(/<circle/g) || []).length === 1; });
    ok(shape, "Fine has its own solid icon (a filled dot), not an empty circle");
    ok(/YOUR DAILY LIMITS, ONE SERVING 0% Sat fat 0 g 2% Sodium 40 mg 0% Added sugar 0 g/.test(pt) && await panel.evaluate(() => document.querySelectorAll(".ring-tile .ring.ok").length === 3 && document.querySelectorAll(".num-tile").length === 3),
      `limits as three rings (green: fine) and the key numbers as tiles; 0 g sugar means 0 g added (${(pt.match(/YOUR DAILY LIMITS.{0,80}/) || [""])[0]})`);
    const tip = await panel.evaluate(() => { const b = document.querySelector(".ring-tile"); return b.tabIndex === 0 && b.getAttribute("aria-label"); });
    ok(/counts against the verdict from 15% and counts double from 30%/.test(tip || ""), `each bar explains itself on hover or focus (${tip})`);
    ok(/Carbonated Water/.test(pt) && /⚠ Caffeine: The product name says caffeine-free\. Check the package\./.test(pt) && !(await panel.$(".banner")), "the conflict sits next to Caffeine, with no banner (it doesn't change the verdict)");
    const noteWords = await panel.evaluate(() => [...document.querySelectorAll(".notes li > span:nth-child(2)")].map(s => s.firstChild.textContent.trim().split(/\s+/).length));
    ok(noteWords.every(n => n <= 12), `notes are short (${noteWords.join(", ")} words)`);
    const order = await panel.evaluate(() => [...document.querySelectorAll("main > section")].map(s => s.getAttribute("aria-label") || (s.querySelector("h2") || {}).textContent || s.className).join(" › "));
    ok(/^Verdict › Your daily limits[^›]* › Serving and price › Why › Ingredients › About this verdict$/.test(order), `order: verdict, bars, notes, ingredients, sources (${order})`);
    ok(await panel.evaluate(() => [...document.querySelectorAll(".shown .shead h2")].map(h => h.textContent).join("|") === "Ingredients|About this verdict" && ![...document.querySelectorAll("details.disc")].some(d => /Ingredients|About this verdict/.test(d.querySelector("summary").textContent))
      && document.querySelector(".shown .ig").getBoundingClientRect().height > 0 && /net carbs|fiber/.test(document.querySelector(".foot").textContent) && !/doesn't check allergens/.test(document.body.textContent)),
      "Ingredients and About this verdict are always shown, like the app; the About text is current");
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "ext8-panel-dietcoke.png"), fullPage: true });

    // ---- 3. Same tab, next product (Walmart changes pages without reloading): badge and panel follow ----
    await page.bringToFront();
    await page.evaluate(() => history.pushState(null, "", "/ip/Little-Debbie-Honey-Buns-10-6-oz-6-count/10295207"));
    // Walmart re-renders the page for the new product; here the new page's markup arrives the same way.
    b = await badge(/Limit it/);
    ok(b.hosts === 1 && /^Limit it\s*·\s*\S/.test(b.text), `honey buns: the badge follows the product and isn't duplicated (${b.text})`);
    pt = await ptext(/Limit it/);
    ok(/Limit it/.test(pt) && await panel.evaluate(() => (document.querySelector(".verdict svg") || {}).innerHTML.includes("M7.6 1h8.8")), "the side panel follows the tab: Limit it with its red octagon");
    ok(/Titanium Dioxide/i.test(pt) && /Removed by regulators/i.test(pt), "honey buns: titanium dioxide shows as removed by regulators");
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "ext9-panel-honeybuns.png"), fullPage: true });

    // ---- 4. A product Open Food Facts and USDA don't have ----
    await page.goto("https://www.walmart.com/ip/Diet-Coke-Caffeine-Free-Soda-12oz-Cans-Pack-of-12/345611875");
    b = await badge(/no nutrition data/);
    ok(b.hosts === 1 && /^no nutrition data$/.test(b.text), `not in Open Food Facts or USDA: the badge says so (${b.text})`);
    const k2 = Object.entries(await sessionKeys()).find(([, v]) => v === "none");
    const p2 = await ctx.newPage(); await p2.goto(`chrome-extension://${extId}/sidepanel.html?tab=${k2 ? k2[0].split(":")[1] : 0}`);
    const t2 = await p2.evaluate(async () => { await new Promise(r => setTimeout(r, 400)); return document.body.innerText.replace(/\s+/g, " "); });
    ok(/Open Food Facts and USDA don't have its barcode/.test(t2) && /look it up by name in the app/.test(t2), `the panel explains and offers the app instead (${t2.slice(0, 120)})`);
    await p2.close();

    // ---- 5. A non-food page: no badge, and the panel's empty state ----
    await page.goto("https://www.walmart.com/ip/Sceptre-40-TV/683540269"); await page.waitForTimeout(1500);
    ok(await page.evaluate(() => !document.getElementById("should-i-buy-it-badge")), "non-food page: no badge");
    const p3 = await ctx.newPage(); await p3.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
    await page.goto("https://www.walmart.com/ip/Sceptre-40-TV/683540269?x=1"); await page.waitForTimeout(1200);
    const t3 = await p3.evaluate(async () => { await new Promise(r => setTimeout(r, 400)); return document.body.innerText; });
    ok(/Open a Walmart, Sam's Club or Costco food product to see a verdict\./.test(t3), "non-food page: the side panel shows its empty state");
    await p3.close();

    // ---- 6. No rating row to sit in: a small pill at the bottom left, clear of the buy box ----
    variant = { noRating: true };
    await page.goto("https://www.walmart.com/ip/Oikos-Pro-23g-Protein-Vanilla-Yogurt/5072512866");
    b = await badge(/Get it/);
    ok(b.floating && b.left <= 20 && !b.hit && b.hosts === 1, `no rating row: a floating pill bottom left, not over Add to cart or Buy now (${b.text})`);
    await sw.evaluate(() => chrome.storage.local.set({ corner: "right" })); await page.waitForTimeout(300);
    b = await badge(/Get it/);
    ok(b.floating && !b.hit, `set to the right corner, it still never covers the buy box (${b.side})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ext10-pill.png"), clip: { x: 1200, y: 500, width: 710, height: 412 } });
    await sw.evaluate(() => chrome.storage.local.set({ corner: "left" }));
    variant = {};

    // ---- 7. Goals change: the panel re-scores at once ----
    await page.goto("https://www.walmart.com/ip/Little-Debbie-Honey-Buns-10-6-oz-6-count/10295207"); await badge(/Limit it/);
    await sw.evaluate(() => chrome.storage.local.set({ profile: { cal: 2000, pro: 100, sat: 20, na: 2300, add: 50, fib: 28, skip: "honey", mild: false } }));
    pt = await ptext(/Skip/);
    ok(/Skip/.test(pt) && /on your skip list/i.test(pt), "a skip term saved in settings shows in the open panel right away");
    b = await badge(/Skip/);
    ok(/^Skip\s*·\s*on your skip list$/.test(b.text), `and on the badge (${b.text})`);
    await sw.evaluate(() => chrome.storage.local.set({ profile: null }));

    // ---- 8. Add to list from the panel ----
    await page.goto("https://www.walmart.com/ip/Caffeine-Free-Diet-Coke-12-fl-oz-12-pack/12166734"); await badge(/Fine/);
    await ptext(/Fine/);
    await panel.click("text=+ Add to list");
    pt = await ptext(/On your list/);
    const send = await panel.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); const a = [...document.querySelectorAll("a")].find(x => /Send 1 to your list/.test(x.textContent)); return a && a.href; });
    ok(/#add=z\./.test(send || ""), "+ Add to list, then a send link for the app");
    await sw.evaluate(() => chrome.storage.local.set({ toApp: [] }));

    // ---- 8b. A supplement: its own view, not a food verdict ----
    await page.goto("https://www.walmart.com/ip/RAW-Nutrition-Pre-Workout/16435600213");
    b = await badge(/Supplement/);
    ok(/^Supplement\s*·\s*200 mg caffeine$/.test(b.text) && b.hosts === 1, `pre-workout: a Supplement badge with its caffeine (${b.text})`);
    pt = await ptext(/Supplement/);
    ok(/Supplement Not scored like food/.test(pt) && !/YOUR DAILY LIMITS/.test(pt), "the panel shows the supplement view, not food bars");
    ok(/PER SERVING · 1 Scoop \(13\.2g\) Caffeine 200 mg · 50% Sodium 75 mg · 3% Added sugar 0 g Calories 0/i.test(pt), `per serving: caffeine against 400 mg, sodium, sugar, calories (${(pt.match(/PER SERVING[^.]*/) || [""])[0]})`);
    ok(/200 mg caffeine: 50% of the FDA's 400 mg daily figure/.test(pt) && /Sweetened with sucralose/.test(pt) && /doesn't judge whether a supplement works/.test(pt), "notes: caffeine, sweetener, and what the app doesn't judge");
    ok(/L-Citrulline\s*4g/.test(pt) && /Vitamin B12 \(as Methylcobalamin\)\s*5mcg · 208% DV/.test(pt), "what's in a serving, as the label lists it");
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "ext12-panel-supplement.png"), fullPage: true });
    await page.goto("https://www.walmart.com/ip/RAW-Nutrition-Pre-Workout/16435600214");
    b = await badge(/Supplement/);
    pt = await ptext(/only as a photo/);
    ok(/Caffeine 200 mg/.test(pt) && /caffeine amount comes from the product's name/.test(pt) && !/Sodium/.test(pt), "label only in a photo: caffeine from the name, no made-up sodium");

    // ---- 8c. Sam's Club: the same badge and panel, in its own words ----
    await page.goto("https://www.samsclub.com/ip/Cheerios-Cereal-40-7-oz/1600043509");
    b = await badge(/Get it/);
    ok(b.inRow && b.hosts === 1 && /^Get it\s*·\s*\S/.test(b.text) && !b.hit, `Sam's Club Cheerios: the badge sits in the rating row (${b.text})`);
    pt = await ptext(/Get it/);
    ok(/Source: The Nutrition Facts on this Sam's Club page\./.test(pt) && !/a serving at the|From the [^.]*price/.test(pt) && !/\$\d+\.\d\d a serving/.test(pt), "the panel names Sam's Club as the source; no per-serving price from a per-box unit price");
    await page.goto("https://www.samsclub.com/ip/Bananas-3-lbs/18638953319");
    b = await badge(/Get it/);
    ok(/Get it/.test(b.text), `Sam's Club bananas: typical values by name (${b.text})`);
    await page.goto("https://www.samsclub.com/ip/Member-s-Mark-Paper-Towel/15390012477"); await page.waitForTimeout(1500);
    ok(await page.evaluate(() => !document.getElementById("should-i-buy-it-badge")), "Sam's Club paper towels: no badge");
    await page.goto("https://www.samsclub.com/ip/Redcon1-Total-War-Pre-workout/18691360382");
    b = await badge(/Supplement/);
    ok(/^Supplement\s*·\s*350 mg caffeine$/.test(b.text), `Sam's Club pre-workout: the supplement view, caffeine from its name (${b.text})`);
    pt = await ptext(/350 mg/);
    ok(/This Sam's Club page's name and ingredients/.test(pt) && /Sweetened with sucralose/.test(pt), "and the panel says where its numbers come from");
    // A swap links to the store the product came from.
    await page.goto("https://www.samsclub.com/ip/Cheerios-Cereal-40-7-oz/1600043509"); await badge(/Get it/);
    await sw.evaluate(() => chrome.storage.local.set({ profile: { cal: 2000, pro: 100, sat: 20, na: 300, add: 50, fib: 28, skip: "", mild: false } }));
    await badge(/In moderation|Limit it/);
    pt = await ptext(/Search Sam's Club/).catch(async () => { console.log("panel:", (await ptext()).slice(0, 600)); return ""; });
    const swapHref = await panel.evaluate(() => { const a = [...document.querySelectorAll("a")].find(x => /Search Sam's Club/.test(x.textContent)); return a && a.href; });
    ok(/^https:\/\/www\.samsclub\.com\/search\?q=/.test(swapHref || ""), `swaps search Sam's Club, not Walmart (${swapHref})`);
    // A prefilled problem report: the product, its page, where the numbers came from and the verdict; nothing about you.
    const rep = await panel.evaluate(() => { const a = [...document.querySelectorAll("a")].find(x => /Wrong verdict\? Report it/.test(x.textContent)); return a && a.href; });
    const rq = rep ? new URL(rep) : null, rbody = rq ? rq.searchParams.get("body") : "";
    ok(rq && rq.origin + rq.pathname === "https://github.com/QuocHHDo/should-i-buy-it/issues/new" && /^Wrong verdict or number: Cheerios/.test(rq.searchParams.get("title")) &&
      /Store: Sam's Club/.test(rbody) && /Page: https:\/\/www\.samsclub\.com\/ip\//.test(rbody) && /Numbers from: The Nutrition Facts on this Sam's Club page/.test(rbody) && /Verdict \(standard goals\): /.test(rbody) && !/2000|goal/i.test(rbody.replace("standard goals", "")),
      `the panel has a prefilled 'Wrong verdict? Report it' link (${(rbody || "").split("\n").slice(0, 4).join(" / ")})`);
    await sw.evaluate(() => chrome.storage.local.set({ profile: null }));

    // ---- 8d. Costco: no Nutrition Facts on the page, so the barcode; the badge right of the stars ----
    const coBadge = () => page.evaluate(() => {
      const host = document.getElementById("should-i-buy-it-badge"), b = host.shadowRoot.querySelector("button"), r = b.getBoundingClientRect();
      const row = document.getElementById("CostcoBVReviewContainer"), rr = row.getBoundingClientRect(), stars = row.firstElementChild && row.firstElementChild.getBoundingClientRect();
      const hit = ["atc", "price"].map(id => document.getElementById(id)).some(x => { const q = x.getBoundingClientRect(); return r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; });
      return { text: b.textContent.replace(/\s+/g, " ").trim(), inRow: host.parentElement === row, floating: b.classList.contains("pill"), rowH: rr.height,
        rightOfStars: !!stars && r.left >= stars.right, inside: r.right <= rr.right + 1 && r.top >= rr.top - 8 && r.bottom <= rr.bottom + 8, hit, hosts: document.querySelectorAll("#should-i-buy-it-badge").length };
    });
    await page.goto(CO.url("cheerios"));
    await badge(/Get it/); await page.waitForTimeout(1200);
    b = await coBadge();
    ok(b.inRow && !b.floating && b.rightOfStars && b.inside && b.rowH === 28 && !b.hit && b.hosts === 1, `Costco Cheerios: the badge sits right of the stars, the page doesn't move (${JSON.stringify(b)})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ext12-costco.png") });
    pt = await ptext(/Get it/);
    ok(/Open Food Facts/.test(pt) && /Costco/.test(pt), "the panel says the numbers came from the barcode, on a Costco page");
    await page.goto(CO.url("bananas"));
    b = await badge(/Get it/);
    ok(/Get it/.test(b.text), `Costco bananas: typical values by name (${b.text})`);
    await page.goto(CO.url("towels")); await page.waitForTimeout(1500);
    ok(await page.evaluate(() => !document.getElementById("should-i-buy-it-badge")), "Costco paper towels: no badge");
    await page.goto(CO.url("d3"));
    b = await badge(/Supplement/);
    ok(/^Supplement/.test(b.text), `Costco vitamin D3: the supplement view (${b.text})`);
    await page.goto(CO.url("cheerios")); await badge(/Get it/);
    await sw.evaluate(() => chrome.storage.local.set({ profile: { cal: 2000, pro: 100, sat: 20, na: 300, add: 50, fib: 28, skip: "", mild: false } }));
    await badge(/In moderation|Limit it/);
    pt = await ptext(/Search Costco/).catch(async () => { console.log("panel:", (await ptext()).slice(0, 600)); return ""; });
    const coSwap = await panel.evaluate(() => { const a = [...document.querySelectorAll("a")].find(x => /Search Costco/.test(x.textContent)); return a && a.href; });
    ok(/^https:\/\/www\.costco\.com\/s\?keyword=/.test(coSwap || ""), `swaps search Costco (${coSwap})`);
    await sw.evaluate(() => chrome.storage.local.set({ profile: null }));
    await page.waitForTimeout(1500); await badge(/Get it/); // the goals change re-checks the page

    // ---- 8e. Reading a label photo: no Nutrition Facts on the page and no barcode record, so the panel offers the photo ----
    // The photo is a real one (Skippy peanut butter, from Open Food Facts, CC BY-SA 3.0), read by the bundled Tesseract.
    await page.goto(CO.url("pb"));
    b = await badge(/no nutrition data/);
    pt = await ptext(/READ THE LABEL PHOTO/);
    ok(/Open Food Facts and USDA don't have its barcode/.test(pt) && await panel.evaluate(() => document.querySelectorAll(".thumb").length === 1 && document.querySelector("details.disc[open] .thumbs") !== null),
      "no data: the panel opens 'Read the label photo' with the product's photo to pick");
    const t0 = Date.now();
    await panel.setInputFiles("#phfile", path.join(ROOT, "tests/fixtures/label-skippy.jpg"));
    await panel.waitForSelector(".lform input[name=cal]", { timeout: 90000 });
    const read = await panel.evaluate(() => Object.fromEntries([...document.querySelectorAll(".lform input")].map(i => [i.name, i.value])));
    ok(read.cal === "190" && read.fat === "16" && read.na === "150" && read.pro === "7", `the photo is read on this computer and the numbers fill a form to check (${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(read)})`);
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "ext13-photo-form.png"), fullPage: true });
    {
      // The form, checked with axe on a copy of the panel (the extension page's CSP blocks injecting axe).
      const formCopy = await ctx.newPage(); await formCopy.setViewportSize({ width: 380, height: 900 });
      const fhtml = await panel.evaluate(() => document.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, ""));
      await formCopy.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Should I Buy It?</title><style>${fs.readFileSync(path.join(EXT, "sidepanel.css"), "utf8")}</style></head><body>${fhtml}</body></html>`);
      await formCopy.addScriptTag({ content: fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
      for (const scheme of ["light", "dark"]) {
        await formCopy.emulateMedia({ colorScheme: scheme });
        const v = await formCopy.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(x => `${x.id} (${x.nodes.length}): ${x.nodes[0].target}`));
        ok(!v.length, `the photo form, ${scheme}: no WCAG A/AA violations${v.length ? ": " + v.join(", ") : ""}`);
      }
      await formCopy.close();
    }
    await panel.fill(".lform input[name=cal]", "190");
    await panel.click(".lform button[type=submit]");
    pt = await ptext(/The Nutrition Facts photo you checked/);
    ok(/Your daily limits/i.test(pt) && /Sat fat 3 g/.test(pt), "checking the numbers shows the full verdict, sourced to the photo");
    b = await badge(/^(Get it|In moderation|Limit it|Fine)/);
    ok(!/no nutrition data/.test(b.text), `and the page's badge updates to match (${b.text})`);
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "ext14-photo-verdict.png"), fullPage: true });

    // ---- 9. Accessibility and dark mode ----
    const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    const css = fs.readFileSync(path.join(EXT, "sidepanel.css"), "utf8");
    const copy = await ctx.newPage(); await copy.setViewportSize({ width: 380, height: 900 });
    const html = await panel.evaluate(() => document.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, ""));
    await copy.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Should I Buy It?</title><style>${css}</style></head><body>${html}</body></html>`);
    await copy.addScriptTag({ content: axeSrc });
    for (const scheme of ["light", "dark"]) {
      await panel.emulateMedia({ colorScheme: scheme }); await copy.emulateMedia({ colorScheme: scheme });
      const v = await copy.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(x => `${x.id} (${x.nodes.length}): ${x.nodes[0].target}`));
      ok(!v.length, `side panel, ${scheme}: no WCAG A/AA violations, contrast included${v.length ? ": " + v.join(", ") : ""}`);
      if (SHOTS && scheme === "dark") await panel.screenshot({ path: path.join(SHOTS, "ext11-panel-dark.png"), fullPage: true });
    }
    await panel.emulateMedia({ colorScheme: "light" });
    await page.bringToFront();
    await page.addScriptTag({ content: axeSrc });
    const vb = await page.evaluate(async () => (await axe.run(document.getElementById("should-i-buy-it-badge").shadowRoot.querySelector("button"), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(x => x.id));
    ok(!vb.length, `badge: no WCAG A/AA violations${vb.length ? ": " + vb.join(", ") : ""}`);

    // ---- 10. Search badges: off by default; when on, only visible products, one request at a time ----
    await page.goto("https://www.walmart.com/search?q=yogurt"); await page.waitForTimeout(2000);
    ok(await page.evaluate(() => !document.querySelector(".sib-badge")), "search badges are off by default");
    await page.goto("about:blank");
    await sw.evaluate(() => chrome.storage.local.set({ searchBadges: true, badgeCache: {} }));
    hits.ip = [];
    await page.goto("https://www.walmart.com/search?q=yogurt");
    await page.waitForFunction(() => document.querySelectorAll(".sib-badge").length >= 3 && [...document.querySelectorAll(".sib-badge")].every(b => !/…/.test(b.shadowRoot.textContent)), null, { timeout: 20000 });
    const badges = await page.evaluate(() => [...document.querySelectorAll("[data-item-id]")].map(t => { const b = t.querySelector(".sib-badge"); return b ? b.shadowRoot.querySelector(".b").textContent : "-"; }));
    ok(badges[0] === "Get it" && badges[1] === "In moderation" && badges[2] === "Get it" && badges[3] === "-", `search badges show each product's verdict; non-food gets none (${badges.join(" | ")})`);
    const gaps = hits.ip.slice(1).map((h, i) => h.t - hits.ip[i].t);
    ok(hits.ip.length === 4 && gaps.every(g => g >= 1400), `one product page at a time, ${gaps.map(g => (g / 1000).toFixed(1) + " s").join(", ")} apart`);
    // Not on Sam's Club, which checks for robots more readily: no background page loads there.
    hits.samsIp = 0;
    await page.goto("https://www.samsclub.com/search?q=yogurt"); await page.waitForTimeout(3000);
    ok(await page.evaluate(() => !document.querySelector(".sib-badge")) && hits.samsIp === 0, "search badges stay off on Sam's Club (no background page loads)");
    await sw.evaluate(() => chrome.storage.local.set({ searchBadges: false }));

    // ---- 11. Settings page: goals typed in and imported from the app still work ----
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extId}/options.html`);
    await opts.fill("#skip", "cheerios"); await opts.click("button[type=submit]");
    await opts.waitForFunction(() => /Saved/.test(document.getElementById("status").textContent));
    ok(await sw.evaluate(() => chrome.storage.local.get("profile").then(o => o.profile && o.profile.skip === "cheerios")), "goals saved in settings");
    const link = await opts.evaluate(async () => "https://quochhdo.github.io/should-i-buy-it/#import=" + await SelfCheckBackup.encode(SelfCheckBackup.pack(k => k === "profile" ? { cal: 1850, pro: 140, sat: 13, na: 2300, add: 36, fib: 30, skip: "", mild: true } : undefined)));
    await opts.fill("#paste", link); await opts.click("#importBtn");
    await opts.waitForFunction(() => /imported/.test(document.getElementById("status").textContent));
    ok(await opts.evaluate(() => document.getElementById("pro").value === "140" && document.getElementById("mild").checked), "a transfer link from the app imports the goals");
    // Suggested targets and the carb limit, the same as the app's Goals.
    await opts.fill("#sgAge", "32"); await opts.selectOption("#sgSex", "male"); await opts.fill("#sgFt", "5"); await opts.fill("#sgIn", "10"); await opts.fill("#sgLb", "170");
    await opts.waitForFunction(() => /2,400 cal · 60 g protein/.test(document.getElementById("sgOut").textContent));
    await opts.click("#sgUse"); await opts.click('.carbquick button[data-carb="25"]'); await opts.click("button[type=submit]");
    await opts.waitForFunction(() => /Saved/.test(document.getElementById("status").textContent));
    ok(await sw.evaluate(() => chrome.storage.local.get("profile").then(o => o.profile.cal === 2400 && o.profile.pro === 60 && o.profile.carb === 25)), "suggested targets and a keto carb limit are saved");
    ok(await sw.evaluate(() => chrome.storage.local.get(null).then(o => !/"age"|"weight"|"height"/.test(JSON.stringify(o)))), "age, height and weight aren't stored");
    await opts.selectOption("#sgUnits", "metric"); await opts.check("#sgPreg");
    ok(await opts.evaluate(() => /pregnancy/.test(document.getElementById("sgOut").textContent) && document.getElementById("sgUse").hidden && !document.getElementById("sgCm").closest("label").hidden), "pregnancy: no numbers; metric shows cm and kg");
    ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  } finally { await ctx.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(fails ? `${fails} extension check(s) failed` : "All extension checks passed");
  process.exit(fails ? 1 : 0);
})();
