import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAction } from "../src/actions.js";
import { CooldownTracker } from "../src/cooldown.js";

// mineflayerのVec3相当の簡易モック(offset/distanceToメソッドを持つ)。
function makeVec3(x, y, z) {
  return {
    x,
    y,
    z,
    offset(dx, dy, dz) {
      return makeVec3(x + dx, y + dy, z + dz);
    },
    distanceTo(other) {
      return Math.sqrt((x - other.x) ** 2 + (y - other.y) ** 2 + (z - other.z) ** 2);
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

test("attack以外の行動に切り替えるとbot.pvp.forceStopが呼ばれる", async () => {
  let forceStopCalled = false;
  const bot = {
    pathfinder: { setGoal: () => {} },
    pvp: { forceStop: () => (forceStopCalled = true) },
  };
  await executeAction(bot, "idle", {}, {});
  assert.equal(forceStopCalled, true);
});

test("attack_nearest_hostile選択時はbot.pvp.forceStopを呼ばない", async () => {
  let forceStopCalled = false;
  const bot = {
    entities: {
      1: { id: 1, kind: "Hostile mobs", name: "zombie", position: makeVec3(1, 64, 1) },
    },
    inventory: { items: () => [] },
    pvp: { attack: () => {}, forceStop: () => (forceStopCalled = true) },
  };
  await executeAction(bot, "attack_nearest_hostile", { nearbyEntities: [] }, {});
  assert.equal(forceStopCalled, false);
});

test("fleeは脅威の座標から遠ざかる方向へ移動する", async () => {
  let goalSet = null;
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(5, 64, 0) }, // 東側に脅威
    },
    pathfinderGoals: {
      goals: { GoalNear: class { constructor(x, y, z, r) { goalSet = { x, y, z, r }; } } },
    },
    pathfinder: { setGoal: () => {} },
  };
  const state = {
    terrain: { samples: { north: ["clear"], south: ["clear"], east: ["clear"], west: ["clear"] } },
  };
  const result = await executeAction(bot, "flee", state, {});
  assert.equal(result.ok, true);
  assert.equal(result.detail.direction, "west");
  assert.ok(goalSet.x < 0, "西(x負方向)へ逃げるゴールが設定されるべき");
});

test("fleeはneutral_ignore(エンダーマン)を脅威として扱わない", async () => {
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "enderman", position: makeVec3(5, 64, 0) },
    },
  };
  const result = await executeAction(bot, "flee", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("fleeは脅威から遠ざかる方向が地形的に危険なら、他の安全な方向を選ぶ", async () => {
  let goalSet = null;
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(5, 64, 0) }, // 東に脅威 -> 遠ざかる方向は西
    },
    pathfinderGoals: {
      goals: { GoalNear: class { constructor(x, y, z, r) { goalSet = { x, y, z, r }; } } },
    },
    pathfinder: { setGoal: () => {} },
  };
  // 西(west)だけhazardにして、遠ざかる方向を選べないようにする。
  const state = {
    terrain: { samples: { north: ["clear"], south: ["clear"], east: ["clear"], west: ["hazard"] } },
  };
  const result = await executeAction(bot, "flee", state, {});
  assert.equal(result.ok, true);
  assert.notEqual(result.detail.direction, "west");
});

test("fleeとexploreは水方向(water)を安全な方向として選ばない", async () => {
  let goalSet = null;
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(5, 64, 0) }, // 東に脅威 -> 本来は西へ逃げたい
    },
    pathfinderGoals: {
      goals: { GoalNear: class { constructor(x, y, z, r) { goalSet = { x, y, z, r }; } } },
    },
    pathfinder: { setGoal: () => {} },
  };
  // 西(逃げたい方向)が水、それ以外は安全。
  const state = {
    terrain: { samples: { north: ["clear"], south: ["clear"], east: ["clear"], west: ["water"] } },
  };
  const result = await executeAction(bot, "flee", state, {});
  assert.equal(result.ok, true);
  assert.notEqual(result.detail.direction, "west");
});

test("escape_waterはpathfinderのgoalを解除し、向きを合わせて前進+ジャンプで泳ぐ", async () => {
  const calls = [];
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    setControlState: (name, value) => calls.push(`${name}:${value}`),
    lookAt: async () => calls.push("lookAt"),
    pathfinder: { setGoal: (g) => calls.push(`setGoal:${g}`) },
  };
  const state = {
    terrain: { samples: { north: ["water"], south: ["clear"], east: ["water"], west: ["water"] } },
  };
  const result = await executeAction(bot, "escape_water", state, {});
  assert.equal(result.ok, true);
  assert.equal(result.detail.direction, "south");
  assert.deepEqual(calls, ["setGoal:null", "lookAt", "forward:true", "jump:true"]);
});

test("escape_waterは全方向waterでも停止せず、水が最も少ない方向へ泳ぐ", async () => {
  const calls = [];
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    setControlState: (name, value) => calls.push(`${name}:${value}`),
    lookAt: async () => calls.push("lookAt"),
    pathfinder: { setGoal: (g) => calls.push(`setGoal:${g}`) },
  };
  // south方向はwaterが1個のみで、他は4個(相対的にsouthが浅い/近道)。
  const state = {
    terrain: {
      samples: {
        north: ["water", "water", "water", "water"],
        south: ["water", "clear", "clear", "clear"],
        east: ["water", "water", "water", "water"],
        west: ["water", "water", "water", "water"],
      },
    },
  };
  const result = await executeAction(bot, "escape_water", state, {});
  assert.equal(result.ok, true);
  assert.equal(result.detail.direction, "south");
  assert.ok(calls.includes("forward:true"));
  assert.ok(calls.includes("jump:true"));
});

test("escape_waterは前回方向を維持する", async () => {
  const calls = [];
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    setControlState: (name, value) => calls.push(`${name}:${value}`),
    lookAt: async () => calls.push("lookAt"),
    pathfinder: { setGoal: () => {} },
  };
  const state = {
    terrain: { samples: { north: ["clear"], south: ["clear"], east: ["clear"], west: ["clear"] } },
  };
  const result = await executeAction(bot, "escape_water", state, { previousEscapeDirection: "east" });
  assert.equal(result.detail.direction, "east");
});

test("hunt_animalは食料になる動物が無ければno_targetを返す", async () => {
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "cat", position: makeVec3(1, 64, 1) }, // 食料にならない
    },
    inventory: { items: () => [] },
  };
  const result = await executeAction(bot, "hunt_animal", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("hunt_animalは最寄りの食料動物を狙い、剣を装備してから攻撃する", async () => {
  const calls = [];
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "cow", position: makeVec3(10, 64, 0) },
      2: { name: "pig", position: makeVec3(3, 64, 0) }, // より近い
    },
    inventory: { items: () => [{ name: "iron_sword" }] },
    equip: (item) => calls.push(`equip:${item.name}`),
    pvp: { attack: (target) => calls.push(`attack:${target.name}`) },
  };
  const result = await executeAction(bot, "hunt_animal", {}, {});
  assert.equal(result.ok, true);
  assert.equal(result.detail.targetType, "pig");
  assert.deepEqual(calls, ["equip:iron_sword", "attack:pig"]);
});

test("hunt_animalは検出範囲外の動物を対象にしない", async () => {
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "cow", position: makeVec3(30, 64, 0) }, // FOOD_SEARCH_RADIUS(16)超え
    },
    inventory: { items: () => [] },
  };
  const result = await executeAction(bot, "hunt_animal", {}, {});
  assert.deepEqual(result, { ok: false, reason: "no_target" });
});

test("hunt_animalからattack_nearest_hostileへの切り替えではforceStopしない", async () => {
  let forceStopCalled = false;
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    entities: {
      1: { name: "cow", position: makeVec3(3, 64, 0) },
    },
    inventory: { items: () => [] },
    pvp: { attack: () => {}, forceStop: () => (forceStopCalled = true) },
  };
  await executeAction(bot, "hunt_animal", {}, {});
  assert.equal(forceStopCalled, false);
});
