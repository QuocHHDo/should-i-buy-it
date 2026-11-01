// Plain-language notes for additives: what each kind does, and for the common ones, what the evidence says.
// Status levels (never a health score):
//   safe    — regulators find no concern at normal amounts
//   mixed   — approved, but credible studies or reviews raise questions worth knowing
//   removed — a regulator has taken it out of food (these also keep a product from "Get it"; see additives.js)
// Every "mixed" note links the source it's based on. Additives not listed here show what they do and that they
// haven't been reviewed individually.
(function (root, data) {
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.SelfCheckAdditiveNotes = data;
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), (function () {
  const SRC = {
    aspartame: "https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released",
    nss: "https://www.who.int/news/item/15-05-2023-who-advises-not-to-use-non-sugar-sweeteners-for-weight-control-in-newly-released-guideline",
    erythritol: "https://www.nih.gov/news-events/nih-research-matters/erythritol-cardiovascular-events",
    cmc: "https://pure.psu.edu/en/publications/randomized-controlled-feeding-study-of-dietary-emulsifier-carboxy/",
    emulsifiersMice: "https://www.sciencedaily.com/releases/2015/02/150225132105.htm",
    carrageenan: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7009739",
    caramel: "https://www.fda.gov/food/food-additives-petitions/questions-answers-caramel-coloring-and-4-mei",
    bha: "https://ntp.niehs.nih.gov/ntp/roc/content/profiles/butylatedhydroxyanisole.pdf",
    benzene: "https://www.fda.gov/food/process-contaminants-food/questions-and-answers-occurrence-benzene-soft-drinks-and-other-beverages",
    msg: "https://www.fda.gov/food/food-additives-petitions/questions-and-answers-monosodium-glutamate-msg",
    dyes: "https://www.hhs.gov/press-room/hhs-fda-food-dyes-food.html",
    euColours: "https://www.telford.gov.uk/health-protection/food-health-and-safety/food/colours-in-food-food-and-drink-warnings",
    phosphates: "https://www.foodingredientsfirst.com/news/EFSA-issues-new-EU-phosphates-limits-advice-warns-that-safe-levels-may-be-being-exceeded.html",
  };

  // What each function means, in one sentence.
  const FUNCTION = {
    "emulsifier": "Keeps oil and water mixed so the texture stays smooth.",
    "stabilizer": "Keeps the texture even and stops ingredients from separating.",
    "thickener": "Thickens liquids, like a sauce thickened with starch.",
    "gelling agent": "Sets liquids into a gel, as in jams and gummies.",
    "preservative": "Slows the growth of mold and bacteria so food lasts longer.",
    "antioxidant": "Slows fats and colors from going stale or brown when exposed to air.",
    "color": "Adds or restores color.",
    "sweetener": "Sweetens with few or no calories.",
    "flavor enhancer": "Brings out savory or existing flavors.",
    "acid": "Adds tartness.",
    "acidity regulator": "Controls how acidic the food is, for taste and shelf life.",
    "raising agent": "Releases gas so baked goods rise.",
    "humectant": "Keeps food moist.",
    "anti-caking agent": "Stops powders from clumping.",
    "firming agent": "Keeps fruit and vegetables firm.",
    "glazing agent": "Gives a shiny coating.",
    "bulking agent": "Adds volume without many calories.",
    "sequestrant": "Binds metals that would otherwise spoil color or flavor.",
    "flour treatment agent": "Improves dough strength or color in baking.",
    "foaming agent": "Helps foam form and hold.",
    "anti-foaming agent": "Stops foam forming during cooking or processing.",
    "carrier": "Carries another additive, such as a flavor or vitamin.",
    "emulsifying salts": "Keeps melted cheese smooth.",
    "modified starch": "Starch adjusted to thicken or stabilize under heat or freezing.",
    "propellent gas": "Pushes food out of a can, like whipped cream.",
    "packaging gas": "Fills the package so food stays fresh longer.",
    "carbonating agent": "Adds fizz.",
    "color retention agent": "Keeps the natural color from fading.",
    "fat": "A fat used for texture and shelf life.",
  };

  // code → { what, status, note?, src? }  (what: what it is, made from; note: the evidence in a sentence or two)
  const SWEETENER_NOTE = "WHO (2023) advises against using non-sugar sweeteners for weight control: long-term studies found no lasting weight benefit and possible links to diabetes and heart disease, though those links may be confounded. It's a conditional recommendation that doesn't apply to people who already have diabetes.";
  const PHOSPHATE = { status: "mixed", note: "EFSA (2019) set a safe daily limit that children on typical diets may exceed, and said the limit doesn't apply to people with reduced kidney function, who should limit phosphate.", src: SRC.phosphates };
  const SYNTHETIC_DYE = eu => ({ status: "mixed", note: `${eu ? "In the EU, foods with this color must carry the warning that it “may have effects on activity and attention in children.” " : ""}The FDA announced in April 2025 that it's working with food makers to phase out petroleum-based dyes like this one by the end of 2026.`, src: eu ? SRC.euColours : SRC.dyes });
  const NOTES = {
    // Considered safe
    e330: { what: "Citric acid, the acid in citrus fruit.", role: "Adds tartness and helps keep color and flavor fresh.", status: "safe" },
    e300: { what: "Vitamin C.", role: "Keeps color and flavor fresh; also adds vitamin C.", status: "safe" },
    e301: { what: "A form of vitamin C.", role: "Keeps color and flavor fresh, especially in cured meat.", status: "safe" },
    e306: { what: "Vitamin E (tocopherols).", role: "Keeps fats from going rancid.", status: "safe" }, e307: { what: "Vitamin E.", status: "safe" }, e308: { what: "Vitamin E.", status: "safe" }, e309: { what: "Vitamin E.", status: "safe" },
    e322: { what: "Lecithin, usually from soy or sunflower.", role: "Keeps oil and water mixed, as in chocolate and spreads.", status: "safe" },
    e440: { what: "Pectin, the fiber that sets jam, from fruit peel.", role: "Sets jams and jellies.", status: "safe" },
    e415: { what: "Xanthan gum, made by fermenting sugar.", role: "Thickens sauces and dressings and keeps them from separating.", status: "safe" },
    e412: { what: "Guar gum, a fiber from guar beans.", role: "Thickens and keeps textures smooth, as in ice cream.", status: "safe" },
    e410: { what: "Locust bean gum, from carob seeds.", role: "Thickens and stabilizes, as in ice cream and cream cheese.", status: "safe" },
    e418: { what: "Gellan gum, made by fermentation.", status: "safe" },
    e406: { what: "Agar, from seaweed.", status: "safe" },
    e500: { what: "Baking soda and related salts.", role: "Makes baked goods rise.", status: "safe" },
    e170: { what: "Calcium carbonate (chalk), also adds calcium.", role: "Firms tofu, prevents caking, and adds calcium.", status: "safe" },
    e509: { what: "Calcium chloride, a salt that keeps vegetables firm.", status: "safe" },
    e331: { what: "Sodium citrate, a salt of citric acid.", role: "Controls acidity and keeps melted cheese smooth.", status: "safe" },
    e332: { what: "Potassium citrate, a salt of citric acid.", role: "Controls acidity.", status: "safe" },
    e270: { what: "Lactic acid, the acid in yogurt.", role: "Adds tartness and controls acidity.", status: "safe" },
    e260: { what: "Acetic acid, the acid in vinegar.", role: "Adds tartness and helps preserve.", status: "safe" },
    e296: { what: "Malic acid, the acid in apples.", role: "Adds tartness, as in sour candy.", status: "safe" },
    e200: { what: "Sorbic acid, a common mold inhibitor.", status: "safe" },
    e202: { what: "Potassium sorbate, a common mold inhibitor.", status: "safe" },
    e282: { what: "Calcium propionate, which keeps bread from molding.", status: "safe" },
    e471: { what: "Mono- and diglycerides, made from vegetable oil: the same fats your body forms when digesting oil.", role: "Keeps oil and water mixed and keeps bread soft.", status: "safe" },
    e160a: { what: "Beta-carotene, the orange color in carrots.", status: "safe" },
    e160b: { what: "Annatto, a color from achiote seeds.", status: "safe" },
    e160c: { what: "Paprika extract.", status: "safe" },
    e162: { what: "Beet red, from beets.", status: "safe" },
    e100: { what: "Curcumin, the yellow in turmeric.", status: "safe" },
    e150a: { what: "Plain caramel color, made by heating sugar.", status: "safe" },
    e290: { what: "Carbon dioxide, the gas in fizzy drinks.", status: "safe" },
    e551: { what: "Silicon dioxide (silica), a mineral.", role: "Stops powders like spice mixes from clumping.", status: "safe" },
    e460: { what: "Cellulose, plant fiber (often from wood pulp).", role: "Stops shredded cheese and spices from clumping; also adds fiber.", status: "safe" },
    e941: { what: "Nitrogen gas.", status: "safe" },
    e420: { what: "Sorbitol, a sugar alcohol.", status: "safe", note: "Large amounts can cause bloating or a laxative effect." },
    e965: { what: "Maltitol, a sugar alcohol.", status: "safe", note: "Large amounts can cause bloating or a laxative effect." },
    e967: { what: "Xylitol, a sugar alcohol.", status: "safe", note: "Large amounts can cause bloating or a laxative effect. Toxic to dogs." },
    e621: { what: "Monosodium glutamate (MSG), the savory taste in tomatoes and parmesan.", status: "safe", note: "The FDA considers MSG safe. Some people report mild, short-lived symptoms after 3 g or more without food; a typical serving has well under half a gram.", src: SRC.msg },
    e627: { what: "Disodium guanylate, a savory flavor booster used with MSG.", status: "safe" },
    e631: { what: "Disodium inosinate, a savory flavor booster used with MSG.", status: "safe" },
    e385: { what: "Calcium disodium EDTA, which binds traces of metal.", role: "Keeps flavor and color from going stale, mainly in dressings, mayonnaise, sauces and canned foods.", status: "safe", note: "The FDA allows it in specific foods with set maximums (for example 75 ppm in mayonnaise and dressings).", src: "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-172/subpart-B/section-172.120" },
    e211: { what: "Sodium benzoate, a preservative in acidic foods and drinks.", role: "Prevents mold in acidic foods like soda and pickles.", status: "safe", note: "With vitamin C it can form traces of benzene; the FDA found almost all drinks had none or under 5 ppb and says the levels aren't a safety concern.", src: SRC.benzene },
    e212: { what: "Potassium benzoate, a preservative in acidic foods and drinks.", role: "Prevents mold in acidic foods and drinks.", status: "safe", note: "With vitamin C it can form traces of benzene; the FDA says the levels found aren't a safety concern.", src: SRC.benzene },
    // Mixed evidence
    e951: { what: "Aspartame, a sweetener about 200 times sweeter than sugar.", status: "mixed", note: "The WHO's cancer agency classed it as “possibly carcinogenic” (limited evidence) in 2023. The WHO/FAO expert committee kept the safe limit of 40 mg per kg a day, about 9–14 cans of diet soda for a 70 kg adult. " + SWEETENER_NOTE, src: SRC.aspartame },
    e955: { what: "Sucralose, a sweetener made from sugar.", status: "mixed", note: SWEETENER_NOTE, src: SRC.nss },
    e950: { what: "Acesulfame potassium (Ace-K), a sweetener.", status: "mixed", note: SWEETENER_NOTE, src: SRC.nss },
    e954: { what: "Saccharin, a sweetener.", status: "mixed", note: SWEETENER_NOTE, src: SRC.nss },
    e961: { what: "Neotame, a sweetener.", status: "mixed", note: SWEETENER_NOTE, src: SRC.nss },
    e969: { what: "Advantame, a sweetener.", status: "mixed", note: SWEETENER_NOTE, src: SRC.nss },
    e960: { what: "Stevia (steviol glycosides), a plant-based sweetener.", status: "mixed", note: SWEETENER_NOTE, src: SRC.nss },
    e968: { what: "Erythritol, a sugar alcohol used as a zero-calorie sweetener.", status: "mixed", note: "A 2023 study linked higher blood erythritol to about twice the rate of heart attack and stroke over three years, and found it made platelets clot more easily. The link isn't proven to be cause and effect.", src: SRC.erythritol },
    e466: { what: "Carboxymethylcellulose (CMC, cellulose gum), a thickener.", role: "Thickens and keeps textures smooth, as in ice cream and sauces.", status: "mixed", note: "In a small 2022 human trial (16 people, 11 days), CMC reduced gut-bacteria diversity and caused mild stomach discomfort. Mouse studies link it to gut inflammation.", src: SRC.cmc },
    e433: { what: "Polysorbate 80, an emulsifier.", role: "Keeps oil and water mixed, as in ice cream.", status: "mixed", note: "In a 2015 mouse study, it changed gut bacteria and led to low-grade gut inflammation and weight gain. Human evidence is limited.", src: SRC.emulsifiersMice },
    e407: { what: "Carrageenan, a thickener from red seaweed.", role: "Thickens and gels dairy and plant milks.", status: "mixed", note: "EFSA (2018) kept it approved but made its safe limit temporary until better data exist, noting that the small-molecule fraction is linked to possible harm and that heavy users could exceed the limit.", src: SRC.carrageenan },
    e150c: { what: "Ammonia caramel color (Class III).", status: "mixed", note: "Its manufacture forms 4-MEI, a byproduct the FDA is still reviewing; the FDA sees no reason to expect short-term risks at food levels.", src: SRC.caramel },
    e150d: { what: "Sulfite ammonia caramel color (Class IV), common in colas.", status: "mixed", note: "Its manufacture forms 4-MEI, a byproduct the FDA is still reviewing; the FDA sees no reason to expect short-term risks at food levels.", src: SRC.caramel },
    e320: { what: "BHA (butylated hydroxyanisole), a preservative for fats.", status: "mixed", note: "The U.S. National Toxicology Program lists BHA as “reasonably anticipated to be a human carcinogen,” based on tumors in animal studies.", src: SRC.bha },
    e129: { what: "Allura Red (Red 40), a synthetic dye.", ...SYNTHETIC_DYE(true) },
    e102: { what: "Tartrazine (Yellow 5), a synthetic dye.", ...SYNTHETIC_DYE(true) },
    e110: { what: "Sunset Yellow (Yellow 6), a synthetic dye.", ...SYNTHETIC_DYE(true) },
    e133: { what: "Brilliant Blue (Blue 1), a synthetic dye.", ...SYNTHETIC_DYE(false) },
    e132: { what: "Indigotine (Blue 2), a synthetic dye.", ...SYNTHETIC_DYE(false) },
    e143: { what: "Fast Green (Green 3), a synthetic dye.", ...SYNTHETIC_DYE(false) },
    e338: { what: "Phosphoric acid.", role: "Adds tartness to colas.", ...PHOSPHATE },
    e339: { what: "Sodium phosphates.", role: "Keeps processed cheese smooth and meat moist.", ...PHOSPHATE }, e340: { what: "Potassium phosphates.", role: "Controls acidity and adds potassium.", ...PHOSPHATE }, e341: { what: "Calcium phosphates.", role: "Helps baked goods rise and prevents caking.", ...PHOSPHATE },
    e450: { what: "Diphosphates, used in baking powder and processed meat.", role: "Helps baked goods rise and keeps meat moist.", ...PHOSPHATE }, e451: { what: "Triphosphates.", role: "Keeps meat and seafood moist.", ...PHOSPHATE }, e452: { what: "Polyphosphates.", role: "Keeps meat and seafood moist.", ...PHOSPHATE },
    // Nitrites and nitrates: the reason comes from the flag in additives.js.
    e249: { what: "Potassium nitrite.", status: "mixed" }, e250: { what: "Sodium nitrite.", status: "mixed" },
    e251: { what: "Sodium nitrate.", status: "mixed" }, e252: { what: "Potassium nitrate.", status: "mixed" },
    // Removed (reason and source come from the flag in additives.js)
    e171: { what: "Titanium dioxide, a white pigment.", status: "removed" },
    e127: { what: "Erythrosine (Red 3), a synthetic dye.", status: "removed" },
    e443: { what: "Brominated vegetable oil, used to keep citrus flavor mixed in drinks.", status: "removed" },
  };
  const STATUS = {
    safe: { label: "Considered safe", hint: "Regulators find no concern at normal amounts." },
    mixed: { label: "Mixed evidence", hint: "Approved, but studies or reviews raise questions." },
    removed: { label: "Removed by regulators", hint: "Taken out of food in the US or EU." },
    unreviewed: { label: "Not reviewed here", hint: "Approved for food in the EU; not individually reviewed by this app." },
  };
  return { FUNCTION, NOTES, STATUS, SRC };
})());
