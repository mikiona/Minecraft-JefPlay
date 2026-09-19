import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleTerrain } from "../src/terrain.js";

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

test("bot.entity.positionが無ければnullを返す", () => {
  assert.equal(sampleTerrain({ entity: {} }), null);
});

test("溶岩がある方向はhazard、通常の地形はclearと判定される", () => {
  const blocks = new Map();
  const setBlock = (x, y, z, name, boundingBox) => blocks.set(`${x},${y},${z}`, { name, boundingBox });

  // north方向(dz=-1)の1マス先を溶岩に。
  setBlock(0, 63, -1, "stone", "block");
  setBlock(0, 64, -1, "lava", "empty");
  setBlock(0, 65, -1, "air", "empty");
  setBlock(0, 66, -1, "air", "empty");

  // south方向(dz=1)の1マス先は通常の地面。
  setBlock(0, 63, 1, "grass_block", "block");
  setBlock(0, 64, 1, "air", "empty");
  setBlock(0, 65, 1, "air", "empty");
  setBlock(0, 66, 1, "air", "empty");

  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    blockAt(pos) {
      const key = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
      return blocks.get(key) ?? { name: "air", boundingBox: "empty" };
    },
  };

  const result = sampleTerrain(bot);
  assert.equal(result.samples.north[0], "hazard");
  assert.equal(result.samples.south[0], "clear");
  assert.equal(result.isSafe, false);
});

test("周囲がすべて安全な地形ならisSafeがtrueになる", () => {
  const bot = {
    entity: { position: makeVec3(0, 64, 0) },
    blockAt: () => ({ name: "air", boundingBox: "empty" }),
  };
  // feetがemptyでbelowもemptyなので実際はdrop_or_no_floor判定になるが、
  // ここではhazardが一つも無いことのみを検証する。
  const result = sampleTerrain(bot);
  const allClassifications = Object.values(result.samples).flat();
  assert.ok(!allClassifications.includes("hazard"));
  assert.equal(result.isSafe, true);
});
