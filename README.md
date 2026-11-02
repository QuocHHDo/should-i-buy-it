# Should I Buy It?

Search or scan a food and see its nutrition label plus a verdict for *your* goals: **Get it**, **In moderation**, **Limit it**, or **Skip**. Every verdict comes with the reasons behind it, so using the app teaches the handful of principles (saturated fat, protein per calorie, fiber, sodium, added sugar) that explain most food choices.

Live at **https://quochhdo.github.io/should-i-buy-it/**. It installs to your phone's home screen and works offline.

## Features

- **486 built-in foods** across 13 categories, with search and aliases ("boba", "EVOO", "hamburger").
- **Nutrition label** in FDA format; tap any line to see what it means and how it compares with your daily target.
- **Tab bar** for Check, Plate, List, Browse and Goals (at the bottom on phones), each with its own link (`#plate`, `#list`, `#browse`, `#goals`).
- **Personal verdict** scored against your calorie, protein, saturated fat, sodium, added sugar and fiber goals, plus a skip list and a mild-food preference.
- **Allergen flags**: tick the nine major US allergens (milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame) or type others under Goals. Every food then says **Contains**, **May contain**, **Couldn't check** (a lookup with no ingredient list) or **None of your allergens found**, never "safe". Sources, strongest first: Open Food Facts' allergen and traces lists, the label's ingredient list (with synonyms like whey, albumin, semolina, tahini, and "may contain" / shared-facility statements), the food's name, and a typical recipe for each built-in food. The flag sits above the verdict and on every pill (search, Browse, List, Plate, recent scans); swaps and cheap meal ideas leave those foods out. The extension's badge and side panel show it too (`js/allergens.js`).
- **Healthier swaps** for anything below "Get it," with the difference spelled out ("5.3 g less saturated fat").
- **Compare two foods** side by side, per serving or per 100 calories, with a one-line answer on top ("Reduced fat 2% milk has less saturated fat. Both: In moderation."). In the store, **Compare two products** (on the phone home, or "Scan to compare" on any product) scans one barcode, then the other; recent scans are one tap away. Prices you enter are kept by barcode for scanned products, so two products with the same name don't share one. Type the two **shelf prices** (price and package size, like "3.99" and "64 fl oz" or "2 x 64 fl oz") and the table adds the price of a serving and protein per dollar (`PR.shelfCost` in `js/prices.js`).
- **Scanned products are remembered by barcode**: a barcode scanned before opens at once from the device, with no lookup (re-checked online after 30 days, and used at any age when the databases can't be reached).
- **A second opinion for bad records**: when an Open Food Facts record has impossible numbers, the barcode is also looked up in USDA Branded Foods (the brand's own filing), and USDA's record is used if it holds together; the card says so. The extension does the same.
- **Browse** by category, sorted A–Z, least healthy first or healthiest first, per serving or per 100 calories.
- **Plate builder**: combine foods at your servings into one meal with a total label and verdict.
- **Grocery list** grouped by store section, with quantities, an estimated trip total at typical prices, a one-tap swap for "Limit it" items, check-off, copy, and "add my Get-it favorites."
- **Cheap meal ideas** (on the Plate tab): a protein, a vegetable and a grain that add up to a "Get it" meal within your budget and protein target, cheapest first, from foods with a typical price.
- **Backup and transfer** (on the Goals tab): download or copy your saved data, restore it from a file or text, or move it to another device with a transfer link. Restores are checked field by field and previewed first; your USDA key is never included.
- **Learn mode** (under Browse): a quiz built from the app's own data; missed questions come back after 3, 8, then 20 questions.
- **Serving size** control (½× to 3×), **favorites**, **recent searches**, and **shareable links** (`#salmon`).
- **Lookups beyond the built-in list**: USDA search and barcode scanning via Open Food Facts on the web version; a Claude lookup in the Claude version.
- **Read a photo of the label** when a barcode isn't found (or there's none): the photo is read on the device with Tesseract.js, the numbers fill a form to check and fix, and only then is it scored. See "Label photos" below.
- **Impossible numbers are caught**: a looked-up record with sodium heavier than 40% of the serving, saturated or trans fat above total fat, fiber or sugars above carbs, added sugar above total sugars, or cholesterol in a plant-based drink has those values left out ("—", not scored) and named on the card, with a link to fix the record on Open Food Facts. Calories that fat, carbs and protein can't account for are noted too (alcoholic drinks excepted). Found on Kirkland's oat drink, whose Open Food Facts record listed 240 g of sodium a serving (`S.check` in `js/sources.js`).
- **Installable and offline** via a service worker.

- **Works like a phone app**: install it to the home screen (Android shows an Install button; iPhone gets the Share → Add to Home Screen steps; Goals has both). The installed app opens on a big Scan button with your recent scans and their verdicts, starts the camera right away when it's already allowed, and has Scan and Grocery list shortcuts on its icon. No app store needed.
- **Phone bookmark for Walmart and Sam's Club** (Goals tab): tap it on a Walmart product page to open its verdict here.
- **Browser extension for Walmart product pages** (`extension/`): a card with the verdict, the main reasons and any flagged additives, using your goals. See below.

Everything runs in the browser. Goals, favorites, lists and lookups live in your browser's local storage; there is no account and no server.

## How the verdict works

Each serving gets a point score from about a dozen rules measured against your goals: protein per calorie, fiber, low-calorie volume, fat quality, and saturated fat, sodium and added sugar as a share of your daily limits, plus penalties for processed meat and empty calories. A score of +2 or more is "Get it," −1 to +1 "In moderation," −2 or less "Limit it." The rules live in [`js/verdict.js`](js/verdict.js).

## Design decisions

- **Allergens are a flag, not a score.** An allergen doesn't make a food less healthy, so it never changes the verdict; it gets its own box above it. Detection leans toward flagging: negations only rule out one word ("no added sugar, milk" still flags milk), look-alikes are listed explicitly (coconut milk, peanut butter, eggplant, buckwheat, nutmeg), and highly refined soybean oil, which US law exempts, is a "may" rather than a "contains". With nothing to check, it says so instead of guessing.
- **The verdict is computed by code, never by a model.** Even in the Claude version, Claude only supplies label numbers; the page scores them with the same rules. The same numbers always get the same verdict, and every verdict can be traced to a rule.
- **Label-based scoring, with a short evidence list.** Labels can't show polyphenols or omega-3 types, so a handful of foods with strong outcome research (extra virgin olive oil, fatty fish, nuts) get +1 with an explanation. A test caps that list at 12 so scoring doesn't drift into opinion.
- **Cholesterol is a note, not a penalty.** For most people saturated fat drives blood cholesterol far more than dietary cholesterol, so eggs and shrimp aren't punished for it.
- **Per serving by default, per 100 calories on request.** Per serving matches how people eat; per 100 calories shows nutrient density. Foods under 25 calories per serving keep their per-serving score, since scaling a teaspoon of hot sauce to 100 calories says nothing useful.
- **Swaps are hand-picked where it matters.** A generic search (same category, similar name and calories) fills in, but it suggested beer for soda and cocoa powder for soy sauce, so common foods have curated swaps, and liquids, cooking fats and pantry staples only swap within their kind.
- **One source, two targets.** `index.html` + `js/` is the GitHub Pages app; `scripts/build-single.mjs` inlines it into the single file the Claude version needs, with personal goals passed in from outside the public repo.

## Testing

```sh
npm test            # 217 unit tests (node tests/run.js): data, verdict rules, allergens, swaps, search, API conversions, OCR parsing, prices, quiz, evals
npm run typecheck   # TypeScript checks every js/ and extension/ file from JSDoc (tsconfig.json); nothing is built or emitted
node tests/verdict-dump.js > verdicts.csv   # every built-in food's verdict and reasons, for eyeballing outliers
node scripts/build-additives.mjs <openfoodfacts-server>/taxonomies   # regenerate js/additives-data.js from Open Food Facts
BLS_CONTACT=you@example.com node scripts/fetch-prices.mjs /tmp/prices && node scripts/build-prices.mjs /tmp/prices   # rebuild js/prices-data.js (the Update prices workflow does this monthly)
npm install && npm run test:ui   # click-through test of every feature in both versions + axe accessibility check
npm run test:layout # Playwright: layout at 320/375/414/1280 px, a real barcode decode from a fake camera, the phone app (compare, label photos, prices) and the extension in Chromium
npm run snapshot    # after an intentional rule or data change: rewrite the verdict snapshot, then review the diff
```

A snapshot of every food's verdict catches unintended scoring changes. The **Tests** workflow runs everything on every push: unit tests and the type check, the jsdom click-through, and the real-browser tests in Chromium. The UI test mocks USDA, Open Food Facts and Claude responses using their documented formats. Color contrast was checked separately against WCAG AA (4.5:1) in light and dark themes.

## Accuracy evals

The built-in values were written by Claude from general nutrition knowledge, not copied from a database. Two evals measure how far off that is:

| Eval | What it measures | Run |
| --- | --- | --- |
| [`eval/compare-usda.mjs`](eval/compare-usda.mjs) | Each built-in food against its USDA FoodData Central record, scaled to the serving: error per nutrient and whether the verdict would change | `USDA_API_KEY=… npm run eval` or the **USDA accuracy eval** workflow |
| [`eval/claude-vs-usda.mjs`](eval/claude-vs-usda.mjs) | Fresh Claude lookups, using the app's exact prompt, against the same USDA records, side by side with the built-in values | `ANTHROPIC_API_KEY=… USDA_API_KEY=… npm run eval:claude` or the **Claude lookup eval** workflow |
| [`llm-eval/`](llm-eval/README.md) | How accurately Claude models extract the numbers from nutrition-label text (60 synthetic labels), and how good their "should I buy it?" verdicts are, scored by an LLM judge. Self-contained TypeScript package with its own tests | `cd llm-eval && npm ci && npm run eval -- --limit 10` |

The USDA eval also writes `eval/suggested-values.json`: confident matches that differ by more than 25%, with USDA's numbers scaled to the serving, for a person to review (raw vs cooked, brand vs generic) before updating `js/foods.js`. When USDA's top search result is the wrong food, pin the right record in `eval/usda-map.json`.

### Results: built-in values vs USDA (October 24, 2026)

In the last USDA check (before 37 foods were added), 439 of 449 foods were searched; 304 had a USDA record the matcher trusts as the same food. Within that set:

| Nutrient | Median error | Within 10% | Within 25% |
| --- | --- | --- | --- |
| Calories | 3% | 71% | 90% |
| Protein | 4% | 66% | 87% |
| Total fat | 4% | 68% | 82% |
| Saturated fat | 6% | 62% | 76% |
| Carbs | 3% | 68% | 85% |
| Fiber | 3% | 61% | 78% |
| Sugars | 5% | 58% | 76% |
| Sodium | 6% | 61% | 79% |

**Verdicts agree for 89% of foods (271 of 304)** when USDA's numbers replace the built-in ones.

A manual review of every food flagged at more than 25% off found that most gaps are not errors: about 50 were still the wrong USDA record (now caught by the matcher), and about 100 were different products (salted vs unsalted nuts, USDA survey records that assume salt or fat added in cooking, brand-specific items like jerky or protein shakes). Three were genuine errors and were corrected: roasted turkey breast (fat), molasses (sugar) and catfish (sodium).

**What the first runs taught about the eval itself.** The first run's numbers were wrong for three reasons, all since fixed and covered by tests: USDA's API intermittently rejected about half of all requests (now retried); the top search result was taken as the match, so "Broccoli" was compared with fried broccoli (now 25 candidates are ranked, with penalties for words that make it a different food and a preference for basic raw or cooked records matching the serving); and nutrients missing from a record counted as zero, so olive oil appeared to have no fat (now unknown). Some correct matches are still rejected (fig bars are filed under "Cookies") and some variant mismatches still pass (soft vs hard pretzels), so flagged foods get a human review before any data change.

The Claude lookup eval has not been run (it needs a paid API key).

## Project layout

```
index.html                 markup and styles
js/foods.js                built-in food data
js/verdict.js              scoring, explanations, swaps, per-100-calorie view, plate totals (pure)
js/sources.js              USDA, Open Food Facts and Claude conversions + the Claude prompt (pure)
js/learn.js                quiz questions and spaced repetition (pure)
js/compare.js              what a comparison marks as better, price rows, the one-line answer (pure)
js/prices.js               typical prices, your prices (by barcode), shelf-tag parsing (pure)
js/labelocr.js             label text from OCR into numbers, with checks (pure); js/labelscan.js runs the OCR
js/walmart.js, js/costco.js store page readers (pure)
js/dom.js                  element helpers shared by the app and the extension's pages
js/camera.js               camera barcode scanning
js/app.js                  the app's screens and state
types/globals.d.ts, tsconfig.json   type checking only
sw.js, manifest.webmanifest, icons/   offline and install support
vendor/html5-qrcode.min.js barcode scanner (Apache-2.0), loaded only when scanning
tests/                     unit tests, fixtures, verdict snapshot; tests/ui/ click-through + accessibility
eval/                      USDA and Claude accuracy evals
scripts/build-single.mjs   single-file build
```

## Caveats

Values are approximate and vary by brand; the package label wins. Open Food Facts is crowd-sourced and can be incomplete. The scoring thresholds are rules of thumb, not a clinical standard. General nutrition guidance, not medical advice.

## Browser extension (Walmart, Sam's Club and Costco product pages)

`extension/` is a Chrome extension (Manifest V3, Chrome 116+) that shows a verdict on Walmart product pages (`walmart.com/ip/…`). It uses the same verdict code and foods as the site, and it's free: no server, no account.

It works the same on **Sam's Club** (`samsclub.com/ip/…`), which runs on Walmart's platform: the same product URLs, page data, title and rating row, so one reader serves both (`STORES` in `js/walmart.js`); wording, swap searches and prices name the store. Search badges stay off on Sam's Club, which checks for robots more readily; if a store asks for that check, the badge says to reload instead of failing.

On **Costco** (`costco.com/p/-/…/<id>`) a separate reader, `js/costco.js`, returns the same product shape. Costco's pages carry no Nutrition Facts as text (the label is a photo), so the route is the barcode: the page's structured data (JSON-LD) gives the name, item number, brand, price and category, and the item's record in the page data gives its UPC, department and size (for the price per ounce). Costco's department decides what's food (it files paper towels under Grocery); produce goes by name, and vitamins get the supplement view. The badge sits in the empty space right of the star rating, absolutely positioned so nothing moves. Search badges and the phone bookmark don't cover Costco.

It has two levels:

1. **A badge next to the star rating**: the verdict's icon and word and a short reason ("Fine · nothing to flag", "Limit it · 30% of your saturated-fat limit"), with ⚠ only when missing data could change the verdict. It sits in Walmart's rating row in a zero-height slot, so the page doesn't move, and it's a real button in a Shadow DOM. Without a rating row it falls back to a small floating pill that never covers Add to cart, Buy now or checkout. Walmart changes pages without reloading; the badge follows and is never injected twice. Non-food pages get no badge.
2. **The side panel** (`sidepanel.html`, Chrome's side panel API): the full breakdown for the active tab's product, opened by clicking the badge or the toolbar button. Verdict, daily-limit bars with shaded zones (fine / counts against / counts double), short notes with the full sentence behind "more", ingredients in plain groups (a conflict with the product name, like caffeine in a caffeine-free soda, is marked next to that ingredient), additives, a swap, sources, and your goals. It re-scores with your saved goals, follows tab and product changes, supports dark mode, and shows an empty state on other pages. Where the side panel isn't available, the same view opens in a tab.

The content script hands the product to the panel through the background script, which keeps it per tab in `chrome.storage.session`.

**Supplements** (pre-workouts, vitamins, capsules: a Supplement Facts label, or a supplement category or name) aren't scored like food. The badge says "Supplement · 200 mg caffeine", and the panel shows caffeine per serving against the 400 mg a day the FDA cites for healthy adults, sodium, sugar and calories (nutrients left off a Supplement Facts label count as 0, since the FDA lets labels omit amounts that round to zero), the sweeteners, everything the label lists, and a note that the app doesn't judge whether a supplement works. Products with a real Nutrition Facts panel and 20+ calories (protein powder, meal shakes) stay foods. When the page has the label only as a photo, caffeine comes from the product's name and nothing else is guessed (`js/supplement.js`).

Each verdict has its own color and shape: Get it (green check), Fine (gray dot), In moderation (amber triangle), Limit it (red octagon), Skip (red slashed circle).

Where the numbers come from, in order:

1. **The page's own Nutrition Facts panel** (Walmart's page data), for the exact product.
2. **Fresh produce** matched by name to the app's typical values.
3. **The barcode** in Open Food Facts, then USDA Branded Foods.

More in the extension:
- **+ Add to list** on the card; a "Send to your list in the app" link (on the card and in the settings) opens the app, which shows the items and asks before adding them to the grocery list (merged, nothing replaced).
- **Walmart's own price**: the side panel works out the cost per serving from the page's unit price (e.g. 18.7 ¢/oz × a 170 g cup ≈ $1.12) and, for protein or fiber picks, how much you get per dollar. Items sent to the app's list, and products opened with the phone bookmark, carry that price, so the trip total uses it. Weight and volume unit prices convert; per-count prices don't.
- **Ingredient data checked against the name**: when a product's name says caffeine-free, sugar-free or gluten-free and its ingredient list disagrees, that ingredient is marked ⚠ with a one-line explanation. This happens on Walmart's own listings too: the Caffeine-Free Diet Coke 12-pack's ingredients on walmart.com include caffeine (Oct 2026).
- **Ingredients, sorted**: the side panel shows the label's own allergen statement (“Contains: Egg”) and opens the ingredient list into plain groups: foods, whole grains, water/salt/vinegar, added sugars, oils and fats (unsaturated or saturated), refined starches, sweeteners, caffeine, flavorings, vitamins, and additives with each one's job and status. Numbers are each ingredient's place on the label. It describes rather than scores: the verdict already counts the amounts that matter. The app shows the same breakdown (`js/ingredients.js`).
- **Swaps of the same kind**: “Try instead” only offers the same kind of food: a creamy sauce for a creamy sauce, cereal for cereal, a breakfast meat for bacon, an oil for butter (`KINDS` in `js/verdict.js`). Store products borrow the hand-picked swaps of the built-in food their name contains (Oscar Mayer bacon → Bacon's). When nothing of the same kind earns a better verdict, a lighter version of the same kind is offered instead (at least 40% fewer calories or less sodium, added sugar or saturated fat at the same weight, and no more of the others), labeled “A lighter version”. Cooking oils are never swapped for being lighter.
- **Read the label photo**: when the page has no Nutrition Facts text and the barcode databases don't know the product (Costco pages show no Nutrition Facts text; many supplement pages have the label only as a photo), the side panel offers the product's own photos to pick from, or a photo of your own. See "Label photos" below.
- **Wrong verdict? Report it**: a link in the side panel opens a GitHub issue prefilled with the product, its page and barcode, where the numbers came from and the verdict (nothing about you, and nothing is sent unless you submit it).
- **Search badges** (off by default; turn on in the settings): a verdict on each product in Walmart search and category pages. Search pages don't include nutrition, so the extension opens each product page in the background: only products you scroll to, one about every 1.5 seconds, at most 40 per page, remembered for a week.
- Barcode lookups are cached for 30 days (not found: 1 day; network failures aren't cached).

Checked against 41 real Walmart products across the store (captured Oct 25, 2026; `tests/fixtures/walmart-audit.json`): 26 have Walmart's Nutrition Facts panel, 10 go to a barcode lookup, and 5 fresh-produce items are matched by name. `tests/walmart-audit.test.js` pins each one's route and verdict.

## Label photos

`js/labelocr.js` turns OCR text into label numbers; `js/labelscan.js` runs [Tesseract.js](https://github.com/naptha/tesseract.js) in the browser and shows the form to check them. Tesseract is vendored in `vendor/tesseract/` (about 7 MB with the English model, loaded only when someone taps the button; the extension ships its own copy in `extension/ocr/`, since extensions can't load remote code). Nothing is uploaded.

It never scores silently, because OCR on package photos is unreliable. Each photo gets three passes (as-is, grayscale with contrast stretched, and grayscale at 1.5×), and each number takes the value most passes agree on. Numbers read by only one pass, corrected ("0.59" read for 0.5g), or contradicted by the label itself (its %DV, fat + carbs + protein vs calories, saturated fat over total fat) are marked "check it". The person fixes or fills in the numbers; blank ones stay unknown.

**How well it reads** (17 real phone photos of Nutrition Facts from Open Food Facts, in Chromium, Oct 2026): 109 of 165 numbers right (66%). Of the 89 it left unmarked, 3 were wrong; 10 more wrong ones were marked. Clear, flat labels came out complete or nearly (Cheerios, Skippy, Oreo, Nutella, Lay's, Quaker, Diet Coke, Hellmann's, Honey Nut Cheerios). It mostly failed on a label photographed sideways around a can, a blurry tilted bottle, tiny one-line labels (Snickers, Clif bar) and tall condensed type in columns (Kraft mac & cheese). Each photo took 3 to 8 seconds. Supplement Facts photos come back as their lines (a store's 1080-px Supplement Facts image read all but one line, with "3.2 g" read as "32 g"), shown for checking before the supplement view. A seller's 320-px Supplement Facts image on the same product page was too small to read at all. `tests/labelocr.test.js` keeps the OCR text of those 17 photos and pins the results; the browser tests read `tests/fixtures/label-skippy.jpg` (an Open Food Facts photo of Skippy's label, CC BY-SA 3.0, Open Food Facts contributors) with the real Tesseract.

## Phone bookmark (Walmart on your phone)

Phones can't run extensions, so Goals → **Walmart on your phone** gives a bookmark to save. Tapped on a Walmart product page, it reads the page's product data and opens the app with it (`#wm=…`); the app then uses the same three routes as the extension and shows the full verdict.

**Install (Chrome, Edge or Brave on a computer):**
1. Download this repository (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick the `extension` folder.
3. Click the extension's toolbar button to set your goals, or paste a backup or transfer link from the app (Goals → Your data).

Phones: Chrome on Android and iOS doesn't run extensions.

**Permissions:** storage (your goals), the side panel, Walmart, Sam's Club and Costco pages (to show the badge), optional access to Costco's image host (gdx-assets.costco.com, asked for the first time you read a Costco photo; Walmart and Sam's Club serve their photos to any site), and Open Food Facts and USDA (barcode lookups, without cookies). Nothing is sent anywhere else.

**For development:** `extension/lib/` holds copies of the app code; after changing `js/`, run `npm run sync:extension` (a test fails if the copies are out of date). `node tests/ui/extension.js` loads the extension in Chromium against saved Walmart page data (`tests/fixtures/walmart-pages.json`).

## About, data and license

- `about.html` explains how verdicts are decided, where each kind of data comes from and its license, what the allergen flags check and miss, what the app doesn't check (medical needs), and what's new. `privacy.html` is the privacy policy.
- Every result shows your allergen flag (or, with none set, a link to add them), says whether it's using standard goals or yours, and links to a prefilled GitHub issue for reporting a wrong number or verdict.
- `icons/og.png` is the link-preview image (`node scripts/og-image.js` remakes it).
- Code: MIT License (`LICENSE`). Data keeps its own license: USDA FoodData Central and BLS are public domain; Open Food Facts data, including the additive taxonomy, is ODbL 1.0, © Open Food Facts contributors.
