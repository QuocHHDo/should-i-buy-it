// js/targets.js: suggested daily targets.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/targets.js");

test("Mifflin-St Jeor matches the published equation", () => {
  // 30-year-old man, 180 cm, 80 kg: 800 + 1125 − 150 + 5 = 1780 kcal at rest
  assert.equal(T.resting({ sex: "male", age: 30, heightCm: 180, weightKg: 80 }), 1780);
  // 30-year-old woman, 165 cm, 60 kg: 600 + 1031.25 − 150 − 161 = 1320.25
  assert.equal(T.resting({ sex: "female", age: 30, heightCm: 165, weightKg: 60 }), 1320.25);
});

test("a typical adult: calories, protein, fiber and the limits follow the guidelines", () => {
  const r = T.suggest({ age: 32, sex: "male", heightCm: T.cmFromFtIn(5, 10), weightKg: T.kgFromLb(170), activity: "light", goal: "keep" });
  assert.ok(r.ok);
  // rest = 771.1 + 1111.25 − 160 + 5 = 1727.4; × 1.375 = 2375 → 2400 (rounded to 50)
  assert.equal(r.maintenance, 2375);
  assert.deepEqual(r.targets, { cal: 2400, pro: 60, fib: 34, sat: 26, na: 2300, add: 60 });
});

test("goals change calories and protein; very active people get a bit more protein to stay the same", () => {
  const base = { age: 40, sex: "female", heightCm: 165, weightKg: 70, activity: "active" };
  const keep = T.suggest({ ...base, goal: "keep" }), lose = T.suggest({ ...base, goal: "lose" }), gain = T.suggest({ ...base, goal: "gain" });
  assert.equal(keep.targets.cal - lose.targets.cal, 500);
  assert.equal(gain.targets.cal - keep.targets.cal, 250);
  assert.equal(keep.targets.pro, 70); // 1.0 g/kg when active
  assert.equal(lose.targets.pro, 85); // 1.2 g/kg
  assert.equal(gain.targets.pro, 110); // 1.6 g/kg
});

test("losing weight never goes below a safe floor, nor above staying the same", () => {
  // A small, inactive person who already needs under 1,200: no cut at all (stays at about 1,050).
  const r = T.suggest({ age: 70, sex: "female", heightCm: 150, weightKg: 45, activity: "sitting", goal: "lose" });
  assert.ok(r.ok && r.floored);
  assert.equal(r.maintenance, 1052);
  assert.equal(r.targets.cal, 1050);
  // Someone whose cut would land under the floor stops at the floor.
  const s = T.suggest({ age: 50, sex: "female", heightCm: 160, weightKg: 60, activity: "sitting", goal: "lose" });
  assert.ok(s.floored && s.targets.cal === 1200 && s.maintenance > 1200);
});

test("no numbers for people the formulas don't fit", () => {
  assert.equal(T.suggest({ age: 16, sex: "male", heightCm: 170, weightKg: 60, activity: "light", goal: "keep" }).ok, false);
  assert.match(T.suggest({ age: 30, sex: "female", heightCm: 165, weightKg: 60, activity: "light", goal: "keep", pregnant: true }).why, /pregnancy/);
  assert.equal(T.suggest({ age: 30, sex: "male", heightCm: 0, weightKg: 70, activity: "light", goal: "keep" }).ok, false);
});

test("every suggestion is a value the Goals page accepts", () => {
  for (const sex of ["female", "male", "other"]) for (const activity of Object.keys(T.ACTIVITY)) for (const goal of Object.keys(T.GOAL))
    for (const [age, cm, kg] of [[18, 150, 40], [45, 175, 90], [90, 200, 250]]) {
      const r = T.suggest({ age, sex, heightCm: cm, weightKg: kg, activity, goal });
      assert.ok(r.ok);
      for (const [k, [lo, hi]] of Object.entries(T.BOUNDS)) assert.ok(r.targets[k] >= lo && r.targets[k] <= hi, `${k} ${r.targets[k]}`);
    }
});
