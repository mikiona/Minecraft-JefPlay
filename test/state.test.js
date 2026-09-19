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

function makeBot() {
  const selfEntity = { position: makeVec3(0, 64, 0) };
  return {
    entity: selfEntity,
    entities: {
      1: { name: "zombie", position: makeVec3(2, 64, 0) },
    },
    health: 18,
    food: 15,
    time: { timeOfDay: 13000 },
    isRaining: false,
    heldItem: null,
    blockAt: () => ({ name: "air", boundingBox: "empty" }),
  };
}

test("buildStateはterrainとrecentActionsを含む構造を返す", () => {
  const bot = makeBot();
  const history = [{ action: "idle", result: "ok", timestamp: Date.now() }];
  const state = buildState(bot, { actionHistory: history });

  assert.equal(state.health, 18);
  assert.equal(state.food, 15);
  assert.equal(state.nearbyEntities.length, 1);
  assert.equal(state.nearbyEntities[0].type, "zombie");
  assert.ok("terrain" in state);
  assert.deepEqual(state.recentActions, history);
});

test("actionHistory省略時は空配列になる", () => {
  const state = buildState(makeBot());
  assert.deepEqual(state.recentActions, []);
});

test("buildQuestionsは7つの選択肢を持つchoice質問を1つ返す", () => {
  const questions = buildQuestions();
  assert.equal(questions.length, 1);
  const q = questions[0];
  assert.equal(q.type, "choice");
  assert.equal(Object.keys(q.criteria).length, 7);
  assert.ok("mine_nearest_ore" in q.criteria);
  assert.ok("place_block" in q.criteria);
});
