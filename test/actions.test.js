import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAction } from "../src/actions.js";
import { CooldownTracker } from "../src/cooldown.js";

// mineflayerのVec3相当の簡易モック(offsetメソッドを持つ)。
function makeVec3(x, y, z) {
  return {
    x,
    y,
    z,
    offset(dx, dy, dz) {
      return makeVec3(x + dx, y + dy, z + dz);
    },
  };
}

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
      const block = { name: "iron_ore", position: makeVec3(1, 16, 3) };
      return matching(block) ? block : null;
    },
    blockAt: () => ({ name: "stone" }),
    inventory: { items: () => [{ name: "iron_pickaxe" }] },
    equip: async (item) => calls.push(`equip:${item.name}`),
    pathfinderGoals: { goals: { GoalLookAtBlock: class {} } },
    pathfinder: { goto: async () => calls.push("goto"), setGoal: () => {} },
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
      const block = { name: "coal_ore", position: makeVec3(9, 136, 9) };
      return matching(block) ? block : null;
    },
    blockAt: () => ({ name: "stone" }),
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

test("mine_nearest_oreは直下が溶岩かつ水バケツ未所持ならlava_no_waterで中断する", async () => {
  const cooldown = new CooldownTracker({ durationMs: 60000 });
  const bot = {
    findBlock: ({ matching }) => {
      const block = { name: "diamond_ore", position: makeVec3(0, -58, 0) };
      return matching(block) ? block : null;
    },
    blockAt: () => ({ name: "lava" }),
    inventory: { items: () => [] },
  };
  const result = await executeAction(bot, "mine_nearest_ore", {}, { cooldown });
  assert.deepEqual(result, { ok: false, reason: "lava_no_water" });
});

test("mine_nearest_oreは直下が溶岩でも水バケツ所持なら消火して採掘する", async () => {
  const calls = [];
  const bot = {
    findBlock: ({ matching }) => {
      const block = { name: "diamond_ore", position: makeVec3(0, -58, 0) };
      return matching(block) ? block : null;
    },
    blockAt: () => ({ name: "lava" }),
    inventory: { items: () => [{ name: "water_bucket" }] },
    equip: async (item) => calls.push(`equip:${item.name}`),
    lookAt: async () => calls.push("lookAt"),
    activateItem: async () => calls.push("activateItem"),
    pathfinderGoals: {},
    dig: async () => calls.push("dig"),
  };
  const result = await executeAction(bot, "mine_nearest_ore", {}, {});
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.includes("activateItem"));
  assert.ok(calls.includes("dig"));
});

test("mine_nearest_oreは直下が空洞(落下の危険)ならdrop_hazardで中断する", async () => {
  const bot = {
    findBlock: ({ matching }) => {
      const block = { name: "coal_ore", position: makeVec3(0, 136, 0) };
      return matching(block) ? block : null;
    },
    blockAt: () => ({ name: "air" }),
    inventory: { items: () => [] },
  };
  const result = await executeAction(bot, "mine_nearest_ore", {}, {});
  assert.deepEqual(result, { ok: false, reason: "drop_hazard" });
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

test("eatは調理済み食料を優先して装備・消費する", async () => {
  const calls = [];
  const bot = {
    inventory: { items: () => [{ name: "apple" }, { name: "cooked_beef" }] },
    equip: async (item) => calls.push(`equip:${item.name}`),
    consume: async () => calls.push("consume"),
  };
  const result = await executeAction(bot, "eat", {}, {});
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["equip:cooked_beef", "consume"]);
});

test("fleeは対象がいなければno_targetを返す", async () => {
  const bot = { entity: { position: null } };
  const result = await executeAction(bot, "flee", { nearbyEntities: [] }, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("attack_nearest_hostileはエンダーマン(neutral_ignore)を対象から除外する", async () => {
  const bot = {
    entities: {
      1: { id: 1, kind: "Hostile mobs", name: "enderman", position: makeVec3(1, 64, 1) },
    },
    inventory: { items: () => [] },
    pvp: { attack: () => {} },
  };
  const result = await executeAction(bot, "attack_nearest_hostile", { nearbyEntities: [] }, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("attack_nearest_hostileはクリーパー(avoid_melee)を対象から除外する", async () => {
  const bot = {
    entities: {
      1: { id: 1, kind: "Hostile mobs", name: "creeper", position: makeVec3(1, 64, 1) },
    },
    inventory: { items: () => [] },
    pvp: { attack: () => {} },
  };
  const result = await executeAction(bot, "attack_nearest_hostile", { nearbyEntities: [] }, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("attack_nearest_hostileはゾンビを対象にし、剣を装備してから攻撃する", async () => {
  const calls = [];
  const bot = {
    entities: {
      1: { id: 1, kind: "Hostile mobs", name: "zombie", position: makeVec3(1, 64, 1) },
    },
    inventory: { items: () => [{ name: "iron_sword" }] },
    equip: (item) => calls.push(`equip:${item.name}`),
    pvp: { attack: () => calls.push("attack") },
  };
  const result = await executeAction(bot, "attack_nearest_hostile", { nearbyEntities: [] }, {});
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["equip:iron_sword", "attack"]);
});

test("return_to_baseはhomePositionが無ければno_homeを返す", async () => {
  const result = await executeAction({}, "return_to_base", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_home" });
});

test("return_to_baseはhomePositionへgotoを試みる", async () => {
  const calls = [];
  const bot = {
    pathfinderGoals: { goals: { GoalNear: class {} } },
    pathfinder: { goto: async () => calls.push("goto"), setGoal: () => {} },
  };
  const state = { homePosition: { x: 0, y: 64, z: 0 } };
  const result = await executeAction(bot, "return_to_base", state, {});
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["goto"]);
});
