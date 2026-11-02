import type { Extraction, TestCase } from "../src/schema.ts";

export const truth: Extraction = {
  servingSize: "2/3 cup (55g)",
  servingsPerContainer: 8,
  calories: 230,
  totalFat_g: 8,
  satFat_g: 1,
  sodium_mg: 160,
  totalCarbs_g: 37,
  fiber_g: 4,
  sugars_g: 12,
  addedSugars_g: null,
  protein_g: 3,
};

export const sampleCase: TestCase = {
  id: "fixture-01",
  category: "missing",
  description: "fixture",
  labelText: "Nutrition Facts\n8 servings per container\nServing size 2/3 cup (55g)\nCalories 230\nTotal Fat 8g\nSaturated Fat 1g\nSodium 160mg\nTotal Carbohydrate 37g\nDietary Fiber 4g\nTotal Sugars 12g\nProtein 3g",
  expected: truth,
};
