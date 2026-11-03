// Allergen flags: what the viewer is allergic to (their profile) against what a food is known to contain.
// It never says a food is safe. Each food gets one of four answers for the viewer's allergens:
//   "contains"  an allergen is in the food (Open Food Facts' allergen list, the label's ingredients or "Contains"
//               line, the food's own name, or a built-in food's typical recipe)
//   "may"       only a "may contain" / shared-facility statement or Open Food Facts' traces list names it
//   "unknown"   there's nothing to check against (a looked-up food with no ingredient list)
//   "clear"     none were found in what was checked; the card still says to read the label
// Separate from the verdict: an allergen doesn't change the nutrition score, it puts a flag above it.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.SelfCheckAllergens = api;
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  // The nine major US allergens (FDA, FASTER Act 2021). `words` are ingredient-list names, matched as whole words.
  // `not` are look-alike phrases taken out first ("coconut milk", "peanut butter", "oyster mushroom").
  const LIST = [
    { id: "milk", label: "Milk", hint: "dairy, whey, casein, butter, cheese",
      words: ["milk", "milks", "milkfat", "milk fat", "buttermilk", "butter", "butterfat", "butter oil", "cream", "creams", "cheese", "cheeses", "whey", "casein", "caseinate", "caseinates", "lactose", "lactalbumin", "lactoglobulin", "lactoferrin", "ghee", "yogurt", "yoghurt", "curd", "curds", "kefir", "custard", "paneer", "ricotta", "mozzarella", "cheddar", "parmesan", "half and half", "half-and-half", "dairy", "nougat"],
      not: ["coconut milk", "coconut cream", "cream of coconut", "almond milk", "oat milk", "oatmilk", "soy milk", "soymilk", "rice milk", "cashew milk", "pea milk", "hemp milk", "flax milk", "macadamia milk", "milk thistle", "peanut butter", "almond butter", "cashew butter", "nut butter", "seed butter", "sunflower butter", "sunbutter", "cocoa butter", "cacao butter", "shea butter", "apple butter", "pumpkin butter", "cream of tartar", "cream of wheat", "cream of rice", "non-dairy", "nondairy", "vegan cheese", "vegan butter", "plant-based butter", "plant-based cheese", "dairy-free cheese", "dairy-free butter", "cream soda"] },
    { id: "egg", label: "Egg", hint: "egg whites, albumin, mayonnaise",
      words: ["egg", "eggs", "egg white", "egg whites", "egg yolk", "yolk", "yolks", "albumen", "albumin", "ovalbumin", "ovomucoid", "lysozyme", "mayonnaise", "mayo", "meringue", "aioli"],
      not: ["eggplant", "eggplants"] },
    { id: "fish", label: "Fish", hint: "salmon, tuna, cod, anchovy, fish sauce",
      words: ["fish", "anchovy", "anchovies", "cod", "salmon", "tuna", "pollock", "tilapia", "sardine", "sardines", "mackerel", "haddock", "halibut", "trout", "catfish", "swordfish", "herring", "mahi", "mahi-mahi", "snapper", "flounder", "pike", "perch", "bonito", "surimi", "worcestershire", "nuoc mam", "fish sauce", "fish oil", "fish gelatin"],
      not: ["shellfish"] },
    { id: "shellfish", label: "Shellfish", hint: "shrimp, crab, lobster; also clams, scallops, mussels",
      words: ["shellfish", "shrimp", "shrimps", "prawn", "prawns", "crab", "crabs", "lobster", "lobsters", "crawfish", "crayfish", "langoustine", "krill", "scallop", "scallops", "clam", "clams", "mussel", "mussels", "oyster", "oysters", "squid", "calamari", "octopus", "crustacean", "crustaceans", "mollusk", "mollusks", "mollusc", "molluscs", "oyster sauce"],
      not: ["oyster mushroom", "oyster mushrooms", "crab apple", "crab apples"] },
    { id: "treenut", label: "Tree nuts", hint: "almonds, cashews, walnuts, pecans, pistachios",
      words: ["tree nut", "tree nuts", "nut", "nuts", "almond", "almonds", "cashew", "cashews", "walnut", "walnuts", "pecan", "pecans", "hazelnut", "hazelnuts", "filbert", "filberts", "pistachio", "pistachios", "macadamia", "macadamias", "brazil nut", "brazil nuts", "pine nut", "pine nuts", "pignoli", "pinon", "chestnut", "chestnuts", "praline", "pralines", "marzipan", "gianduja", "nut butter", "nut milk"],
      not: ["water chestnut", "water chestnuts", "nutmeg", "butternut", "doughnut", "doughnuts", "coconut", "coconuts", "peanut", "peanuts", "ground nut", "groundnut", "groundnuts"] },
    { id: "peanut", label: "Peanuts", hint: "peanut butter, peanut flour, groundnuts",
      words: ["peanut", "peanuts", "groundnut", "groundnuts", "ground nut", "ground nuts", "arachis", "goober", "goobers"],
      // Highly refined peanut oil is exempt from US allergen labeling too (Kirkland's mixed nuts list it, and peanuts
      // only under "may contain"). Plain "peanut oil" stays a "contains": cold-pressed oil keeps the protein.
      soft: ["highly refined peanut oil", "refined peanut oil"],
      not: [] },
    { id: "wheat", label: "Wheat", hint: "flour, semolina, spelt, bread crumbs",
      words: ["wheat", "flour", "semolina", "durum", "spelt", "farina", "kamut", "khorasan", "einkorn", "emmer", "farro", "triticale", "bulgur", "bulghur", "couscous", "seitan", "gluten", "graham", "bread crumbs", "breadcrumbs", "panko", "soy sauce", "shoyu", "udon", "orzo"],
      not: ["buckwheat", "rice flour", "corn flour", "cornflour", "almond flour", "coconut flour", "chickpea flour", "garbanzo flour", "garbanzo bean flour", "bean flour", "oat flour", "potato flour", "tapioca flour", "soy flour", "cassava flour", "sorghum flour", "buckwheat flour", "millet flour", "quinoa flour", "teff flour", "amaranth flour", "arrowroot flour", "banana flour", "lentil flour", "pea flour", "masa flour", "gluten-free soy sauce", "tamari soy sauce", "tamari",
        // Found on real labels (eval/allergen-eval.mjs): flours that aren't wheat.
        "soya flour", "soybean flour", "gram flour", "black gram flour", "besan", "legume flour", "legume flours", "carob flour", "carob seed flour", "flour of carob", "flour of carob seeds",
        "hemp flour", "flax flour", "flaxseed flour", "nut flour", "hazelnut flour", "peanut flour", "chestnut flour", "sunflower seed flour", "pumpkin seed flour", "sweet potato flour", "plantain flour", "yam flour", "cricket flour"] },
    { id: "soy", label: "Soy", hint: "soybeans, tofu, soy sauce, soy lecithin",
      words: ["soy", "soya", "soybean", "soybeans", "tofu", "edamame", "miso", "tempeh", "tamari", "shoyu", "natto", "textured vegetable protein", "tvp", "soy sauce", "soy lecithin"],
      // Highly refined soybean oil is exempt from US allergen labeling and most people with a soy allergy tolerate it,
      // so it's a "may", not a "contains" (otherwise nearly every packaged food would be flagged).
      soft: ["soybean oil", "soybean oils", "soy oil", "soya oil", "soya bean oil", "oil (soybean)", "oils (soybean)", "oil (soy)",
        // Lecithin with no source named is usually soy (US labels must say "soy lecithin"; imports often don't).
        "lecithin", "lecithins", "e322", "e 322", "ins 322", "emulsifier (322)", "emulsifiers (322)", "emulsifier (322(i))", "emulsifier (e322)"],
      not: ["sunflower lecithin", "sunflower lecithins", "rapeseed lecithin", "rapeseed lecithins", "canola lecithin", "egg lecithin", "lecithin (sunflower)", "lecithins (sunflower)", "lecithin (rapeseed)"] },
    { id: "sesame", label: "Sesame", hint: "sesame seeds and oil, tahini",
      words: ["sesame", "tahini", "tahina", "benne", "gingelly", "halva", "halvah", "gomasio", "gomashio"],
      not: [] },
  ];
  const BY_ID = Object.fromEntries(LIST.map(a => [a.id, a]));
  const IDS = LIST.map(a => a.id);

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A phrase as a whole-word pattern; a space or hyphen inside matches either ("half and half", "half-and-half").
  const phrase = w => esc(w.toLowerCase()).replace(/\\-|\s+/g, "[\\s-]+");
  const wordRe = list => list.length ? new RegExp(`(?<![a-z])(?:${[...list].sort((x, y) => y.length - x.length).map(phrase).join("|")})(?![a-z])`, "gi") : null;
  for (const a of LIST) { a.re = wordRe(a.words); a.softRe = wordRe(a.soft || []); a.notRe = wordRe([...a.not, ...(a.soft || [])]); a.softNotRe = wordRe(a.not); }

  // "May contain", shared-facility and cross-contact statements: their allergens are possible, not ingredients.
  const MAY = /(?:\bmay (?:also )?(?:contain|use|be present)|\bmay have come in contact|\bmade (?:in|on) (?:a |the )?(?:same |shared )?(?:facility|equipment|line|plant|bakery|kitchen)|\b(?:processed|produced|manufactured|packaged|packed|baked) (?:in|on) (?:a |the )?(?:same |shared )?(?:facility|equipment|line|plant|bakery|kitchen)|\bshared (?:equipment|facility|lines?)|\bcross[- ]contact|\btraces? of)[^.;!]*/gi;
  // "Peanut-free", "free of milk", "no eggs", "does not contain soy": the word is named only to rule it out.
  const NEGATED = [
    // One word only, and no lists: "no added sugar, milk" must still flag milk. A missed allergen is worse than an extra flag.
    /(?<![a-z])[a-z]+[\s-]+free(?![a-z])/gi,
    /\b(?:free (?:of|from)|contains no|does not contain|doesn't contain|made without|not made with|without|no)\s+(?:tree\s+)?[a-z]+/gi,
  ];
  // Which allergens a piece of text names, after taking out look-alikes and negated mentions. `soft` holds weaker
  // mentions (refined soybean oil) that only count as "may".
  function scanBoth(text) {
    const hard = new Map(), soft = new Map();
    if (!text) return { hard, soft };
    let s = " " + String(text).toLowerCase().replace(/[’']/g, "'") + " ";
    for (const re of NEGATED) s = s.replace(re, " ");
    // "Vegetable Oil (Canola, Cottonseed, Soybean)": the soybean in an oil's list is refined oil, a "may" like
    // "soybean oil" itself. Found on a real peanut butter label whose own statement named only peanuts.
    s = s.replace(/\b((?:oils?|shortening)\s*\()([^()]*)(\))/g, (m, a, inner, c) => a + inner.replace(/\bsoy(?:a|beans?)?\b(?!\s+oil)/g, "soybean oil") + c);
    const hits =(re, t) => { re.lastIndex = 0; const m = t.match(re); return m ? [...new Set(m.map(x => x.trim().replace(/\s+/g, " ")))].slice(0, 3) : null; };
    for (const a of LIST) {
      const m = hits(a.re, a.notRe ? s.replace(a.notRe, " ") : s);
      if (m) hard.set(a.id, m);
      else if (a.softRe) { const w = hits(a.softRe, a.softNotRe ? s.replace(a.softNotRe, " ") : s); if (w) soft.set(a.id, w); }
    }
    return { hard, soft };
  }
  const scan = text => scanBoth(text).hard;
  // Ingredient text split into what's in it and what only "may" be.
  function fromText(text) {
    const s = String(text || "");
    const main = scanBoth(s.replace(MAY, " ")), later = scanBoth((s.match(MAY) || []).join(". "));
    const may = new Map([...main.soft, ...later.soft, ...later.hard]);
    return { contains: main.hard, may, soft: main.soft };
  }

  // Open Food Facts allergen and traces tags ("en:milk") to our ids. Their gluten tag also covers oats, barley and
  // rye (Oatly is tagged gluten), so on its own it's only a "may" for wheat; the ingredient list decides.
  const OFF_TAGS = { "en:milk": "milk", "en:eggs": "egg", "en:fish": "fish", "en:crustaceans": "shellfish", "en:molluscs": "shellfish",
    "en:nuts": "treenut", "en:peanuts": "peanut", "en:gluten": "wheat", "en:soybeans": "soy", "en:sesame-seeds": "sesame" };
  const offIds = tags => Array.isArray(tags) ? [...new Set(tags.map(t => OFF_TAGS[String(t).toLowerCase()]).filter(Boolean))] : [];

  // Built-in foods: what a typical version contains, by name. "?x" means it often may (shared equipment, or common
  // in some recipes but not all). Built-ins not listed have none of the nine in a typical version.
  // tests/allergens.test.js checks every name here is a built-in food and that names with an allergen word are listed.
  const TYPICAL = {
    // vegetables
    "Edamame": "soy", "Coleslaw": "egg", "Potato salad": "egg", "Mashed potatoes": "milk", "Elote": "milk egg",
    "Kimchi": "fish shellfish", "Sweet potato fries, frozen": "?wheat", "Hash browns, frozen": "", "Tater tots": "",
    // meat
    "Chicken nuggets, frozen": "wheat ?soy ?egg ?milk", "Meatballs, frozen": "wheat milk egg ?soy", "Beef jerky": "soy wheat",
    "Chicken wings": "?milk", "Grilled chicken nuggets": "?milk ?soy", "Hot dog, beef": "?milk ?soy", "Chicken sausage": "?milk",
    "Bologna": "?milk", "Pork breakfast sausage": "", "Turkey burger patty": "",
    // seafood
    "Salmon": "fish", "Tuna, canned in water": "fish", "Tilapia": "fish", "Cod": "fish", "Salmon, canned": "fish", "Sardines, canned": "fish",
    "Fish sticks, frozen": "fish wheat ?milk ?egg ?soy", "Catfish": "fish", "Mahi-mahi": "fish", "Tuna steak": "fish", "Trout": "fish",
    "Smoked salmon": "fish", "Tuna, canned in oil": "fish ?soy", "Shrimp": "shellfish", "Scallops": "shellfish", "Crab meat": "shellfish",
    "Lobster": "shellfish", "Mussels": "shellfish", "Crawfish, boiled": "shellfish", "Imitation crab": "fish wheat egg soy shellfish",
    "Breaded shrimp, frozen": "shellfish wheat egg ?milk ?soy",
    // plant protein
    "Tofu, firm": "soy", "Silken tofu": "soy", "Tempeh": "soy", "Hummus": "sesame", "Veggie burger": "wheat soy egg milk",
    "Plant-based burger": "soy ?wheat", "Seitan": "wheat soy", "Chickpea pasta": "", "Refried beans": "", "Baked beans": "",
    // eggs and dairy
    "Eggs": "egg", "Egg whites": "egg", "Hard-boiled eggs": "egg", "Egg bites, bacon and cheese": "egg milk",
    "Greek yogurt, plain nonfat": "milk", "Yogurt, flavored low-fat": "milk", "Cottage cheese 2%": "milk", "Whole milk": "milk", "Skim milk": "milk",
    "Cheddar cheese": "milk", "2% milk": "milk", "Chocolate milk, low-fat": "milk", "Kefir, plain low-fat": "milk", "Skyr, plain nonfat": "milk",
    "Greek yogurt, plain whole milk": "milk", "Mozzarella, part-skim": "milk", "String cheese": "milk", "Swiss cheese": "milk",
    "Parmesan, grated": "milk", "Cream cheese": "milk", "Sour cream": "milk", "Heavy cream": "milk", "Half and half": "milk",
    "Coffee creamer, flavored": "milk ?soy", "Feta cheese": "milk", "Goat cheese": "milk", "Ricotta, part-skim": "milk", "American cheese": "milk",
    "Pepper jack cheese": "milk", "Brie": "milk", "Shredded Mexican cheese blend": "milk", "Cottage cheese 4%": "milk",
    "Whipped cream, aerosol": "milk", "Frozen yogurt": "milk ?egg", "Greek yogurt, vanilla": "milk", "Ultra-filtered 2% milk": "milk",
    "Almond milk, unsweetened": "treenut", "Oat milk": "?wheat", "Soy milk, unsweetened": "soy",
    // grains
    "Oatmeal, rolled oats": "?wheat", "Pasta": "wheat ?egg", "Whole wheat bread": "wheat soy ?milk", "White bread": "wheat soy ?milk",
    "Whole wheat pasta": "wheat", "Flour tortilla": "wheat", "Bagel, plain": "wheat ?sesame ?egg", "English muffin, whole wheat": "wheat ?milk ?soy",
    "Sourdough bread": "wheat", "Pita, whole wheat": "wheat ?sesame", "Croissant": "wheat milk egg", "Granola": "treenut ?peanut ?wheat ?soy ?milk",
    "Toasted oat cereal, plain": "?wheat", "Frozen waffles": "wheat milk egg soy", "Couscous": "wheat", "Farro": "wheat", "Egg noodles": "wheat egg",
    "Udon noodles": "wheat ?soy", "Soba noodles": "wheat ?soy", "Naan": "wheat milk ?egg", "Hamburger bun": "wheat soy ?sesame ?milk",
    "Hot dog bun": "wheat soy ?milk", "Dinner roll": "wheat milk ?egg ?soy", "Biscuit, refrigerated": "wheat milk soy", "Cornbread": "wheat milk egg",
    "Low-carb tortilla": "wheat ?soy", "Pancakes": "wheat milk egg", "French toast": "wheat milk egg", "Instant oatmeal, flavored": "?wheat ?milk",
    "Cream of wheat": "wheat", "Shredded wheat": "wheat", "Raisin bran": "wheat", "Bran flakes": "wheat", "Toaster pastry": "wheat soy ?milk ?egg",
    "Sprouted grain bread": "wheat soy", "Bulgur": "wheat", "Protein pancake mix": "wheat milk egg", "Overnight oats": "milk ?treenut ?wheat",
    "Frosted cereal": "", "Barley, pearled": "",
    // nuts and seeds
    "Peanut butter": "peanut", "Almonds": "treenut", "Cashews": "treenut", "Walnuts": "treenut", "Peanuts, dry roasted": "peanut",
    "Pistachios": "treenut", "Mixed nuts": "treenut peanut", "Almond butter": "treenut ?peanut", "Trail mix": "peanut treenut milk soy",
    "Powdered peanut butter": "peanut", "Tahini": "sesame", "Sunflower seeds": "?peanut ?treenut",
    // protein products
    "Whey protein powder": "milk soy", "Protein bar": "milk soy ?peanut ?treenut ?wheat", "Protein shake, ready-to-drink": "milk ?soy",
    "Plant protein powder": "?soy ?treenut", "Protein chips": "milk ?soy", "Casein protein powder": "milk ?soy", "Collagen peptides": "?fish",
    // snacks
    "Vanilla ice cream": "milk ?egg", "Granola bar, chewy": "soy ?milk ?wheat ?peanut ?treenut", "Microwave popcorn, butter": "milk",
    "Pretzels": "wheat ?soy", "Saltine crackers": "wheat ?soy", "Whole grain crackers": "wheat", "Dark chocolate, 70%": "soy ?milk ?treenut ?peanut",
    "Milk chocolate bar": "milk soy ?peanut ?treenut", "Chocolate chip cookies": "wheat milk egg soy", "Glazed donut": "wheat milk egg soy",
    "Blueberry muffin": "wheat milk egg ?soy", "Cheese crackers": "wheat milk ?soy", "Graham crackers": "wheat soy ?milk",
    "Sandwich cookies": "wheat soy ?milk", "Brownie": "wheat milk egg ?soy", "Cheesecake": "milk egg wheat", "Apple pie": "wheat ?milk ?egg ?soy",
    "Veggie straws": "?milk", "Seaweed snacks": "?sesame ?soy", "Beef stick": "?soy ?milk", "Fig bars": "wheat ?soy",
    "Peanut butter cups": "peanut milk soy", "Chocolate hazelnut spread": "treenut milk soy", "Hot chocolate, from mix": "milk ?soy",
    "Vanilla milkshake": "milk ?egg", "Rice crispy treat": "milk ?soy", "Cheese puffs": "milk", "Nacho cheese tortilla chips": "milk ?wheat ?soy",
    "Peanut butter sandwich crackers": "peanut wheat milk soy", "Mochi ice cream": "milk ?egg ?soy", "Cinnamon roll, refrigerated": "wheat milk soy ?egg",
    "Tres leches cake": "milk egg wheat", "Bao, BBQ pork": "wheat soy ?sesame ?milk", "Kettle corn": "", "Pork rinds": "",
    // drinks
    "Latte, whole milk": "milk", "Bubble milk tea, regular sugar": "milk", "Bubble milk tea, half sugar": "milk", "Thai iced tea": "milk",
    "Beer": "?wheat", "Light beer": "?wheat", "Fruit smoothie, bottled": "?milk", "Bottled iced coffee drink": "milk", "Pumpkin spice latte": "milk",
    "Iced caramel macchiato": "milk", "Horchata": "?milk ?treenut", "Matcha latte, sweetened": "milk", "Chicken broth": "", "Bone broth": "",
    // prepared foods
    "Instant ramen": "wheat soy ?milk ?egg ?fish ?shellfish", "Frozen pepperoni pizza": "wheat milk soy", "Frozen bean and cheese burrito": "wheat milk ?soy",
    "Frozen chicken and rice bowl": "soy ?wheat ?milk", "Mac and cheese, boxed": "wheat milk", "Chicken noodle soup, canned": "wheat egg ?soy",
    "Tomato soup, canned": "wheat ?milk", "French fries": "?wheat ?milk", "Cheeseburger, fast food": "wheat milk soy sesame ?egg",
    "Cheese pizza, restaurant": "wheat milk ?soy", "California roll": "fish wheat egg sesame soy ?shellfish",
    "Chicken sandwich, fried": "wheat milk egg soy ?peanut", "Grilled chicken sandwich": "wheat soy ?milk ?egg", "Chicken burrito bowl": "milk ?soy",
    "Chicken taco": "?wheat ?milk", "Cheese quesadilla": "wheat milk", "Beef pho": "fish ?soy ?wheat", "Chicken fried rice": "egg soy wheat ?sesame ?shellfish",
    "Orange chicken": "wheat soy egg ?sesame", "Pad thai": "peanut egg fish soy ?shellfish ?wheat", "Chicken tikka masala": "milk ?treenut",
    "Caesar salad": "milk wheat fish egg", "Turkey sub, 6-inch": "wheat soy ?milk ?egg", "Breakfast sandwich, sausage and egg": "wheat milk egg soy",
    "Egg roll": "wheat egg soy ?shellfish ?sesame", "Potstickers, frozen": "wheat soy ?sesame ?shellfish ?egg", "Chicken pot pie, frozen": "wheat milk ?soy ?egg",
    "Lasagna, frozen": "wheat milk ?egg ?soy", "Chili with beans, canned": "?wheat ?soy", "Tuna salad": "fish egg", "Chicken salad, deli": "egg ?treenut",
    "Crunchy beef taco, fast food": "milk ?wheat ?soy", "Pepperoni pizza, restaurant": "wheat milk ?soy", "Minestrone soup, canned": "wheat ?milk",
    "Greek salad": "milk", "Miso soup": "soy ?fish ?wheat", "Breakfast taco, egg and cheese": "egg milk wheat", "Beef fajitas": "wheat ?soy ?milk",
    "Chicken fajita bowl": "?milk ?soy", "Chicken enchiladas, red sauce": "milk ?wheat", "Pork tamales": "?milk", "Brisket sandwich": "wheat ?soy ?milk",
    "Kolache, sausage": "wheat milk egg", "Chicken fried steak with gravy": "wheat milk egg", "Double cheeseburger, fast food": "wheat milk soy sesame ?egg",
    "Banh mi, grilled pork": "wheat egg soy fish ?sesame", "Chicken pho": "fish ?soy ?wheat", "Congee with chicken": "?soy ?sesame ?fish ?egg",
    "Fresh spring rolls": "shellfish peanut ?fish ?soy", "Vermicelli bowl, grilled pork": "fish peanut ?soy ?egg ?shellfish",
    "Poke bowl, ahi tuna": "fish soy wheat sesame", "Chicken Caesar salad kit": "milk wheat egg fish ?soy",
    "Protein snack box, turkey and cheese": "milk ?wheat ?treenut ?peanut", "Lentil soup, canned": "",
    // condiments
    "Butter": "milk", "Alfredo sauce, jarred": "milk ?egg ?wheat", "Mayonnaise": "egg", "Light mayonnaise": "egg ?milk", "Ranch dressing": "milk egg",
    "Greek yogurt ranch dressing": "milk ?egg", "Italian dressing": "?milk ?egg", "BBQ sauce": "?soy ?wheat ?fish", "Soy sauce": "soy wheat",
    "Low-sodium soy sauce": "soy wheat", "Margarine spread": "milk ?soy", "Pesto": "milk treenut", "Teriyaki sauce": "soy wheat ?sesame",
    "Low-sodium teriyaki sauce": "soy wheat ?sesame", "Hoisin sauce": "soy wheat ?sesame", "Caesar dressing": "milk egg fish",
    "Thousand Island dressing": "egg", "Tzatziki": "milk", "Peanut sauce": "peanut soy wheat ?fish", "Brown gravy": "wheat ?milk ?soy",
    "Ghee": "milk", "Peanut oil": "peanut", "Sesame oil": "sesame", "Cooking spray": "soy", "Cocoa powder, unsweetened": "?milk",
    "Miso paste": "soy ?wheat", "Queso dip": "milk", "Buffalo sauce": "?milk", "Fish sauce": "fish ?shellfish", "Marinara sauce": "?milk",
    "Vegetable oil (soybean)": "?soy", "Coconut milk, canned": "", "Coconut oil": "", "Butternut squash": "",
  };
  const parseTypical = s => { const c = [], m = []; for (const t of String(s || "").split(/\s+/).filter(Boolean)) (t[0] === "?" ? m : c).push(t.replace(/^\?/, "")); return { contains: c, may: m }; };

  // The viewer's allergens: known ids, plus anything typed under "Other" ("coconut, mustard").
  function chosen(p) {
    const ids = Array.isArray(p && p.allergies) ? p.allergies.filter(id => BY_ID[id]) : [];
    const other = String((p && p.allergyOther) || "").split(",").map(s => s.trim().toLowerCase()).filter(s => s.length >= 2 && s.length <= 40).slice(0, 12);
    return { ids, other };
  }
  const hasAny = p => { const c = chosen(p); return c.ids.length > 0 || c.other.length > 0; };

  // Everything known about one food. `src` says what was checked: "label" (an ingredient list or allergen tags),
  // "typical" (a built-in food's usual recipe), "name" (only the name), or "plate".
  function detect(f) {
    /** @type {Map<string, string[]>} */ const contains = new Map(), may = new Map();
    const add = (map, id, why) => { if (!map.has(id)) map.set(id, []); const w = map.get(id); if (why && !w.includes(why) && w.length < 4) w.push(why); };
    let src = "name";
    const name = [f.n, ...(Array.isArray(f.a) ? f.a : [])].join(", ");
    if (!f.src && Object.prototype.hasOwnProperty.call(TYPICAL, f.n)) {
      src = "typical";
      const t = parseTypical(TYPICAL[f.n]);
      t.contains.forEach(id => add(contains, id, "usually in it"));
      t.may.forEach(id => add(may, id, "common in some versions"));
    } else if (!f.src) src = "typical";
    const offC = offIds(f.allergens), offM = offIds(f.traces);
    if (offC.length || offM.length) src = "label";
    const glutenOnly = (f.allergens || []).includes("en:gluten") && !(f.allergens || []).some(t => /^en:wheat/.test(String(t)));
    offC.forEach(id => id === "wheat" && glutenOnly ? add(may, id, "gluten (Open Food Facts; could be wheat, barley, rye or oats)") : add(contains, id, "Open Food Facts allergen list"));
    offM.forEach(id => add(may, id, "Open Food Facts traces list"));
    if (f.ingredients) {
      src = "label";
      const r = fromText(f.ingredients);
      for (const [id, w] of r.contains) w.forEach(x => add(contains, id, `“${x}” in the ingredients`));
      for (const [id, w] of r.may) w.forEach(x => add(may, id, r.soft.has(id) ? `${x} (highly refined oil is usually tolerated; ask your allergist)` : "“may contain” or shared-facility note"));
    }
    // The name counts for everything: "Peanut butter pretzels" contains peanuts whatever else is on file.
    const nm = scanBoth(name);
    for (const [id, w] of nm.hard) w.forEach(x => add(contains, id, `“${x}” in the name`));
    for (const [id, w] of nm.soft) w.forEach(x => add(may, id, `${x} in the name (highly refined oil is usually tolerated)`));
    for (const id of contains.keys()) may.delete(id);
    return { contains, may, src };
  }

  // Free-text allergens ("coconut") against the name and the ingredient list, whole words with simple plurals.
  function otherHits(f, terms) {
    const out = { contains: [], may: [] };
    if (!terms.length) return out;
    const text = String(f.ingredients || "");
    const main = text.replace(MAY, " "), mayText = (text.match(MAY) || []).join(" ");
    const name = [f.n, ...(Array.isArray(f.a) ? f.a : [])].join(", ");
    for (const t of terms) {
      const re = new RegExp(`(?<![a-z])${phrase(t)}(?:e?s)?(?![a-z])`, "i");
      const clean = s => NEGATED.reduce((x, n) => x.replace(n, " "), " " + s.toLowerCase() + " ");
      if (re.test(clean(name)) || re.test(clean(main))) out.contains.push(t);
      else if (re.test(clean(mayText))) out.may.push(t);
    }
    return out;
  }

  const labelOf = id => BY_ID[id] ? BY_ID[id].label : id;
  const lower = id => BY_ID[id] ? (id === "treenut" ? "tree nuts" : BY_ID[id].label.toLowerCase()) : id;
  const join = list => list.length < 2 ? (list[0] || "") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];

  // The answer for this viewer, or null when they haven't set any allergens.
  // { status, contains: [{id, name, why}], may: [...], src, title, text, short }
  function check(f, p) {
    if (!f || !hasAny(p)) return null;
    const c = chosen(p);
    if (f.c === "plate" && Array.isArray(f.items)) return checkPlate(f, p);
    const d = detect(f);
    const o = otherHits(f, c.other);
    const contains = [...c.ids.filter(id => d.contains.has(id)).map(id => ({ id, name: lower(id), why: d.contains.get(id) })),
      ...o.contains.map(t => ({ id: "other:" + t, name: t, why: [`“${t}” in the ${f.ingredients ? "name or ingredients" : "name"}`] }))];
    const may = [...c.ids.filter(id => !d.contains.has(id) && d.may.has(id)).map(id => ({ id, name: lower(id), why: d.may.get(id) })),
      ...o.may.map(t => ({ id: "other:" + t, name: t, why: ["“may contain” or shared-facility note"] }))];
    const status = contains.length ? "contains" : may.length ? "may" : d.src === "name" ? "unknown" : "clear";
    return { status, contains, may, src: d.src, ...words(status, contains, may, d.src, f) };
  }

  // A plate: the worst answer among its items, naming which item has what.
  function checkPlate(f, p) {
    const parts = f.items.map(it => ({ it, r: check(it.food || it, p) })).filter(x => x.r);
    const contains = [], may = [];
    for (const { it, r } of parts) {
      const n = (it.food || it).n;
      for (const x of r.contains) { const prev = contains.find(y => y.id === x.id); if (prev) prev.why.push(n); else contains.push({ id: x.id, name: x.name, why: [n] }); }
      for (const x of r.may) { if (contains.some(y => y.id === x.id)) continue; const prev = may.find(y => y.id === x.id); if (prev) prev.why.push(n); else may.push({ id: x.id, name: x.name, why: [n] }); }
    }
    const unknown = parts.some(x => x.r.status === "unknown");
    const status = contains.length ? "contains" : may.length ? "may" : unknown ? "unknown" : "clear";
    return { status, contains, may, src: "plate", ...words(status, contains, may, "plate", f) };
  }

  // What the card says. Never "safe": the best it says is that nothing was found in what was checked.
  function words(status, contains, may, src, f) {
    const names = l => join(l.map(x => x.name));
    const what = src === "label" ? "the ingredient list" : src === "typical" ? (f.c === "prepared" ? "a typical recipe" : "a typical version") : src === "plate" ? "the items on this plate" : "the name";
    if (status === "contains") return { title: `Contains ${names(contains)}`, short: contains.length > 1 ? "Allergens" : `Has ${contains[0].name}`,
      text: `${src === "plate" ? "On this plate" : src === "typical" ? `In ${what}` : "From " + what}: ${contains.map(x => `${x.name} (${x.why.join("; ")})`).join(", ")}.${may.length ? ` May also contain ${names(may)}.` : ""}` };
    if (status === "may") return { title: `May contain ${names(may)}`, short: "May contain",
      text: src === "typical" ? `Not usually in it, but common in some versions or made on shared equipment. Check the label.` : src === "plate" ? `${may.map(x => `${x.name} (${x.why.join(", ")})`).join(", ")}. Check each label.` : `The label says it may contain ${names(may)} (shared equipment or facility).` };
    if (status === "unknown") return { title: "Couldn't check your allergens", short: "Not checked",
      text: "There's no ingredient list for this food, so allergens can't be checked. Read the package." };
    return { title: `None of your allergens found`, short: "",
      text: src === "label" ? "Not found in the ingredient list or allergen statements. Lists can be incomplete or out of date: read the package." : src === "plate" ? "None found in the items on this plate. Check each label." : `Not in ${what}. Brands and recipes vary: read the label.` };
  }

  return { LIST, IDS, BY_ID, TYPICAL, scan, fromText, detect, check, chosen, hasAny, offIds, labelOf };
});
