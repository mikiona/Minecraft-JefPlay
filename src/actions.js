// Jevの回答(Choice)をMineflayerのAPI呼び出しにマッピングする。
import { Vec3 } from "vec3";

// 採掘対象とみなす鉱石ブロック名(石系・ネザー系を含む代表的なもの)。
const ORE_PATTERN = /(coal|iron|copper|gold|diamond|redstone|lapis|emerald)_ore$/;
// pickaxeの性能順(木<石<鉄<ダイヤ<ネザライト)。
const PICKAXE_TIER_ORDER = ["wooden", "stone", "iron", "diamond", "netherite"];
// 設置対象とみなすブロックアイテム名。
const PLACEABLE_PATTERN = /_block$|^dirt$|^cobblestone$|^netherrack$/;

// 戻り値は { ok: boolean, reason?: string } に統一する。
// decisionLoop側で行動履歴(recentActions)の成否記録に使う。
export async function executeAction(bot, actionName, state, { cooldown } = {}) {
  switch (actionName) {
    case "flee":
      return fleeFromNearest(bot, state);
    case "attack_nearest_hostile":
      return attackNearestHostile(bot, state, cooldown);
    case "eat":
      return eatIfPossible(bot);
    case "explore":
      return exploreRandomly(bot);
    case "mine_nearest_ore":
      return mineNearestOre(bot, cooldown);
    case "place_block":
      return placeBlockNearby(bot);
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

function fleeFromNearest(bot, state) {
  const target = nearestEntity(bot, state);
  if (!target || !bot.entity?.position) return { ok: false, reason: "no_target" };
  const away = bot.entity.position.offset(
    (Math.random() - 0.5) * 10,
    0,
    (Math.random() - 0.5) * 10
  );
  moveTo(bot, away);
  return { ok: true };
}

function attackNearestHostile(bot, state, cooldown) {
  const target = Object.values(bot.entities).find(
    (e) =>
      e.kind === "Hostile mobs" &&
      e.position &&
      !(cooldown && cooldown.isOnCooldown(entityKey(e)))
  );
  if (!target) return { ok: false, reason: "no_target" };
  try {
    bot.pvp?.attack(target);
    return { ok: true };
  } catch (err) {
    cooldown?.markFailed(entityKey(target));
    return { ok: false, reason: err.message };
  }
}

async function eatIfPossible(bot) {
  const food = bot.inventory?.items().find((item) => item.name.includes("bread") || item.name.includes("apple"));
  if (!food) return { ok: false, reason: "no_food" };
  try {
    await bot.equip(food, "hand");
    await bot.consume();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function exploreRandomly(bot) {
  if (!bot.entity?.position) return { ok: false, reason: "no_position" };
  const target = bot.entity.position.offset(
    (Math.random() - 0.5) * 20,
    0,
    (Math.random() - 0.5) * 20
  );
  moveTo(bot, target);
  return { ok: true };
}

// エイム(対象鉱石ブロック選定)→装備(適切なpickaxe)→採掘、の順で実行する。
// 到達不能・ツール不足などで失敗した場合はcooldownに登録し、しばらく再試行しない。
async function mineNearestOre(bot, cooldown) {
  const block = bot.findBlock?.({
    matching: (b) => ORE_PATTERN.test(b.name) && !(cooldown && cooldown.isOnCooldown(blockKey(b.position))),
    maxDistance: 16,
  });
  if (!block) return { ok: false, reason: "no_target" };

  try {
    const tool = selectToolFor(bot, block);
    if (tool) await bot.equip(tool, "hand");

    const { goals } = bot.pathfinderGoals ?? {};
    if (goals?.GoalLookAtBlock && bot.pathfinder) {
      await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world));
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

function moveTo(bot, position) {
  const { goals } = bot.pathfinderGoals ?? {};
  if (!goals) return;
  bot.pathfinder.setGoal(new goals.GoalNear(position.x, position.y, position.z, 1));
}

function blockKey(pos) {
  return `block:${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function entityKey(entity) {
  return `entity:${entity.id}`;
}

// 木<石<鉄<ダイヤ<ネザライトの順で最良のpickaxeを選ぶ簡易実装。
function selectToolFor(bot, block) {
  if (!/_ore$/.test(block.name)) return null;
  const pickaxes = bot.inventory?.items().filter((i) => i.name.endsWith("_pickaxe")) ?? [];
  if (!pickaxes.length) return null;
  pickaxes.sort(
    (a, b) =>
      PICKAXE_TIER_ORDER.findIndex((t) => b.name.startsWith(t)) -
      PICKAXE_TIER_ORDER.findIndex((t) => a.name.startsWith(t))
  );
  return pickaxes[0];
}
