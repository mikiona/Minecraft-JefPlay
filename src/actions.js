// Jevの回答(Choice)をMineflayerのAPI呼び出しにマッピングする。
import { Vec3 } from "vec3";
import { classifyMob, selectBestFood, selectBestByTier, evaluateOreYFitness } from "./mobKnowledge.js";

// 採掘対象とみなす鉱石ブロック名(石系・ネザー系を含む代表的なもの)。
const ORE_PATTERN = /(coal|iron|copper|gold|diamond|redstone|lapis|emerald)_ore$/;
// 設置対象とみなすブロックアイテム名。
const PLACEABLE_PATTERN = /_block$|^dirt$|^cobblestone$|^netherrack$/;
// pathfinderの移動系操作が応答しない場合に諦めるまでの時間(既知のハング問題対策)。
const PATHFINDER_TIMEOUT_MS = 8000;

// 戻り値は { ok: boolean, reason?: string } に統一する。
// decisionLoop側で行動履歴(recentActions)の成否記録に使う。
export async function executeAction(bot, actionName, state, { cooldown } = {}) {
  // bot.pvp.attack()は一度呼ぶと対象を自動追跡・継続攻撃し続ける仕様のため、
  // attack以外の行動に切り替える際は明示的に停止しないと、flee等の移動指示と
  // 裏で競合し続ける(逃げているつもりでも追跡・攻撃が止まらない原因になる)。
  if (actionName !== "attack_nearest_hostile") {
    bot.pvp?.forceStop();
  }

  switch (actionName) {
    case "flee":
      return fleeFromNearest(bot, state);
    case "attack_nearest_hostile":
      return attackNearestHostile(bot, state, cooldown);
    case "eat":
      return eatIfPossible(bot);
    case "explore":
      return exploreRandomly(bot, state);
    case "mine_nearest_ore":
      return mineNearestOre(bot, cooldown);
    case "place_block":
      return placeBlockNearby(bot);
    case "return_to_base":
      return returnToBase(bot, state);
    case "idle":
    default:
      bot.pathfinder?.setGoal(null);
      return { ok: true };
  }
}

function nearestEntity(bot, state) {
  if (!state.nearbyEntities.length) return null;
  const sorted = [...state.nearbyEntities].sort((a, b) => a.distance - b.distance);
  return sorted[0];
}

// 地形サンプル(terrain.samples)を参照し、hazard/drop_or_no_floorを含まない
// 安全な方向を返す。取得できなければnullを返し、呼び出し側でランダムに
// フォールバックする。
function safestDirection(state) {
  const samples = state.terrain?.samples;
  if (!samples) return null;
  const safeDirs = Object.entries(samples)
    .filter(([, classes]) => classes.every((c) => c !== "hazard" && c !== "drop_or_no_floor"))
    .map(([name]) => name);
  if (!safeDirs.length) return null;
  return safeDirs[Math.floor(Math.random() * safeDirs.length)];
}

const DIRECTION_VECTORS = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

function fleeFromNearest(bot, state) {
  const target = nearestEntity(bot, state);
  if (!target || !bot.entity?.position) return { ok: false, reason: "no_target" };

  const dir = safestDirection(state);
  let away;
  if (dir) {
    const v = DIRECTION_VECTORS[dir];
    away = bot.entity.position.offset(v.dx * 10, 0, v.dz * 10);
  } else {
    away = bot.entity.position.offset((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
  }
  moveTo(bot, away);
  return { ok: true };
}

function attackNearestHostile(bot, state, cooldown) {
  const target = Object.values(bot.entities).find((e) => {
    if (!e.position || cooldown?.isOnCooldown(entityKey(e))) return false;
    if (e.kind !== "Hostile mobs") return false;
    const style = classifyMob(e.name);
    return style !== "neutral_ignore" && style !== "avoid_melee";
  });
  if (!target) return { ok: false, reason: "no_target" };

  try {
    const sword = selectBestByTier(bot.inventory?.items() ?? [], "_sword");
    if (sword) bot.equip?.(sword, "hand");
    bot.pvp?.attack(target);
    return { ok: true };
  } catch (err) {
    cooldown?.markFailed(entityKey(target));
    return { ok: false, reason: err.message };
  }
}

async function eatIfPossible(bot) {
  const food = selectBestFood(bot.inventory?.items() ?? []);
  if (!food) return { ok: false, reason: "no_food" };
  try {
    await bot.equip(food, "hand");
    await bot.consume();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function exploreRandomly(bot, state) {
  if (!bot.entity?.position) return { ok: false, reason: "no_position" };

  const dir = state ? safestDirection(state) : null;
  let target;
  if (dir) {
    const v = DIRECTION_VECTORS[dir];
    target = bot.entity.position.offset(v.dx * 20, 0, v.dz * 20);
  } else {
    target = bot.entity.position.offset((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20);
  }
  moveTo(bot, target);
  return { ok: true };
}

// エイム(対象鉱石ブロック選定)→装備(適切なpickaxe)→採掘、の順で実行する。
// 到達不能・ツール不足・溶岩/落下の危険がある場合はcooldownに登録し、しばらく再試行しない。
async function mineNearestOre(bot, cooldown) {
  const candidates = [];
  bot.findBlocks?.({
    matching: (b) => ORE_PATTERN.test(b.name) && !cooldown?.isOnCooldown(blockKey(b.position)),
    maxDistance: 16,
    count: 8,
  })?.forEach((pos) => {
    const block = bot.blockAt(pos);
    if (block) candidates.push(block);
  });

  // findBlocksが使えない(モック等)場合はfindBlockに単純フォールバック。
  if (!candidates.length) {
    const single = bot.findBlock?.({
      matching: (b) => ORE_PATTERN.test(b.name) && !cooldown?.isOnCooldown(blockKey(b.position)),
      maxDistance: 16,
    });
    if (single) candidates.push(single);
  }

  if (!candidates.length) return { ok: false, reason: "no_target" };

  // Y座標が最適範囲に近い鉱石を優先する。
  candidates.sort((a, b) => evaluateOreYFitness(b.name, b.position.y) - evaluateOreYFitness(a.name, a.position.y));
  const block = candidates[0];

  try {
    // 直下の安全確認(落下・溶岩対策)。
    const below = bot.blockAt(block.position.offset(0, -1, 0));
    if (below?.name === "lava") {
      const waterBucket = bot.inventory?.items().find((i) => i.name === "water_bucket");
      if (!waterBucket) {
        cooldown?.markFailed(blockKey(block.position));
        return { ok: false, reason: "lava_no_water" };
      }
      await bot.equip(waterBucket, "hand");
      await bot.lookAt(block.position.offset(0, -1, 0));
      await bot.activateItem();
    } else if (below?.name === "air") {
      cooldown?.markFailed(blockKey(block.position));
      return { ok: false, reason: "drop_hazard" };
    }

    const tool = selectBestByTier(bot.inventory?.items() ?? [], "_pickaxe");
    if (tool) await bot.equip(tool, "hand");

    const { goals } = bot.pathfinderGoals ?? {};
    if (goals?.GoalLookAtBlock && bot.pathfinder) {
      const result = await gotoWithTimeout(bot, new goals.GoalLookAtBlock(block.position, bot.world));
      if (!result.ok) {
        cooldown?.markFailed(blockKey(block.position));
        return result;
      }
    } else if (goals?.GoalNear && bot.pathfinder) {
      bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
    }

    await bot.dig(block);
    return { ok: true };
  } catch (err) {
    cooldown?.markFailed(blockKey(block.position));
    return { ok: false, reason: err.message };
  }
}

// インベントリ内のブロックアイテムを、視線の先(カーソル)にあるブロックに接して設置する。
async function placeBlockNearby(bot) {
  const item = bot.inventory?.items().find((i) => PLACEABLE_PATTERN.test(i.name));
  if (!item) return { ok: false, reason: "no_block_item" };

  const referenceBlock = bot.blockAtCursor?.(4);
  if (!referenceBlock) return { ok: false, reason: "no_reference_block" };

  try {
    await bot.equip(item, "hand");
    await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// 起動時に記録した拠点座標へ戻る。
async function returnToBase(bot, state) {
  const home = state?.homePosition;
  if (!home) return { ok: false, reason: "no_home" };

  const { goals } = bot.pathfinderGoals ?? {};
  if (!goals?.GoalNear || !bot.pathfinder) return { ok: false, reason: "no_pathfinder" };

  return gotoWithTimeout(bot, new goals.GoalNear(home.x, home.y, home.z, 2));
}

function moveTo(bot, position) {
  const { goals } = bot.pathfinderGoals ?? {};
  if (!goals) return;
  bot.pathfinder.setGoal(new goals.GoalNear(position.x, position.y, position.z, 1));
}

// mineflayer-pathfinderは経路が見つからない/採掘不能ブロックに阻まれると
// タイムアウトなしでハングすることがある既知の問題があるため、自前で
// タイムアウトを設けて強制中断する。
async function gotoWithTimeout(bot, goal, { timeoutMs = PATHFINDER_TIMEOUT_MS } = {}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "pathfinder_timeout" }), timeoutMs);
  });
  const attempt = bot.pathfinder.goto(goal).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, reason: err.message })
  );

  const result = await Promise.race([attempt, timeout]);
  clearTimeout(timer);
  if (result.reason === "pathfinder_timeout") {
    bot.pathfinder.setGoal(null);
  }
  return result;
}

function blockKey(pos) {
  return `block:${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function entityKey(entity) {
  return `entity:${entity.id}`;
}
