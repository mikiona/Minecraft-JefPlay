import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, buildQuestions } from "../src/state.js";

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

function makeBot({ entities = {}, food = 15, timeOfDay = 6000, items = [], isInWater = false } = {}) {
  const selfEntity = { position: makeVec3(0, 64, 0), isInWater };
  return {
    entity: selfEntity,
    entities,
    health: 18,
    food,
    time: { timeOfDay },
    isRaining: false,
    heldItem: null,
    inventory: { items: () => items },
    blockAt: () => ({ name: "air", boundingBox: "empty" }),
  };
}

test("buildStateはterrain/recentActions/foodStatus/equipmentを含む構造を返す", () => {
  const bot = makeBot({
    entities: { 1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(2, 64, 0) } },
  });
  const history = [{ action: "idle", result: "ok", timestamp: Date.now() }];
  const state = buildState(bot, { actionHistory: history });

  assert.equal(state.health, 18);
  assert.equal(state.food, 15);
  assert.equal(state.nearbyEntities.length, 1);
  assert.equal(state.nearbyEntities[0].type, "zombie");
  assert.equal(state.nearbyEntities[0].engageStyle, "melee_ok");
  assert.ok("terrain" in state);
  assert.deepEqual(state.recentActions, history);
  assert.deepEqual(state.foodStatus, { value: 15, urgent: false, low: true, hasFood: false });
  assert.ok("equipment" in state);
});

test("actionHistory省略時は空配列になる", () => {
  const state = buildState(makeBot());
  assert.deepEqual(state.recentActions, []);
});

test("foodStatus.urgentは満腹度6以下でtrueになる", () => {
  const state = buildState(makeBot({ food: 6 }));
  assert.equal(state.foodStatus.urgent, true);
});

test("isInWaterはbot.entity.isInWaterを反映する", () => {
  const wet = buildState(makeBot({ isInWater: true }));
  assert.equal(wet.isInWater, true);

  const dry = buildState(makeBot({ isInWater: false }));
  assert.equal(dry.isInWater, false);
});

test("foodStatus.hasFoodは所持食料の有無を反映する", () => {
  const withFood = buildState(makeBot({ items: [{ name: "cooked_beef" }] }));
  assert.equal(withFood.foodStatus.hasFood, true);

  const withoutFood = buildState(makeBot({ items: [] }));
  assert.equal(withoutFood.foodStatus.hasFood, false);
});

test("isNightは夜間tickでtrueになる", () => {
  const state = buildState(makeBot({ timeOfDay: 18000 }));
  assert.equal(state.isNight, true);
});

test("hostileCountとsurroundedByHostilesはneutral_ignoreを除外して計算される", () => {
  const entities = {
    1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(1, 64, 0) },
    2: { name: "skeleton", kind: "Hostile mobs", position: makeVec3(2, 64, 0) },
    3: { name: "creeper", kind: "Hostile mobs", position: makeVec3(3, 64, 0) },
    4: { name: "enderman", kind: "Hostile mobs", position: makeVec3(4, 64, 0) }, // neutral_ignoreなので除外
  };
  const state = buildState(makeBot({ entities }));
  assert.equal(state.hostileCount, 3);
  assert.equal(state.surroundedByHostiles, true);
});

test("nearbyEntitiesはkindがHostile mobs以外(プレイヤー/アイテム等)を除外する", () => {
  const entities = {
    1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(1, 64, 0) },
    2: { name: "player", kind: "UNKNOWN", position: makeVec3(2, 64, 0) },
    3: { name: "item", kind: "UNKNOWN", position: makeVec3(3, 64, 0) },
    4: { name: "arrow", kind: "Projectiles", position: makeVec3(4, 64, 0) },
  };
  const state = buildState(makeBot({ entities }));
  assert.equal(state.nearbyEntities.length, 1);
  assert.equal(state.nearbyEntities[0].type, "zombie");
});

test("homePositionが渡されるとhomeDistanceが計算される", () => {
  const state = buildState(makeBot(), { homePosition: { x: 3, y: 64, z: 4 } });
  assert.equal(state.homeDistance, 5);
});

test("homePosition未指定ならhomeDistanceはnull", () => {
  const state = buildState(makeBot());
  assert.equal(state.homeDistance, null);
});

test("buildQuestionsは12個の選択肢を持つchoice質問を1つ返す", () => {
  const questions = buildQuestions();
  assert.equal(questions.length, 1);
  const q = questions[0];
  assert.equal(q.type, "choice");
  assert.equal(Object.keys(q.criteria).length, 12);
  assert.ok("mine_nearest_ore" in q.criteria);
  assert.ok("place_block" in q.criteria);
  assert.ok("return_to_base" in q.criteria);
  assert.ok("hunt_animal" in q.criteria);
  assert.ok("chop_wood" in q.criteria);
  assert.ok("craft_item" in q.criteria);
  assert.ok("smelt_item" in q.criteria);
});

test("buildStateはcrafting(次のクラフト目標や資源カウント)を含む", () => {
  const bot = makeBot({ items: [{ name: "oak_log", count: 2 }] });
  const state = buildState(bot);
  assert.equal(state.crafting.logCount, 2);
  assert.equal(state.crafting.nextGoal, "oak_planks");
});

test("nearbyAnimalsは食料になる動物のみを距離付きで返す", () => {
  const entities = {
    1: { name: "cow", kind: "Passive mobs", position: makeVec3(3, 64, 0) },
    2: { name: "cat", kind: "Passive mobs", position: makeVec3(2, 64, 0) }, // 食料にならないので除外
    3: { name: "zombie", kind: "Hostile mobs", position: makeVec3(1, 64, 0) },
  };
  const state = buildState(makeBot({ entities }));
  assert.equal(state.nearbyAnimals.length, 1);
  assert.equal(state.nearbyAnimals[0].type, "cow");
  assert.equal(state.nearbyAnimals[0].distance, 3);
});
