import { test } from "node:test";
import assert from "node:assert/strict";
import { startDecisionLoop } from "../src/decisionLoop.js";

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

function makeBot({ health = 20, entities = {} } = {}) {
  return {
    entity: { position: makeVec3(0, 64, 0) },
    entities,
    health,
    food: 20,
    time: { timeOfDay: 6000 },
    isRaining: false,
    heldItem: null,
    inventory: { items: () => [] },
    blockAt: () => ({ name: "air", boundingBox: "empty" }),
    pathfinder: { setGoal: () => {} },
    pathfinderGoals: { goals: { GoalNear: class {} } },
    pvp: { forceStop: () => {} },
    once: () => {},
  };
}

function makeJevClient(askImpl) {
  return {
    ask: askImpl,
    isFresh: () => true,
  };
}

test("HPが緊急閾値以下かつ近くに脅威がいるときはJev APIを呼ばずfleeを実行する", async () => {
  let askCalled = false;
  const bot = makeBot({
    health: 4,
    entities: { 1: { name: "zombie", kind: "Hostile mobs", position: makeVec3(1, 64, 0) } },
  });
  const jevClient = makeJevClient(async () => {
    askCalled = true;
    return { answers: [], source: "mock", receivedAt: Date.now() };
  });

  const loop = startDecisionLoop(bot, jevClient, { intervalMs: 10, emergencyHealthThreshold: 6 });
  // setIntervalの初回発火を待つ(intervalMsより十分長く待機する)。
  await new Promise((resolve) => setTimeout(resolve, 100));
  loop.stop();

  assert.equal(askCalled, false);
});

test("HPが緊急閾値以下でも近くに脅威がいなければJev APIを呼ぶ(食料切れ等からの回復手段を選べるようにするため)", async () => {
  let askCalled = false;
  const bot = makeBot({ health: 4 }); // entities省略 = 脅威なし
  const jevClient = makeJevClient(async () => {
    askCalled = true;
    return { answers: [], source: "mock", receivedAt: Date.now() };
  });

  const loop = startDecisionLoop(bot, jevClient, { intervalMs: 10, emergencyHealthThreshold: 6 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  loop.stop();

  assert.equal(askCalled, true);
});

test("HPが閾値より高いときは通常通りJev APIを呼ぶ", async () => {
  let askCalled = false;
  const bot = makeBot({ health: 20 });
  const jevClient = makeJevClient(async () => {
    askCalled = true;
    return { answers: [], source: "mock", receivedAt: Date.now() };
  });

  const loop = startDecisionLoop(bot, jevClient, { intervalMs: 10, emergencyHealthThreshold: 6 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  loop.stop();

  assert.equal(askCalled, true);
});

test("前回のtickが完了する前に次のtickは開始しない(長時間行動の二重実行防止)", async () => {
  const bot = makeBot({ health: 20 });
  let concurrentCalls = 0;
  let maxConcurrentCalls = 0;
  let totalCalls = 0;

  const jevClient = makeJevClient(async () => {
    concurrentCalls++;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
    totalCalls++;
    // chop_wood等の長時間行動(pathfinding+採掘)をシミュレートする。
    await new Promise((resolve) => setTimeout(resolve, 100));
    concurrentCalls--;
    return { answers: [], source: "mock", receivedAt: Date.now() };
  });

  // intervalMsを処理時間より大幅に短くし、setIntervalが前回未完了でも
  // 次のtickを呼ぼうとする状況を作る。
  const loop = startDecisionLoop(bot, jevClient, { intervalMs: 10, emergencyHealthThreshold: 6 });
  await new Promise((resolve) => setTimeout(resolve, 350));
  loop.stop();

  assert.equal(maxConcurrentCalls, 1, "同時に複数のtickが実行されてはいけない");
  assert.ok(totalCalls >= 2, "tick自体は完了ごとに繰り返し実行されるべき");
});
