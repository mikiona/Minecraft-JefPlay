import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { DecisionLogger } from "../src/logger.js";

const TEST_LOG_PATH = "test/.tmp-logger-test.jsonl";

test("filePath未指定なら何も書き込まない", async () => {
  const logger = new DecisionLogger();
  await logger.log({ foo: "bar" });
  // 例外が起きなければOK(ファイルは作られない)。
  assert.ok(true);
});

test("filePath指定時はJSON Lines形式で追記される", async () => {
  await rm(TEST_LOG_PATH, { force: true });
  const logger = new DecisionLogger({ filePath: TEST_LOG_PATH });

  await logger.log({ action: "flee", health: 3 });
  await logger.log({ action: "eat", health: 10 });

  const content = await readFile(TEST_LOG_PATH, "utf8");
  const lines = content.trim().split("\n");
  assert.equal(lines.length, 2);

  const first = JSON.parse(lines[0]);
  assert.equal(first.action, "flee");
  assert.equal(first.health, 3);
  assert.ok("timestamp" in first);

  await rm(TEST_LOG_PATH, { force: true });
});
