import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAction } from "../src/actions.js";
import { CooldownTracker } from "../src/cooldown.js";

test("idleはpathfinderのgoalを解除してok:trueを返す", async () => {
  let cleared = false;
  const bot = { pathfinder: { setGoal: (g) => (cleared = g === null) } };
  const result = await executeAction(bot, "idle", {}, {});
  assert.equal(cleared, true);
  assert.deepEqual(result, { ok: true });
});

test("mine_nearest_oreは対象が見つからなければno_targetを返す", async () => {
  const bot = { findBlock: () => null, inventory: { items: () => [] } };
  const result = await executeAction(bot, "mine_nearest_ore", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("mine_nearest_oreは成功時にequip/goto/digを呼ぶ", async () => {
  const calls = [];
  const bot = {
    findBlock: ({ matching }) => {
      const block = { name: "iron_ore", position: { x: 1, y: 2, z: 3 } };
      return matching(block) ? block : null;
    },
    inventory: { items: () => [{ name: "iron_pickaxe" }] },
    equip: async (item) => calls.push(`equip:${item.name}`),
    pathfinderGoals: { goals: { GoalLookAtBlock: class {} } },
    pathfinder: { goto: async () => calls.push("goto") },
    world: {},
    dig: async () => calls.push("dig"),
  };
  const result = await executeAction(bot, "mine_nearest_ore", {}, {});
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["equip:iron_pickaxe", "goto", "dig"]);
});

test("mine_nearest_oreは失敗した対象をクールダウンに登録し、次回除外する", async () => {
  const cooldown = new CooldownTracker({ durationMs: 60000 });
  const bot = {
    findBlock: ({ matching }) => {
      const block = { name: "coal_ore", position: { x: 9, y: 9, z: 9 } };
      return matching(block) ? block : null;
    },
    inventory: { items: () => [] },
    pathfinderGoals: {},
    dig: async () => {
      throw new Error("digが失敗");
    },
  };

  const first = await executeAction(bot, "mine_nearest_ore", {}, { cooldown });
  assert.equal(first.ok, false);

  const second = await executeAction(bot, "mine_nearest_ore", {}, { cooldown });
  assert.deepEqual(second, { ok: false, reason: "no_target" });
});

test("place_blockはブロックアイテムがなければno_block_itemを返す", async () => {
  const bot = { inventory: { items: () => [] } };
  const result = await executeAction(bot, "place_block", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_block_item" });
});

test("eatは食料がなければno_foodを返す", async () => {
  const bot = { inventory: { items: () => [] } };
  const result = await executeAction(bot, "eat", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_food" });
});

test("fleeは対象がいなければno_targetを返す", async () => {
  const bot = { entity: { position: null } };
  const result = await executeAction(bot, "flee", { nearbyEntities: [] }, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});
