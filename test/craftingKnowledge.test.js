import { test } from "node:test";
import assert from "node:assert/strict";
import { determineNextCraftGoal, logToPlanks } from "../src/craftingKnowledge.js";

test("logToPlanksは丸太名を木材名に変換する", () => {
  assert.equal(logToPlanks("oak_log"), "oak_planks");
  assert.equal(logToPlanks("birch_log"), "birch_planks");
});

test("何も持っていなければ作るものが無い(null)", () => {
  assert.equal(determineNextCraftGoal([]), null);
});

test("丸太を持っていれば木材への変換を優先する", () => {
  const goal = determineNextCraftGoal([{ name: "oak_log", count: 1 }]);
  assert.deepEqual(goal, { item: "oak_planks", needsTable: false });
});

test("木材が4個あれば作業台を作る", () => {
  const goal = determineNextCraftGoal([{ name: "oak_planks", count: 4 }]);
  assert.deepEqual(goal, { item: "crafting_table", needsTable: false });
});

test("作業台があり木材はあるが棒が無ければ棒を作る", () => {
  const items = [{ name: "crafting_table", count: 1 }, { name: "oak_planks", count: 3 }];
  const goal = determineNextCraftGoal(items);
  assert.deepEqual(goal, { item: "stick", needsTable: false });
});

test("作業台・木材・棒が揃えば木のツルハシを作る", () => {
  const items = [
    { name: "crafting_table", count: 1 },
    { name: "oak_planks", count: 3 },
    { name: "stick", count: 2 },
  ];
  const goal = determineNextCraftGoal(items);
  assert.deepEqual(goal, { item: "wooden_pickaxe", needsTable: true });
});

test("木のツルハシを持ち丸石があれば石のツルハシへ進む(棒が要る)", () => {
  const items = [
    { name: "crafting_table", count: 1 },
    { name: "wooden_pickaxe", count: 1 },
    { name: "wooden_sword", count: 1 },
    { name: "cobblestone", count: 3 },
    { name: "oak_planks", count: 2 },
  ];
  const goal = determineNextCraftGoal(items);
  assert.equal(goal.item, "stick");
});

test("木ツール一式+丸石+棒があれば石のツルハシを作る", () => {
  const items = [
    { name: "crafting_table", count: 1 },
    { name: "wooden_pickaxe", count: 1 },
    { name: "wooden_sword", count: 1 },
    { name: "cobblestone", count: 3 },
    { name: "stick", count: 2 },
  ];
  const goal = determineNextCraftGoal(items);
  assert.deepEqual(goal, { item: "stone_pickaxe", needsTable: true });
});

test("丸石が8個あり石ツール一式があればかまどを作る", () => {
  const items = [
    { name: "crafting_table", count: 1 },
    { name: "wooden_pickaxe", count: 1 },
    { name: "wooden_sword", count: 1 },
    { name: "stone_pickaxe", count: 1 },
    { name: "stone_sword", count: 1 },
    { name: "cobblestone", count: 8 },
  ];
  const goal = determineNextCraftGoal(items);
  assert.deepEqual(goal, { item: "furnace", needsTable: true });
});

test("作業台が無ければ木材が4個未満でもクラフト目標は無い", () => {
  const goal = determineNextCraftGoal([{ name: "oak_planks", count: 2 }]);
  assert.equal(goal, null);
});

test("hasNearbyCraftingTableがtrueなら所持していなくても作業台不要と判定する", () => {
  const items = [{ name: "oak_planks", count: 3 }];
  const goal = determineNextCraftGoal(items, { hasNearbyCraftingTable: true });
  assert.deepEqual(goal, { item: "stick", needsTable: false });
});
