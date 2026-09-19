import { test } from "node:test";
import assert from "node:assert/strict";
import { CooldownTracker } from "../src/cooldown.js";

test("markFailed後はisOnCooldownがtrueになる", () => {
  const tracker = new CooldownTracker({ durationMs: 60000 });
  assert.equal(tracker.isOnCooldown("key1"), false);
  tracker.markFailed("key1");
  assert.equal(tracker.isOnCooldown("key1"), true);
});

test("durationMs経過後はクールダウンが解除される", async () => {
  const tracker = new CooldownTracker({ durationMs: 10 });
  tracker.markFailed("key1");
  assert.equal(tracker.isOnCooldown("key1"), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(tracker.isOnCooldown("key1"), false);
});

test("異なるキーは互いに影響しない", () => {
  const tracker = new CooldownTracker({ durationMs: 60000 });
  tracker.markFailed("key1");
  assert.equal(tracker.isOnCooldown("key2"), false);
});
