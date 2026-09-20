import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMob,
  selectBestFood,
  selectBestByTier,
  evaluateOreYFitness,
  isNightTime,
} from "../src/mobKnowledge.js";

test("classifyMobは既知のMobを正しく分類する", () => {
  assert.equal(classifyMob("zombie"), "melee_ok");
  assert.equal(classifyMob("creeper"), "avoid_melee");
  assert.equal(classifyMob("skeleton"), "ranged_threat");
  assert.equal(classifyMob("enderman"), "neutral_ignore");
});

test("classifyMobは未知のMobをmelee_okとして扱う", () => {
  assert.equal(classifyMob("unknown_mob"), "melee_ok");
});

test("selectBestFoodは調理済み食料を優先する", () => {
  const items = [{ name: "apple" }, { name: "cooked_beef" }, { name: "bread" }];
  const food = selectBestFood(items);
  assert.ok(["cooked_beef", "bread"].includes(food.name));
});

test("selectBestFoodは調理済みが無ければ生食料を返す", () => {
  const items = [{ name: "beef" }];
  assert.equal(selectBestFood(items).name, "beef");
});

test("selectBestFoodは食料が無ければnullを返す", () => {
  assert.equal(selectBestFood([]), null);
});

test("selectBestByTierは最高tierの道具を選ぶ", () => {
  const items = [{ name: "wooden_sword" }, { name: "diamond_sword" }, { name: "stone_sword" }];
  assert.equal(selectBestByTier(items, "_sword").name, "diamond_sword");
});

test("selectBestByTierは該当なしでnullを返す", () => {
  assert.equal(selectBestByTier([{ name: "bread" }], "_sword"), null);
});

test("evaluateOreYFitnessは最適Yで最高スコアを返す", () => {
  const score = evaluateOreYFitness("diamond_ore", -58);
  assert.ok(score > 0.9);
});

test("evaluateOreYFitnessは範囲外で0を返す", () => {
  assert.equal(evaluateOreYFitness("diamond_ore", 200), 0);
});

test("isNightTimeは夜間tickを正しく判定する", () => {
  assert.equal(isNightTime(13000), true);
  assert.equal(isNightTime(23000), true);
  assert.equal(isNightTime(6000), false);
  assert.equal(isNightTime(null), false);
});
