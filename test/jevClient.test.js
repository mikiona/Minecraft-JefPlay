import { test } from "node:test";
import assert from "node:assert/strict";
import { JevClient, JevFatalError } from "../src/jevClient.js";

const baseQuestion = { id: "next_action", type: "choice", instructions: "t", criteria: { a: "", b: "" } };

test("リクエストが{model, questions, state}形式になる", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ answers: { next_action: { type: "choice", choice: "a", confidence: 0.9 } } }),
    };
  };
  const client = new JevClient({
    apiKey: "key",
    apiUrl: "https://example.test",
    model: "jev-latest",
    freshnessMs: 5000,
    fetchImpl,
  });

  const state = { health: 20 };
  await client.ask([baseQuestion], state);

  assert.equal(captured.url, "https://example.test");
  assert.equal(captured.body.model, "jev-latest");
  assert.deepEqual(captured.body.state, state);
  assert.equal(captured.body.questions.next_action.instructions, "t");
});

test("429を2回返した後200で成功すればリトライして結果を返す", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount++;
    if (callCount <= 2) {
      return { ok: false, status: 429, statusText: "Too Many Requests", text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ answers: { next_action: { type: "choice", choice: "a", confidence: 0.9 } } }),
    };
  };
  const client = new JevClient({
    apiKey: "key",
    apiUrl: "https://example.test",
    model: "jev-latest",
    freshnessMs: 5000,
    fetchImpl,
    sleepImpl: () => Promise.resolve(),
  });

  const result = await client.ask([baseQuestion], {});
  assert.equal(callCount, 3);
  assert.equal(result.answers[0].value, "a");
});

test("3回連続失敗するとJevFatalErrorになる", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    text: async () => "err",
  });
  const client = new JevClient({
    apiKey: "key",
    apiUrl: "https://example.test",
    model: "jev-latest",
    freshnessMs: 5000,
    fetchImpl,
    sleepImpl: () => Promise.resolve(),
  });

  await assert.rejects(() => client.ask([baseQuestion], {}), Error);
  await assert.rejects(() => client.ask([baseQuestion], {}), Error);
  await assert.rejects(() => client.ask([baseQuestion], {}), JevFatalError);
});

test("criteriaに存在しない選択肢の応答は破棄される", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ answers: { next_action: { type: "choice", choice: "nonexistent", confidence: 0.9 } } }),
  });
  const client = new JevClient({
    apiKey: "key",
    apiUrl: "https://example.test",
    model: "jev-latest",
    freshnessMs: 5000,
    fetchImpl,
  });

  const result = await client.ask([baseQuestion], {});
  assert.equal(result.answers[0].value, null);
  assert.equal(result.answers[0].invalid, true);
});

test("probabilities合計が1.0から大きく外れる応答は破棄される", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      answers: {
        next_action: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.9 } },
      },
    }),
  });
  const client = new JevClient({
    apiKey: "key",
    apiUrl: "https://example.test",
    model: "jev-latest",
    freshnessMs: 5000,
    fetchImpl,
  });

  const result = await client.ask([baseQuestion], {});
  assert.equal(result.answers[0].value, null);
});

test("isFreshは鮮度切れの応答を判定できる", () => {
  const client = new JevClient({ apiKey: "key", apiUrl: "x", model: "m", freshnessMs: 1000 });
  const fresh = { receivedAt: Date.now() };
  const stale = { receivedAt: Date.now() - 5000 };
  assert.equal(client.isFresh(fresh), true);
  assert.equal(client.isFresh(stale), false);
});

test("APIキー未設定ならモックモードで動作する", async () => {
  const client = new JevClient({ apiKey: null, apiUrl: "x", model: "m", freshnessMs: 5000 });
  assert.equal(client.mockMode, true);
  const result = await client.ask([baseQuestion], {});
  assert.equal(result.source, "mock");
  assert.ok(["a", "b"].includes(result.answers[0].value));
});
