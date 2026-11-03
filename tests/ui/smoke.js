// End-to-end UI test: loads the real page in jsdom, clicks through every feature, and mocks the
// USDA, Open Food Facts and Claude APIs. Run with `npm run test:ui` (needs `npm install` for jsdom and axe-core).
const N_FOODS = require("../../js/foods.js").FOODS.length;
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const REPO = path.join(__dirname, "..", ".."), MODE = process.argv[2] || "pages";
const read = p => fs.readFileSync(path.join(REPO, p), "utf8");
const usdaFixture = JSON.parse(read("tests/fixtures/usda-search.json"));
const brandedFixture = JSON.parse(read("tests/fixtures/usda-branded.json"));
let usdaMode = "ok";

let html = read("index.html").replace(/<script src="[^"]+"><\/script>/g, "").replace(/<link [^>]*>/g, "");
html = html.replace('window.SELF_CHECK_CONFIG = { mode: "pages" };', MODE === "claude"
  ? 'window.SELF_CHECK_CONFIG = { mode: "claude", profile: { cal: 1850, pro: 140, sat: 13, na: 2300, add: 36, fib: 30, skip: "hummus", mild: true } };'
  : 'window.SELF_CHECK_CONFIG = { mode: "pages", cameraTimeoutMs: 400, cameraStartMs: 60, cameraWaitMs: 30, lookupTimeoutMs: 80 };');
const errors = [];
let offMode = "ok";
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://quochhdo.github.io/should-i-buy-it/", pretendToBeVisual: true });
const w = dom.window;
w.scrollTo = () => {}; // jsdom has no layout
// Browser APIs jsdom lacks, used by backups and links: taken from Node, which has the same ones.
Object.assign(w, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response, Blob });
w.console.error = (...a) => errors.push(a.join(" "));
w.addEventListener("error", e => errors.push(String(e.message)));
w.HTMLElement.prototype.scrollIntoView = () => {};
w.fetch = async url => {
  url = String(url);
  if (url.includes("/fdc/v1/food/")) { const id = Number(url.match(/food\/(\d+)/)[1]); return { ok: true, status: 200, json: async () => usdaFixture.foods.find(f => f.fdcId === id) }; }
  if (url.includes("api.nal.usda.gov") && url.includes("dataType=Branded")) {
    // USDA Branded: a UPC query only matches the exact digits stored; a name query returns everything.
    const q = new URL(url).searchParams.get("query");
    if (usdaMode === "rate") return { ok: false, status: 429, json: async () => ({}) };
    const foods = /^\d+$/.test(q) ? brandedFixture.foods.filter(f => f.gtinUpc === q) : brandedFixture.foods;
    return { ok: true, status: 200, json: async () => ({ totalHits: foods.length, foods }) };
  }
  if (url.includes("api.nal.usda.gov")) return { ok: true, status: 200, json: async () => usdaFixture };
  if (url.includes("openfoodfacts.org") && (offMode === "cola" || offMode === "candy")) return { ok: true, status: 200, json: async () => JSON.parse(read(`tests/fixtures/off-test-${offMode}.json`)) };
  if (url.includes("openfoodfacts.org") && offMode === "empty") return { ok: true, status: 200, json: async () => ({ status: 1, product: { product_name: "Mystery Box", nutriments: {} } }) };
  if (url.includes("openfoodfacts.org") && offMode === "missing") return { ok: false, status: 404, json: async () => ({ status: 0, status_verbose: "product not found" }) };
  if (url.includes("openfoodfacts.org") && offMode === "error") return { ok: false, status: 503, json: async () => ({}) };
  if (url.includes("openfoodfacts.org") && offMode === "hang") return new Promise(() => {});
  if (url.includes("openfoodfacts.org")) return { ok: true, status: 200, json: async () => ({ status: 1, product: { product_name: "Protein Bar Chocolate", brands: "TestCo", serving_size: "1 bar (60 g)",
    nutriments: { "energy-kcal_serving": 200, "fat_serving": 7, "saturated-fat_serving": 3, "carbohydrates_serving": 22, "sugars_serving": 2, "fiber_serving": 9, "proteins_serving": 20, "sodium_serving": 0.2 } } }) };
  throw new Error("unexpected fetch " + url);
};
if (MODE === "claude") w.claude = { use: async name => name === "sample" ? Object.assign(async () => ({ text: "" }), { json: async () => ({ found: true, name: "Dragon Fruit", serving: "1 cup (227 g)", cal: 136, fat: 0, sat: 0, trans: 0, chol: 0, na: 0, carb: 29, fib: 7, sug: 18, add: 0, pro: 3, spicy: false, processedMeat: false }) }) : null };
const cfg = (html.match(/<script>(window\.SELF_CHECK_CONFIG[^<]*)<\/script>/) || [])[1];
if (!cfg) throw new Error("config script not found");
w.eval(cfg);
for (const [, f] of read("index.html").matchAll(/<script src="([^"]+)"><\/script>/g)) w.eval(read(f));

const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const text = s => ($(s) || {}).textContent || "";
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const type = (sel, v) => { const i = $(sel); i.value = v; i.dispatchEvent(new w.Event("input", { bubbles: true })); };
const submit = sel => $(sel).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
const click = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const btn = (label, root = w.document) => [...root.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(label));

(async () => {
  ok(text("#out h2") === "Avocado", `opens on a real food (${text("#out h2")})`);
  ok(/\d+ common foods/.test(text("#foodCount")), "shows the food count");
  ok($("#scanBtn").hidden === (MODE !== "pages"), `scan button ${MODE === "pages" ? "shown" : "hidden"}`);

  type("#q", "80/20"); ok($$("#suggest li").length > 0, "typing shows suggestions");
  const esc = () => { const ev = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); $("#q").dispatchEvent(ev); return ev.defaultPrevented; };
  const firstEsc = esc();
  ok(firstEsc && $("#suggest").hidden && $("#q").value === "80/20", "first Escape closes suggestions and keeps the text");
  ok(!esc(), "second Escape is left to the browser (clears the search box)");
  $("#q").value = "Ground beef 80/20"; submit("#form");
  ok(text("#out h2") === "Ground beef 80/20" && text(".tag .verdict") === "Limit it", "exact search shows result and verdict");
  $("#q").value = "chiken brest"; submit("#form");
  ok(/Did you mean/.test(text("#out")) && $$("#out .notice .chip").some(b => b.textContent === "Chicken breast, grilled"), `typo offers Did you mean (${text("#out .notice")})`);
  $("#q").value = "organic baby spinach"; submit("#form");
  ok(text("#out h2") === "Spinach" && /Showing closest match/.test(text("#out .notice.closest")), `loose match is labeled as closest (${text("#out .notice.closest")})`);
  ok(MODE !== "pages" || (/Search USDA for “organic baby spinach” instead/.test(text("#out .notice.closest")) && /Packaged products/.test(text("#out .notice.closest"))), "closest match offers the full searches");
  $("#q").value = "Ground beef 80/20"; submit("#form");
  ok(!$("#out .notice.closest"), "exact match has no closest-match banner");
  const swaps = $$(".swap .sn").map(e => e.textContent);
  const swapWords = $$(".swap .vp").map(e => e.textContent), RANKW = { "Get it": 2, "In moderation": 1 };
  ok(swaps.some(n => /93\/7/.test(n)) && swapWords.every((v, i) => !i || RANKW[swapWords[i - 1]] >= RANKW[v]), `swaps include 93/7 and list Get it first (${swaps.map((n, i) => n + ": " + swapWords[i]).join(", ")})`);
  ok(/(more protein|less saturated fat).* per 100 calories/.test(text(".swap .sd")), `swap explains the difference per 100 calories (${text(".swap .sd")})`);

  click(btn("2", $(".serving")));
  ok(text(".label .cal .v") === String(Math.round(287 * 2)), `2 servings doubles calories (${text(".label .cal .v")})`);
  ok(/verdict is for one standard serving/.test(text(".tag")), "explains verdict basis when scaled");

  click($$(".label [data-k]").find(r => r.dataset.k === "sat"));
  ok(/Saturated fat/.test(text(".explain")), "tapping a label line explains it");

  type("#cmpq", "chicken breast");
  const li = $(".compare .suggest li"); ok(!!li, "compare search suggests foods");
  li.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
  const crow = $$(".ctable tbody tr").map(r => r.firstChild.textContent);
  ok(crow.includes("Typical price") && crow[crow.length - 1] === "Protein per $1" && crow.length === 12 && $$(".ctable td.win").length > 0, `compare table renders with winners marked, then price and protein per dollar (${crow.slice(-2).join(", ")})`);

  const firstSwap = w.SelfCheckData.FOODS.find(f => f.n === swaps[0]);
  click($$(".swap")[0]);
  ok(text("#out h2") === firstSwap.n, "clicking a swap opens it");
  ok(text(".label .cal .v") === String(Math.round(firstSwap.cal)), "serving resets to 1 on a new food");

  click(btn("Save", $("#out")));
  ok(!$("#favRow").hidden && text("#favRow").includes(firstSwap.n.split(",")[0]), `saving adds a favorite chip (${text("#favRow")})`);
  ok(!$("#recentRow").hidden || text("#favRow").includes(firstSwap.n), "recents/favorites rows render");

  click($('#tabs [data-view="browse"]')); await tick(5);
  click(btn("Seafood", $("#cats")));
  ok($$("#blist .bitem").length === w.SelfCheckData.FOODS.filter(f => f.c === "seafood").length, `browse filters by category (${$$("#blist .bitem").length})`);
  click(btn("All", $("#cats"))); click(btn("Least healthy first", $("#bsort")));
  const first = $("#blist .bitem"), firstScore = Number(first.querySelector(".score").textContent);
  ok(/^1\./.test(first.textContent) && firstScore <= -4 && !$("#bsortNote").hidden, `least-healthy sort ranks with scores (${first.textContent})`);
  click(btn("Healthiest first", $("#bsort")));
  ok(Number($("#blist .bitem .score").textContent) >= 3, `healthiest sort puts high scores first (${$("#blist .bitem").textContent})`);
  click(btn("A–Z", $("#bsort")));
  ok(!$("#blist .bitem .score") && $("#bsortNote").hidden, "A–Z hides scores");
  $("#q").value = "boba"; submit("#form");
  ok(text("#out h2") === "Bubble milk tea, regular sugar" && text(".tag .verdict") === "Limit it", `boba search finds bubble tea (${text("#out h2")})`);

  $("#q").value = "durian"; submit("#form");
  if (MODE === "pages") {
    ok(/isn't in the built-in list/.test(text("#out")), "unknown food offers a lookup");
    click(btn("Search USDA", $("#out"))); await tick(10);
    ok($$("#out .results button").length === 3, "USDA results listed");
    click($$("#out .results button")[0]);
    ok(/From USDA/.test(text(".src")) && text("#out h2").startsWith("Avocados"), "picking a USDA result shows it with its source");
    $("#q").value = "0123456789012"; submit("#form"); await tick(10);
    ok(text("#out h2") === "TestCo Protein Bar Chocolate" && /Open Food Facts/.test(text(".src")), `barcode lookup shows the product (${text("#out h2")})`);
    ok(text(".label .serv span:last-child") === "1 bar (60 g)", "barcode product uses per-serving values");
    // Additives panel: listed with functions, NOVA badge, flagged ones with sources; skip list covers additives.
    offMode = "cola"; $("#q").value = "0000000000017"; submit("#form"); await tick(10);
    ok(/NOVA 4/.test(text(".additives .nova")) && $$(".additives .addlist li").length === 6 && /E951AspartameMixed evidence/.test(text(".additives")), `additives panel lists the cola's 6 additives (${text(".additives").slice(0, 120)})`);
    ok(!$(".additives li.st-removed") && $$(".additives li.st-mixed").length >= 2 && /E330Citric acidConsidered safe/.test(text(".additives")), `statuses: none removed, sweeteners mixed, citric acid safe (${$$(".additives li").map(l => l.className).join(" ")})`);
    const asp = $$(".additives li").find(l => /Aspartame/.test(l.textContent));
    ok(!asp.querySelector("details").open && /possibly carcinogenic/.test(asp.textContent) && asp.querySelector("a[href*='who.int']"), "aspartame's note and WHO source are one tap away");
    offMode = "candy"; $("#q").value = "0000000000024"; submit("#form"); await tick(10);
    ok($$(".additives li.st-removed").length === 3 && $$(".additives li.st-removed details[open] a").length === 3 && text(".tag .verdict") === "In moderation", `removed additives flagged with sources; verdict ${text(".tag .verdict")}`);
    offMode = "empty"; $("#q").value = "0000000000031"; submit("#form"); await tick(10);
    ok(/Found “Mystery Box”, but neither Open Food Facts nor USDA has its nutrition data/.test(text("#out .notice")), `a product with no nutrition values at all still says so (${text("#out .notice")})`);
    offMode = "ok";
    $("#q").value = "Avocado"; submit("#form");
    ok(!$(".additives"), "no additives panel for built-in foods");
    // Walmart store brands: a barcode Open Food Facts doesn't know is found in USDA Branded Foods.
    // The scanner reads EAN-13 (0078742378213); USDA stores the 12-digit UPC.
    offMode = "missing"; $("#q").value = "0078742378213"; submit("#form"); await tick(20);
    ok(text("#out h2") === "Great Value, Lemonade" && /From USDA Branded Foods/.test(text(".src")) && /UPC 078742378213/.test(text(".src")), `UPC falls back to USDA Branded (${text("#out h2")} · ${text(".src")})`);
    ok(text(".label .serv span:last-child") === "3 tbsp (50 g)" && text(".label .cal .v") === "120", `label serving and calories match the package (${text(".label .serv span:last-child")}, ${text(".label .cal .v")} cal)`);
    ok($$(".swap .sn").map(e => e.textContent).every(n => /soda|sparkling/i.test(n)), `lemonade swaps like soda (${$$(".swap .sn").map(e => e.textContent).join(", ")})`);
    $("#q").value = "028400335799"; submit("#form"); await tick(20);
    ok(/Doritos/.test(text("#out h2")) && /E621Monosodium glutamate/.test(text(".additives")) && /Found by name in the ingredient list/.test(text(".additives")), `additives found in USDA ingredient text (${text(".additives").slice(0, 160)})`);
    usdaMode = "rate"; $("#q").value = "0000000000999"; submit("#form"); await tick(20);
    ok(/USDA is out of free searches/.test(text("#out .notice")) && /your own free USDA key/.test(text("#out .notice")), `USDA rate limit explained (${text("#out .notice")})`);
    usdaMode = "ok"; offMode = "ok";
    // Packaged products by name (no barcode needed).
    $("#q").value = "doritos nacho"; submit("#form");
    click(btn("Packaged products", $("#out"))); await tick(20);
    ok($$("#out .results button").length >= 1 && /Doritos/.test(text("#out .results")), `packaged-product search from the not-found card (${text("#out .results").slice(0, 80)})`);
    type("#q", "tortilla chips");
    const lastOpt = $$("#suggest li").pop();
    ok(lastOpt && /Search packaged products for “tortilla chips”/.test(lastOpt.textContent), `suggestions end with a packaged-product search (${lastOpt && lastOpt.textContent})`);
    lastOpt.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true })); await tick(20);
    ok(/Doritos/.test(text("#out .results")), "choosing it searches packaged products");
    // A store brand goes straight to packaged products; Walmart brands only filters out other brands.
    $("#q").value = "great value almonds"; submit("#form"); await tick(20);
    const shown = () => $$("#out .results .rname span:first-child").map(e => e.textContent);
    ok(shown()[0] === "Great Value, Almonds, Smoke" && /per 0.25 cup \(31 g\)/.test(text("#out .results")), `store brand → packaged search, best match first (${shown().join(", ")})`);
    click(btn("Walmart brands only", $("#out"))); await tick(5);
    ok(shown().length > 0 && shown().every(n => /Great Value/.test(n)), `Walmart brands only (${shown().join(", ")})`);
    ok(JSON.parse(w.localStorage.getItem("walmartOnly")) === true, "the Walmart filter is remembered");
    click(btn("Walmart brands only", $("#out"))); await tick(5);
    // 14. Barcode and camera failures always end in a message, never a stuck spinner.
    for (const [mode, re] of [["missing", /Neither Open Food Facts nor USDA Branded Foods has barcode/], ["error", /Open Food Facts had an error \(503\), and USDA doesn't have it/], ["hang", /Open Food Facts took too long to answer, and USDA doesn't have it/]]) {
      offMode = mode; $("#q").value = "0123456789013"; submit("#form"); await tick(mode === "hang" ? 200 : 10);
      ok(re.test(text("#out .notice")) && !$("#out .thinking"), `barcode ${mode}: ${text("#out .notice")}`);
    }
    offMode = "ok";
    click($("#scanBtn")); await tick(5);
    ok(/needs a secure https page/.test(text("#scanMsg")) && w.document.activeElement === $("#code"), `no camera API: message and focus on typed barcode (${text("#scanMsg")})`);
    await (async () => {
      // Each camera outcome gets its own message; the typed-barcode box is focused throughout.
      let gum = "ok", start = "ok";
      const err = name => Object.assign(new Error(name), { name });
      Object.defineProperty(w.navigator, "mediaDevices", { value: { getUserMedia: () => gum === "ok" ? Promise.resolve({ getTracks: () => [] }) : gum === "pending" ? new Promise(() => {}) : Promise.reject(err(gum)) }, configurable: true });
      Object.defineProperty(w, "isSecureContext", { value: true, configurable: true });
      w.Html5QrcodeSupportedFormats = { EAN_13: 1, EAN_8: 2, UPC_A: 3, UPC_E: 4 };
      w.Html5Qrcode = class { constructor() { this.isScanning = false; } clear() {} async stop() {}
        start() { return start === "ok" ? Promise.resolve() : start === "string" ? Promise.reject("Error getting userMedia, error = NotReadableError: Could not start video source") : new Promise(() => {}); } };
      const scan = async (ms = 10) => { click($("#scanClose")); await tick(2); click($("#scanBtn")); await tick(ms); };
      for (const [g, re, label] of [["NotAllowedError", /blocked for this site/, "denied"], ["NotFoundError", /No camera was found/, "no camera"], ["NotReadableError", /in use by another app/, "busy"]]) {
        gum = g; await scan();
        ok(re.test(text("#scanMsg")) && w.document.activeElement === $("#code"), `camera ${label}: specific message, barcode box focused (${text("#scanMsg")})`);
      }
      gum = "pending"; await scan(80);
      ok(/Waiting for camera permission\. Allow it in your browser, or type the number below\./.test(text("#scanMsg")) && w.document.activeElement === $("#code"), `pending permission prompt: waiting message (${text("#scanMsg")})`);
      gum = "ok"; start = "string"; await scan();
      ok(/in use by another app/.test(text("#scanMsg")), `scanner's string errors are recognized (${text("#scanMsg")})`);
      start = "hang"; await scan(150);
      ok(/didn't start/.test(text("#scanMsg")) && !$("#scanBtn").hasAttribute("aria-busy"), `scanner hang: times out with a message (${text("#scanMsg")})`);
      start = "ok"; await scan();
      ok(/Point your camera at the barcode/.test(text("#scanMsg")), `camera ready (${text("#scanMsg")})`);
      click($("#scanClose")); await tick(2);
      delete w.Html5Qrcode; delete w.navigator.mediaDevices;
    })();
    // "What decided it": the points shown add up to the total, and the total matches the verdict.
    w.location.hash = "#chicken-breast-grilled"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    {
      const pts = $$(".decided .pts, .why-chip b").map(e => Number(e.textContent.replace("−", "-").replace("?", "0")));
      const tot = Number($(".why-total b").textContent.replace("−", "-"));
      ok(pts.length >= 6 && pts.reduce((x, y) => x + y, 0) === tot, `chart points add up to the total (${pts.join(",")} = ${tot})`);
      ok($$(".decided .tick").length >= 6, `chart shows the verdict's cutoffs as ticks (${$$(".decided .tick").length})`);
      ok(/Get it/.test(text(".why-total")) && /Get it/.test(text(".tag .verdict")), `total matches the verdict (${text(".why-total").slice(0, 40)})`);
    }
    w.location.hash = "#chicken-pho"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    ok(/A typical recipe/.test(text(".src")), `restaurant dishes are marked as a typical recipe (${text(".src").slice(0, 40)})`);
    w.location.hash = "#lasagna-frozen"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    ok(/Brands vary/.test(text(".src")), `packaged foods keep "Brands vary" (${text(".src").slice(0, 40)})`);
    ok(new RegExp(`${N_FOODS} common foods built in \\+ \\d+ looked up\\.`).test(text("#foodCount")), `count includes lookups (${text("#foodCount")})`);
    const nLook = text("#foodCount").match(/\+ (\d+) looked up/)[1];
    ok(text("#browseCount") === `${N_FOODS} foods + ${nLook} looked up`, `Browse count matches the header (${text("#browseCount")})`);
    // Shared links to looked-up foods: re-fetched when this browser doesn't have them.
    // foods[1] was listed but never opened, so this browser has no copy and must fetch it.
    const fresh = usdaFixture.foods[1];
    w.location.hash = "#usda-" + fresh.fdcId; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(10);
    ok(text("#out h2").toLowerCase() === fresh.description.toLowerCase() && /From USDA/.test(text(".src")), `#usda-<id> fetches a food this browser hasn't seen (${text("#out h2")})`);
    const addRow = $$(".label [data-k]").find(r => r.dataset.k === "add");
    ok(addRow && /—/.test(addRow.textContent) && !/0\s?g/.test(addRow.textContent), `unreported added sugar shows "—" on the label (${addRow && addRow.textContent})`);
    ok(/Added sugar\s*not reported\s*\?/.test(text(".decided")), `and "not reported" on the chart, not counted (${text(".decided").slice(0, 200)})`);
    offMode = "ok"; w.location.hash = "#off-0123456789099"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(10);
    ok(/Open Food Facts/.test(text(".src")), `#off-<code> opens the product (${text("#out h2")})`);
    // Accented names: the folded slug and the old one both open Jalapeño; an unknown link never opens another food.
    const go = async h => { w.location.hash = h; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(5); };
    await go("#jalapeno"); ok(text("#out h2") === "Jalapeño" && !$("#out .notice"), `#jalapeno opens Jalapeño (${text("#out h2")})`);
    await go("#kimchi"); await go("#jalape-o"); ok(text("#out h2") === "Jalapeño" && w.location.hash === "#jalapeno", `legacy #jalape-o opens Jalapeño and updates the link (${w.location.hash})`);
    await go("#jalapenos"); ok(!$("#out h2") && /No food matches the link #jalapenos/.test(text("#out .notice")) && /Did you mean Jalapeño/.test(text("#out .notice")), `typo'd link offers Did you mean instead of opening a food (${text("#out .notice")})`);
    await go("#greek-yogurt"); ok(text("#out h2").startsWith("Greek yogurt") && /No food matches the link #greek-yogurt exactly/.test(text("#out .notice.closest")), `loose link opens the closest food with the banner (${text("#out .notice")})`);
    await go("#zzqqx"); ok(/No food matches the link #zzqqx/.test(text("#out .notice")) && !$("#out h2"), `unknown link shows a not-found card (${text("#out .notice")})`);
    w.location.hash = "#salmon"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(5);
    ok(text("#out h2") === "Salmon", "#salmon link opens Salmon");
  } else {
    await tick(20);
    $("#q").value = "durian"; submit("#form");
    click(btn("Look up", $("#out"))); await tick(20);
    ok(text("#out h2") === "Dragon Fruit" && /Looked up by Claude/.test(text(".src")), `Claude lookup shows result (${text("#out h2")})`);
    $("#q").value = "Hummus"; submit("#form");
    ok(text(".tag .verdict") === "Skip", "personal skip list applies in Claude version");
  }
  // grocery list + plate + basis + quiz
  $("#q").value = "Chicken breast, grilled"; submit("#form");
  click(btn("Add to list", $("#out")));
  ok(/1 to buy/.test(text("#glistCount")) && /Chicken breast/.test(text("#glistItems")), `add to list (${text("#glistCount")})`);
  const cb = $("#glistItems input[type=checkbox]"); cb.checked = true; cb.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(/1 done/.test(text("#glistCount")), "checking off an item");
  click(btn("Clear checked", $("#glistBox")));
  ok(/empty/.test(text("#glistCount")), "clear checked");
  click(btn("2", $(".serving"))); click(btn("Add 2 to plate", $("#out")));
  $("#q").value = "Brown rice"; submit("#form"); click(btn("Add 1 to plate", $("#out")));
  ok(/2 items/.test(text("#plateCount")), `plate has two items (${text("#plateCount")})`);
  ok(/≈ \$\d+\.\d\d/.test(text("#plateItems .ptotal")), `plate total includes a typical cost (${text("#plateItems .ptotal")})`);
  click($("#plateView"));
  ok(text("#out h2") === "Your plate" && /whole meal/.test(text(".tag")) && Number(text(".label .cal .v")) === Math.round(187 * 2 + 218), `plate verdict with summed calories (${text(".label .cal .v")})`);
  ok(!$("#out .swap") && !$("#cmpq"), "plate view hides swaps and compare");
  const sel = $("#plateItems select"); sel.value = "1"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(Number(text(".label .cal .v")) === Math.round(187 + 218), "changing plate servings updates the plate view");
  $("#q").value = "Ground beef 80/20"; submit("#form");
  type("#cmpq", "Ground beef 93/7"); $(".compare .suggest li").dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
  click(btn("Per 100 calories", $(".compare")));
  ok(/Per 100 calories/.test(text(".ctable thead")) && /100 calories/.test(text(".ctable thead .sv")), "compare per 100 calories");
  click($('#tabs [data-view="browse"]'));
  click(btn("Least healthy first", $("#bsort"))); click(btn("Per 100 calories", $("#bbasis")));
  ok(!$("#bbasis").hidden && /nutrient density/.test(text("#bsortNote")), "browse per-100-calorie basis");
  click(btn("A–Z", $("#bsort")));
  ok($("#bbasis").hidden, "basis hidden for A–Z");
  click(btn("Start", $("#quiz")));
  const optsBefore = $$("#quiz .qopt").length;
  ok(optsBefore >= 2 && text("#quiz .qprompt").length > 10, `quiz shows a question (${text("#quiz .qprompt")})`);
  click($$("#quiz .qopt")[0]);
  ok(/Correct\.|Not quite/.test(text("#quiz .qres")) && /right/.test(text("#learnScore")), `answering scores it (${text("#learnScore")})`);
  click($("#quizNext"));
  ok($$("#quiz .qopt.right").length === 0, "next question resets");
  // Check text nodes one by one: a stray "null" node next to other text doesn't have word boundaries in textContent.
  const nullText = (root = w.document.body) => [root, ...root.querySelectorAll("*")].some(e => [...e.childNodes].some(n => n.nodeType === 3 && /^\s*(null|undefined)\s*$|\bnull\b|\bundefined\b/.test(n.textContent)));
  ok(!nullText(w.document.getElementById("quiz")), "quiz never renders the text null");
  const where = [...w.document.body.querySelectorAll("*")].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && /\bnull\b|\bundefined\b/.test(n.textContent))).map(e => (e.id || e.className || e.tagName) + ": " + e.textContent.slice(0, 60));
  ok(!nullText(), "no null or undefined text anywhere on the page" + (where.length ? ` (${where.join(" | ")})` : ""));
  // Prices: typical price and value on the result, your own price, compare row, value sort, plate total.
  w.localStorage.removeItem("myPrices");
  $("#q").value = "Eggs"; submit("#form");
  const PD = w.SelfCheckPricesData.foods.Eggs;
  ok(new RegExp(`≈ \\$${PD[0].toFixed(2)} per serving`).test(text(".price")) && /g protein per \$1/.test(text(".price")) && /per dozen · BLS average price/.test(text(".price")), `price panel (${text(".price")})`);
  click(btn("Use my store's price", $(".price")));
  $("#myPrice").value = "3.60"; click(btn("Save", $(".price")));
  ok(/≈ \$0\.30 per serving/.test(text(".price")) && /Your price: \$3\.60 per dozen/.test(text(".price")), `your own price per dozen (${text(".price")})`);
  ok(JSON.parse(w.localStorage.getItem("myPrices")).Eggs.unit === 3.6, "your price is saved");
  click(btn("2", $(".serving")));
  ok(/≈ \$0\.60 for 2 servings/.test(text(".price")), `price follows servings (${text(".price").slice(0, 40)})`);
  click(btn("Use typical price", $(".price")));
  ok(!/Your price/.test(text(".price")), "back to the typical price");
  $("#q").value = "Hummus"; submit("#form");
  ok(/No typical price/.test(text(".price")) && !!btn("Add my price", $(".price")), "foods without a series say so and accept your price");
  $("#q").value = "Chicken breast, grilled"; submit("#form");
  type("#cmpq", "ground beef 80/20"); $(".compare .suggest li").dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
  ok($$(".ctable tr").some(r => /^Typical price\$/.test(r.textContent)), "compare shows typical price");
  click($('#tabs [data-view="browse"]')); await tick(5);
  click(btn("All", $("#cats"))); click(btn("Most protein per $", $("#bsort")));
  const firstVal = $("#blist .bitem");
  ok(/g\/\$/.test(firstVal.textContent) && /protein a dollar buys/.test(text("#bsortNote")), `protein-per-dollar sort (${firstVal.textContent})`);
  click(btn("A–Z", $("#bsort"))); click($('#tabs [data-view="check"]'));
  // 16. Small fixes
  $("#q").value = "Avocado"; submit("#form");
  type("#cmpq", "salmon"); $(".compare .suggest li").dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
  ok((text(".compare").match(/Compare/g) || []).length === 1 + (text(".compare").match(/Compare with/g) || []).length, `"Compare" appears once as a heading (${text(".compare").slice(0, 60)})`);
  const cal = $("#p-cal"), before = cal.value;
  // -500 then leaving the field: one consistent state (the typed value stays, marked invalid, nothing saved).
  const heights = () => ["p-cal", "p-pro", "p-sat"].map(id => Math.round($("#" + id).getBoundingClientRect().height) + ":" + $("#" + id).parentElement.children.length).join(",");
  const h0 = heights();
  cal.value = "-500"; cal.dispatchEvent(new w.Event("input", { bubbles: true })); cal.dispatchEvent(new w.Event("change", { bubbles: true })); cal.blur();
  ok(cal.value === "-500" && cal.getAttribute("aria-invalid") === "true" && text("#p-cal-err") === `Use a number from 800 to 6,000. Still using ${Number(before).toLocaleString("en-US")}.`, `-500 stays in the field with its error (${cal.value}: ${text("#p-cal-err")})`);
  ok(JSON.parse(w.localStorage.getItem("profile") || "{}").cal !== -500 && text("#profSummary").startsWith(Number(before).toLocaleString("en-US") + " cal"), `invalid goal isn't saved (${text("#profSummary")})`);
  ok(heights() === h0, `every goal field reserves its message line, so nothing shifts (${h0} → ${heights()})`);
  $("#p-pro").value = "120"; $("#p-pro").dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(cal.value === "-500" && cal.getAttribute("aria-invalid") === "true", "saving another goal doesn't overwrite the invalid field");
  cal.value = before; cal.dispatchEvent(new w.Event("input", { bubbles: true })); cal.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(cal.getAttribute("aria-invalid") === "false" && text("#p-cal-err") === "", "fixing it clears the message");
  $("#p-pro").value = "100"; $("#p-pro").dispatchEvent(new w.Event("change", { bubbles: true }));
  for (const n of ["Apple", "Banana", "Orange", "Pear", "Kiwi", "Mango", "Lemon", "Greek yogurt, plain nonfat", "Greek yogurt, vanilla"]) { $("#q").value = n; submit("#form"); }
  const recentChips = $$("#recentRow .chip").map(c => c.textContent);
  ok(recentChips.length <= 6, `recents show at most 6 (${recentChips.length})`);
  ok(new Set(recentChips).size === recentChips.length && recentChips.includes("Greek yogurt, vanilla"), `recent chip labels are unique (${recentChips.join(", ")})`);
  // Tab bar: one view at a time, counts on the tabs, opening a food from another view goes to Check.
  {
    const tab = v => $(`#tabs [data-view="${v}"]`);
    const shown = () => $$(".view").filter(n => !n.hidden).map(n => n.id).join(",");
    click(tab("list"));
    ok(shown() === "glistBox" && tab("list").getAttribute("aria-current") === "page", `List tab shows only the list (${shown()})`);
    const toBuy = JSON.parse(w.localStorage.getItem("grocery") || "[]").filter(x => !x.done).length;
    ok($("#tabListN").hidden === !toBuy && (!toBuy || text("#tabListN") === String(toBuy)), `List tab counts what's left to buy (${text("#tabListN")} of ${toBuy})`);
    if (MODE === "pages") ok(w.location.hash === "#list", `List view has its own address (${w.location.hash})`);
    click(tab("plate"));
    ok(shown() === "plateBox,meals" && text("#tabPlateN") === String(JSON.parse(w.localStorage.getItem("plate") || "[]").length), `Plate tab shows the plate and its count (${text("#tabPlateN")})`);
    click(tab("browse"));
    ok(shown() === "learn,browse" && $$("#blist .bitem").length > 400, `Browse shows the quiz and the food list (${shown()}, ${$$("#blist .bitem").length})`);
    click($("#blist .bitem button") || $("#blist .bitem"));
    ok(shown() === "out" && tab("check").getAttribute("aria-current") === "page" && text("#out h2").length > 0, `opening a food from Browse switches to Check (${text("#out h2")})`);
    if (MODE === "pages") {
      w.location.hash = "#goals"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(2);
      ok(shown() === "profile,alBox,prefBox,dataBox,installBox,phoneBox", `#goals opens the Goals view (${shown()})`);
      w.location.hash = "#avocado"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(2);
      ok(shown() === "out" && text("#out h2") === "Avocado", `a food link returns to Check (${text("#out h2")})`);
    }
    click(tab("check"));
  }
  // Grocery list: store sections, quantity, trip estimate, swap for a Limit-it item.
  {
    w.localStorage.setItem("grocery", "[]");
    for (const n of ["Bacon", "Banana", "Eggs", "Frozen mixed vegetables"]) { $("#q").value = n; submit("#form"); click(btn("Add to list", $("#out"))); }
    click($('#tabs [data-view="list"]'));
    const secs = $$("#glistItems .lsec").map(e => e.textContent);
    ok(secs.join(",") === "Produce,Meat & seafood,Dairy & eggs,Frozen", `list is grouped by store section in aisle order (${secs.join(", ")})`);
    const eggsRow = $$("#glistItems .lrow").find(r => /^Eggs/.test(r.querySelector("label").textContent));
    const before = text(".ltotal .amt");
    click(eggsRow.querySelector('.qty button[aria-label^="One more"]'));
    const eggsRow2 = $$("#glistItems .lrow").find(r => /^Eggs/.test(r.querySelector("label").textContent));
    ok(eggsRow2.querySelector(".qty span").textContent === "2" && (([, t, u]) => Math.abs(t - 2 * u) < 0.011)(eggsRow2.querySelector(".lprice").textContent.match(/\$([\d.]+)\D+\$([\d.]+)/).map(Number)), `quantity goes up and the row price follows (${eggsRow2.querySelector(".lprice").textContent})`);
    ok(text(".ltotal .amt") !== before && /for 4 items/.test(text(".ltotal")), `trip estimate updates (${before} → ${text(".ltotal .amt")}; ${text(".ltotal").slice(0, 60)})`);
    const baconSwap = $$("#glistItems .lswap").find(e => /Try/.test(e.textContent));
    ok(baconSwap && /Try instead/.test(baconSwap.textContent) && /Limit it/i.test(baconSwap.parentElement.querySelector(".vp").textContent), `Limit-it items offer a swap (${baconSwap && baconSwap.textContent})`);
    const swapTo = baconSwap.querySelector("b").textContent;
    click(btn("Swap it", baconSwap));
    ok(JSON.parse(w.localStorage.getItem("grocery")).some(x => x.n === swapTo) && !JSON.parse(w.localStorage.getItem("grocery")).some(x => x.n === "Bacon"), `Swap it replaces the item (${swapTo})`);
    click($('#tabs [data-view="check"]'));
  }
  // Meal ideas: each is a Get it meal under budget; "Use as my plate" fills the plate.
  {
    click($('#tabs [data-view="plate"]'));
    const ideas = $$("#mealList .idea");
    ok(ideas.length >= 3 && ideas.every(i => /Get it/i.test(i.querySelector(".vp").textContent)), `meal ideas show, each rated Get it (${ideas.length})`);
    const costs = ideas.map(i => Number(i.querySelector(".cost").textContent.replace(/[^\d.]/g, "")));
    ok(costs.every((c, i) => c <= 3 && (!i || c >= costs[i - 1])), `ideas are within $3, cheapest first (${costs.join(", ")})`);
    click(btn("Up to $2", $("#mealBudget")));
    ok($$("#mealList .cost").every(e => Number(e.textContent.replace(/[^\d.]/g, "")) <= 2), "budget chip narrows the ideas");
    click(btn("Up to $3", $("#mealBudget")));
    const first = $$("#mealList .idea li").length && $("#mealList .idea");
    const names = [...first.querySelectorAll("li")].map(li => li.textContent.replace(/^[\d½.]+ × /, "").replace(/ \(.*$/, ""));
    click(btn("Use as my plate", first));
    ok(JSON.stringify(JSON.parse(w.localStorage.getItem("plate")).map(x => x.n)) === JSON.stringify(names), `Use as my plate fills the plate (${names.join(" + ")})`);
    click(btn("See why", $("#mealList .idea")));
    ok(text("#out h2") === "Meal idea" && /whole meal/.test(text(".tag")) && !!btn("Use as my plate", $("#out")), `See why opens the meal's verdict (${text("#out h2")})`);
    click($('#tabs [data-view="check"]'));
  }
  // Backup: copied text previews what it holds; junk is refused; nothing changes until Restore.
  {
    click($('#tabs [data-view="goals"]'));
    const B = w.SelfCheckBackup, backup = JSON.stringify(B.pack(k => { const v = w.localStorage.getItem(k); return v ? JSON.parse(v) : undefined; }));
    click($("#bkPasteBtn")); $("#bkText").value = backup; click($("#bkPasteGo"));
    ok(/grocery items/.test(text("#bkPreview")) && /plate items/.test(text("#bkPreview")) && !!btn("Restore", $("#bkPreview")), `pasted backup shows what it holds (${text("#bkPreview").slice(0, 120)})`);
    $("#bkText").value = '{"app":"other"}'; click($("#bkPasteGo"));
    ok(/isn't a Should I Buy It\? backup/.test(text("#bkPreview")) && !btn("Restore", $("#bkPreview")), `a non-backup is refused (${text("#bkPreview")})`);
    ok($("#bkLink").hidden === (MODE !== "pages"), `transfer link button ${MODE === "pages" ? "shown" : "hidden"} in ${MODE} mode`);
    click($('#tabs [data-view="check"]'));
  }
  // Public-site basics: allergen line, standard-goals hint, report link, footer links.
  if (MODE === "pages") {
    w.location.hash = "#greek-yogurt-plain-nonfat"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    ok(/Allergens and diets aren't checked until you add yours/.test(text(".allergy")), "with no allergies set, the result says they aren't checked");
    // Allergies: tick Milk under Goals, and the yogurt gets a "Contains milk" flag; the verdict itself doesn't change.
    const word = text(".tag .verdict");
    const milk = $("#p-al-milk"); milk.checked = true; milk.dispatchEvent(new w.Event("change", { bubbles: true })); await tick(2);
    ok(/Contains milk/.test(text(".alflag.contains")), "a milk allergy flags plain Greek yogurt", text(".alflag"));
    ok(text(".tag .verdict") === word, "the allergen flag leaves the verdict alone");
    ok(!/\bsafe\b/i.test(text(".alflag")), "the flag never says safe");
    w.location.hash = "#apple"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    ok($(".alflag.clear") && /None of your allergens found/.test(text(".alflag")) && /read the label/.test(text(".alflag")), "a food without it still says to read the label", text(".alflag"));
    milk.checked = false; milk.dispatchEvent(new w.Event("change", { bubbles: true })); await tick(2);
    ok(!$(".alflag"), "unticking removes the flag");
    // Diet: tick Vegetarian, and grilled chicken says so; tofu doesn't.
    const veg = $("#p-al-vegetarian"); veg.checked = true; veg.dispatchEvent(new w.Event("change", { bubbles: true })); await tick(2);
    w.location.hash = "#chicken-breast-grilled"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    ok(/Contains meat, fish or gelatin/.test(text(".alflag.contains")), "a vegetarian diet flags grilled chicken", text(".alflag"));
    w.location.hash = "#tofu-firm"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    ok($(".alflag.clear") && /Nothing your diet rules out found/.test(text(".alflag")), "tofu passes a vegetarian diet", text(".alflag"));
    veg.checked = false; veg.dispatchEvent(new w.Event("change", { bubbles: true })); await tick(2);
    w.location.hash = "#greek-yogurt-plain-nonfat"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(4);
    const rep = $(".report a");
    ok(rep && /issues\/new\?title=Wrong\+verdict/.test(rep.href) && /Verdict%3A/.test(rep.href), "a prefilled report link sits under the label");
    ok($$("footer .footlinks a").map(a => a.getAttribute("href")).includes("about.html"), "footer links to How it works");
    const forText = text(".tag .for");
    ok(/^(For you|Standard goals · Set yours)$/.test(forText), `the verdict says whose goals it uses (${forText})`);
  }
  // Links from the extension (#add=) and the phone bookmarklet (#wm=), on the GitHub Pages version.
  if (MODE === "pages") {
    const B = w.SelfCheckBackup, { data } = require("../fixtures/walmart-compact.js");
    const before = JSON.parse(w.localStorage.getItem("grocery") || "[]").length;
    const add = await B.encode(B.packAdd([{ n: "Great Value Creamy Peanut Butter, 40 oz", food: { n: "x", s: "2 tbsp (32 g)", cal: 180, fat: 16, sat: 3, trans: 0, chol: 0, na: 135, carb: 7, fib: 2, sug: 3, add: 2, pro: 7, src: "walmart", missing: [], storePrice: { perServing: 0.113, item: 3.98, unitText: "10.0 ¢/oz", store: "Walmart", on: "2026-10-25" } } }, { n: "Banana", qty: 2 }]));
    w.location.hash = "#add=" + add; w.dispatchEvent(new w.HashChangeEvent("hashchange"));
    for (let i = 0; i < 100 && !text("#addPreview"); i++) await tick(2); // decoding a compressed link is async
    ok(!$("#glistBox").hidden && /Add 2 items from the browser extension/.test(text("#addPreview")), `#add= opens the list with a preview (${text("#addPreview").slice(0, 60)})`);
    ok(JSON.parse(w.localStorage.getItem("grocery") || "[]").length === before, "nothing is added before you confirm");
    click(btn("Add to my list", $("#addPreview"))); await tick(2);
    const gl = JSON.parse(w.localStorage.getItem("grocery"));
    ok(gl.some(x => x.n === "Great Value Creamy Peanut Butter, 40 oz") && gl.find(x => x.n === "Banana").qty === 2, "confirmed items join the list (with quantity)");
    const pbRow = $$("#glistItems .lrow").find(r => /Great Value Creamy Peanut Butter/.test(r.textContent));
    ok(pbRow && /In moderation/i.test(pbRow.textContent), `the store product keeps its label values and verdict (${pbRow && pbRow.textContent.slice(0, 80)})`);
    ok(pbRow && /\$3\.98/.test(pbRow.textContent) && !/no typical price/.test(pbRow.textContent), `the list row uses Walmart's item price (${pbRow && pbRow.textContent.slice(0, 90)})`);
    // Bookmarklet: a product read from a Walmart page opens with its verdict.
    const payload = JSON.stringify({ app: "should-i-buy-it", v: 1, kind: "walmart", data: data("chobani greek yogurt") });
    w.location.hash = "#wm=j." + Buffer.from(payload).toString("base64url"); w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(8);
    ok(/Chobani Non-Fat Greek Yogurt/.test(text("#out h2")) && /Get it/.test(text(".tag .verdict")) && /Walmart's Nutrition Facts panel/.test(text(".src")), `#wm= shows the Walmart product's verdict (${text("#out h2")})`);
    ok(/1 ingredient · no additives found/.test(text(".ingredients .ing-sum")) && /Cultured Nonfat Milk/.test(text(".ingredients")), `the Walmart product's ingredients are grouped (${text(".ingredients .ing-sum")})`);
    ok(/Walmart's price/.test(text("#out")) && /\$1\.12 per serving/.test(text("#out")) && /\$5\.97/.test(text("#out")), `#wm= shows the price from the Walmart page (${(text("#out").match(/≈[^.]*\.[^.]*/) || [""])[0].slice(0, 90)})`);
    // A supplement from the bookmark: its own view, not a food verdict.
    const { build: buildPage } = require("../fixtures/walmart-compact.js");
    const supp = require("../fixtures/walmart-supplements.json").pages.labeled;
    const spayload = JSON.stringify({ app: "should-i-buy-it", v: 1, kind: "walmart", data: buildPage(supp) });
    w.location.hash = "#wm=j." + Buffer.from(spayload).toString("base64url"); w.dispatchEvent(new w.HashChangeEvent("hashchange")); await tick(8);
    ok(/Supplement/.test(text(".tag.supp")) && /200 mg caffeine \(50% of the FDA's 400 mg a day\)/.test(text("#out")) && /75 mg sodium/.test(text("#out")), `#wm= with a pre-workout shows the supplement view (${text(".tag.supp .why").slice(0, 90)})`);
    click($('#tabs [data-view="goals"]'));
    ok(/^javascript:/.test($("#bmLink").getAttribute("href")) && !!$("#bmCopy"), "Goals offers the phone bookmark");
    click($('#tabs [data-view="check"]'));
  } else ok(!$("#phoneBox"), "no phone bookmark in the Claude version");
  ok(errors.length === 0, "no script errors" + (errors.length ? ": " + errors.join(" | ") : ""));
})();
