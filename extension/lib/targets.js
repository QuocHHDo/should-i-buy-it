// Suggested daily targets from age, sex, height, weight, activity and goal. Pure (no DOM); js/app.js shows them on
// the Goals page and fills the target boxes only when the person taps "Use these". The answers aren't saved.
//
// Calories: resting energy by the Mifflin-St Jeor equation (Mifflin et al., Am J Clin Nutr 1990; 51:241-7), times an
// activity factor. Protein: the RDA, 0.8 g per kg (Institute of Medicine, Dietary Reference Intakes 2005), raised to
// 1.2-1.6 g per kg when losing weight or building muscle (ISSN position stand on protein and exercise, Jäger et al.
// 2017). Fiber 14 g per 1,000 calories; saturated fat and added sugar each under 10% of calories; sodium under
// 2,300 mg (Dietary Guidelines for Americans 2020-2025).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckTargets = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  const ACTIVITY = {
    sitting: { factor: 1.2, label: "Mostly sitting" },
    light: { factor: 1.375, label: "Lightly active" },
    active: { factor: 1.55, label: "Active" },
    very: { factor: 1.725, label: "Very active" },
  };
  const GOAL = {
    lose: { label: "Lose a little", kcal: -500, proteinPerKg: 1.2 },
    keep: { label: "Stay the same", kcal: 0, proteinPerKg: 0.8 },
    gain: { label: "Build muscle", kcal: 250, proteinPerKg: 1.6 },
  };
  // A weight-loss target never goes below these (a common clinical floor without supervision).
  const FLOOR = { female: 1200, male: 1500, other: 1350 };
  // The Goals page's own limits on each box, so a suggestion is always a value it accepts.
  const BOUNDS = { cal: [800, 6000], pro: [20, 400], fib: [10, 70], sat: [5, 40], na: [500, 5000], add: [0, 100] };
  const clamp = (k, v) => Math.min(BOUNDS[k][1], Math.max(BOUNDS[k][0], v));
  const roundTo = (v, step) => Math.round(v / step) * step;

  // Mifflin-St Jeor: 10 × kg + 6.25 × cm − 5 × age, + 5 for men, − 161 for women (the midpoint, − 78, otherwise).
  const resting = ({ sex, age, heightCm, weightKg }) => 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : sex === "female" ? -161 : -78);

  /**
   * @param {{ age: number, sex: "female" | "male" | "other", heightCm: number, weightKg: number, activity: string, goal: string, pregnant?: boolean }} a
   * @returns {{ ok: true, targets: { cal: number, pro: number, fib: number, sat: number, na: number, add: number }, maintenance: number, floored: boolean } | { ok: false, why: string }}
   */
  function suggest(a) {
    const age = Number(a.age), heightCm = Number(a.heightCm), weightKg = Number(a.weightKg);
    if (a.pregnant) return { ok: false, why: "Needs change during pregnancy and breastfeeding, so these numbers don't apply. Ask your doctor or a dietitian for your targets." };
    if (!(age >= 18)) return { ok: false, why: "These formulas are for adults. For anyone under 18, ask a doctor or dietitian." };
    if (!(age <= 100) || !(heightCm >= 120 && heightCm <= 230) || !(weightKg >= 35 && weightKg <= 300)) return { ok: false, why: "Check your age, height and weight." };
    const act = ACTIVITY[a.activity] || ACTIVITY.light, goal = GOAL[a.goal] || GOAL.keep;
    const maintenance = resting({ sex: a.sex, age, heightCm, weightKg }) * act.factor;
    const floor = FLOOR[a.sex] || FLOOR.other;
    let cal = maintenance + goal.kcal;
    const floored = goal.kcal < 0 && cal < floor;
    if (floored) cal = Math.min(maintenance, floor);
    cal = clamp("cal", roundTo(cal, 50));
    // Very active people need a little more protein even to stay the same.
    const perKg = goal === GOAL.keep && act.factor >= ACTIVITY.active.factor ? 1.0 : goal.proteinPerKg;
    return { ok: true, maintenance: Math.round(maintenance), floored, targets: {
      cal,
      pro: clamp("pro", roundTo(weightKg * perKg, 5)),
      fib: clamp("fib", Math.round(cal / 1000 * 14)),
      sat: clamp("sat", Math.floor(cal * 0.10 / 9)),
      na: 2300,
      add: clamp("add", Math.floor(cal * 0.10 / 4)),
    } };
  }

  // US units to metric: feet + inches, pounds.
  const cmFromFtIn = (ft, inch) => (Number(ft) * 12 + Number(inch || 0)) * 2.54;
  const kgFromLb = lb => Number(lb) * 0.45359237;

  return { suggest, resting, cmFromFtIn, kgFromLb, ACTIVITY, GOAL, FLOOR, BOUNDS };
});
