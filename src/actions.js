// Jevの回答(Choice)をMineflayerのAPI呼び出しにマッピングする。
import { Vec3 } from "vec3";
import { classifyMob, selectBestFood, selectBestByTier, evaluateOreYFitness, isHuntableAnimal } from "./mobKnowledge.js";

// 採掘対象とみなす鉱石ブロック名(石系・ネザー系を含む代表的なもの)。
const ORE_PATTERN = /(coal|iron|copper|gold|diamond|redstone|lapis|emerald)_ore$/;
// 設置対象とみなすブロックアイテム名。
const PLACEABLE_PATTERN = /_block$|^dirt$|^cobblestone$|^netherrack$/;
// pathfinderの移動系操作が応答しない場合に諦めるまでの時間(既知のハング問題対策)。
const PATHFINDER_TIMEOUT_MS = 8000;
// flee判断で「脅威」とみなす最大距離(state.jsのNEARBY_RADIUSと合わせる)。
// これが無いと50ブロック先のクモ等にまで反応し、無意味な方向へ逃げ続ける
// (実機で確認: 水面浮上の瞬間に遠方の脅威を検出しescape_waterと交互発動)。
const THREAT_DETECTION_RADIUS = 8;
// 食料になる動物(牛/豚/鶏/羊/うさぎ)を探す最大距離。戦闘の脅威より
// 少し広めにし、mine_nearest_oreのmaxDistanceと合わせている。
const FOOD_SEARCH_RADIUS = 16;

// bot.pvp.attack()を使う継続的な攻撃系行動。これらの間で切り替える際は
// forceStopしない(連続攻撃の途中でリセットしてしまうため)。
const ATTACK_ACTIONS = new Set(["attack_nearest_hostile", "hunt_animal"]);

// 戻り値は { ok: boolean, reason?: string } に統一する。
// decisionLoop側で行動履歴(recentActions)の成否記録に使う。
export async function executeAction(bot, actionName, state, { cooldown, previousEscapeDirection } = {}) {
  // bot.pvp.attack()は一度呼ぶと対象を自動追跡・継続攻撃し続ける仕様のため、
  // attack系以外の行動に切り替える際は明示的に停止しないと、flee等の移動
  // 指示と裏で競合し続ける(逃げているつもりでも追跡・攻撃が止まらない
  // 原因になる)。
  if (!ATTACK_ACTIONS.has(actionName)) {
    bot.pvp?.forceStop();
  }

  switch (actionName) {
    case "flee":
      return fleeFromNearest(bot, state);
    case "attack_nearest_hostile":
      return attackNearestHostile(bot, state, cooldown);
    case "hunt_animal":
      return huntAnimal(bot, cooldown);
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
    case "escape_water":
      return escapeWater(bot, state, previousEscapeDirection);
    case "idle":
    default:
      bot.pathfinder?.setGoal(null);
      return { ok: true };
  }
}

// state.nearbyEntitiesは位置を持たないため、実座標が必要な処理(flee等)では
// bot.entitiesから直接、最寄りの脅威(kind === "Hostile mobs" かつ
// neutral_ignore以外)を探して返す。kindチェックが無いと、魚(tropical_fish
// 等)やプレイヤー自身/別プレイヤーまで「脅威」と誤認し、無意味な方向へ
// fleeし続ける事例が実機で発生した(水面浮上時に多発)。
function nearestThreatEntity(bot) {
  const pos = bot.entity?.position;
  if (!pos) return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.position) continue;
    if (e.kind !== "Hostile mobs") continue;
    if (classifyMob(e.name) === "neutral_ignore") continue;
    const dist = pos.distanceTo(e.position);
    if (dist > THREAT_DETECTION_RADIUS) continue;
    if (dist < nearestDist) {
      nearest = e;
      nearestDist = dist;
    }
  }
  return nearest ? { entity: nearest, distance: nearestDist } : null;
}

// 地形サンプル(terrain.samples)を参照し、hazard/drop_or_no_floor/waterを
// 含まない安全な方向の一覧を返す。地形情報が無ければnullを返す。
// waterを除外しないと、water(boundingBox上は空気と同じ判定)が"安全"と
// 誤認識され、explore/fleeが平気で水中へ入り込んでしまう。
function safeDirections(state) {
  const samples = state.terrain?.samples;
  if (!samples) return null;
  const safeDirs = Object.entries(samples)
    .filter(([, classes]) => classes.every((c) => c !== "hazard" && c !== "drop_or_no_floor" && c !== "water"))
    .map(([name]) => name);
  return safeDirs.length ? safeDirs : null;
}

const DIRECTION_VECTORS = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

// 脅威の位置から見て自分がいる方向(=脅威から遠ざかる方向)に最も近い
// DIRECTION_VECTORSのキーを返す(内積が最大になる方向)。
function directionAwayFrom(selfPos, threatPos) {
  const dx = selfPos.x - threatPos.x;
  const dz = selfPos.z - threatPos.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const nx = dx / len;
  const nz = dz / len;

  let best = null;
  let bestScore = -Infinity;
  for (const [name, v] of Object.entries(DIRECTION_VECTORS)) {
    const score = v.dx * nx + v.dz * nz;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

function fleeFromNearest(bot, state) {
  const threat = nearestThreatEntity(bot);
  if (!threat || !bot.entity?.position) return { ok: false, reason: "no_target" };

  const safeDirs = safeDirections(state);
  const awayDir = directionAwayFrom(bot.entity.position, threat.entity.position);

  // 脅威から遠ざかる方向が地形的にも安全ならそれを優先する。
  // 安全でなければ、他の安全な方向の中から選ぶ。それも無ければ
  // 危険を承知で脅威から遠ざかる方向を選ぶ(地形不明時のフォールバック)。
  let dir;
  if (!safeDirs || safeDirs.includes(awayDir)) {
    dir = awayDir;
  } else {
    dir = safeDirs[Math.floor(Math.random() * safeDirs.length)];
  }

  const v = DIRECTION_VECTORS[dir];
  const away = bot.entity.position.offset(v.dx * 12, 0, v.dz * 12);
  moveTo(bot, away);
  return {
    ok: true,
    detail: {
      threatType: threat.entity.name,
      threatDistance: Number(threat.distance.toFixed(2)),
      direction: dir,
      target: { x: away.x, y: away.y, z: away.z },
    },
  };
}

// "Nearest"という名前にも関わらず距離でソートしておらず、範囲制限も無く
// 「最初に見つかった」対象をそのまま攻撃していた(実質ランダムに近い)。
// 最寄りかつ検出範囲内の対象を明示的に選ぶよう修正した。
function attackNearestHostile(bot, state, cooldown) {
  const pos = bot.entity?.position;
  let target = null;
  let targetDist = Infinity;
  for (const e of Object.values(bot.entities)) {
    if (!e.position || cooldown?.isOnCooldown(entityKey(e))) continue;
    if (e.kind !== "Hostile mobs") continue;
    const style = classifyMob(e.name);
    if (style === "neutral_ignore" || style === "avoid_melee") continue;
    const dist = pos ? pos.distanceTo(e.position) : 0;
    if (dist > THREAT_DETECTION_RADIUS) continue;
    if (dist < targetDist) {
      target = e;
      targetDist = dist;
    }
  }
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

// 食料源となる動物(牛/豚/鶏/羊/うさぎ)を狩る。倒すと生肉がドロップし、
// eatIfPossible()で消費できるようになる。攻撃はattackNearestHostileと
// 同様にmineflayer-pvpの自動追跡・連続攻撃に任せる。
function huntAnimal(bot, cooldown) {
  const pos = bot.entity?.position;
  let target = null;
  let targetDist = Infinity;
  for (const e of Object.values(bot.entities)) {
    if (!e.position || cooldown?.isOnCooldown(entityKey(e))) continue;
    if (!isHuntableAnimal(e.name)) continue;
    const dist = pos ? pos.distanceTo(e.position) : 0;
    if (dist > FOOD_SEARCH_RADIUS) continue;
    if (dist < targetDist) {
      target = e;
      targetDist = dist;
    }
  }
  if (!target) return { ok: false, reason: "no_target" };

  try {
    const sword = selectBestByTier(bot.inventory?.items() ?? [], "_sword");
    if (sword) bot.equip?.(sword, "hand");
    bot.pvp?.attack(target);
    return { ok: true, detail: { targetType: target.name, distance: Number(targetDist.toFixed(2)) } };
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

  const safeDirs = state ? safeDirections(state) : null;
  const dir = safeDirs ? safeDirs[Math.floor(Math.random() * safeDirs.length)] : null;
  let target;
  if (dir) {
    const v = DIRECTION_VECTORS[dir];
    target = bot.entity.position.offset(v.dx * 20, 0, v.dz * 20);
  } else {
    target = bot.entity.position.offset((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20);
  }
  moveTo(bot, target);
  return { ok: true, detail: { direction: dir, target: { x: target.x, y: target.y, z: target.z } } };
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

// 指定方向のterrainサンプルに含まれる"water"の数を数える。
// 広い水域(全方向waterだらけ)でも、相対的に浅い/短い方向を選ぶための指標。
function countWaterInDirection(state, dirName) {
  const classes = state?.terrain?.samples?.[dirName];
  if (!classes) return Infinity;
  return classes.filter((c) => c === "water").length;
}

// 水中(bot.entity.isInWater)からの緊急脱出。
//
// 重要: mineflayer-pathfinderは水中を移動可能な地形として扱わない設計
// になっている(node_modules/mineflayer-pathfinder/lib/movements.jsに
// "dont go underwater"/"cant jump from water"という制約がある)。その
// ため水中にいる状態でbot.pathfinder.setGoal()を使っても経路計算が
// 機能せず、goalを設定してもほとんど移動しないまま水域内で足踏みし
// 続ける事例が実機で確認された。pathfinderには頼らず、向きを合わせて
// 前進+ジャンプを直接制御する(Minecraftの水中移動の基本操作)方式に
// 変更した。
//
// previousDirection: 直前tickで選んだ方向。250ms毎にランダムに選び直す
// と west→east→south→west… と方向が定まらずその場で足踏みし続ける
// 事例が実機で発生したため、まだ有効な方向であれば維持する。
async function escapeWater(bot, state, previousDirection) {
  if (!bot.entity?.position) return { ok: false, reason: "no_position" };

  // pathfinderが裏でcontrolState(forward/jump等)を管理していると
  // 直接制御と競合するため、既存のgoalを明示的に解除する。
  bot.pathfinder?.setGoal(null);

  const safeDirs = state ? safeDirections(state) : null;
  let dir;
  if (safeDirs) {
    dir = previousDirection && safeDirs.includes(previousDirection)
      ? previousDirection
      : safeDirs[Math.floor(Math.random() * safeDirs.length)];
  } else if (previousDirection) {
    // 安全な方向が無くても、前回方向を維持する方が一貫した移動になる。
    dir = previousDirection;
  } else {
    const dirNames = Object.keys(DIRECTION_VECTORS);
    dirNames.sort(
      (a, b) => countWaterInDirection(state, a) - countWaterInDirection(state, b) || Math.random() - 0.5
    );
    dir = dirNames[0];
  }

  const v = DIRECTION_VECTORS[dir];
  const target = bot.entity.position.offset(v.dx * 10, 1, v.dz * 10);

  try {
    await bot.lookAt?.(target, true);
    bot.setControlState?.("forward", true);
    bot.setControlState?.("jump", true);
    return { ok: true, detail: { direction: dir, target: { x: target.x, y: target.y, z: target.z } } };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    // 次tick(250ms後)に新しい制御が発行されるので、それより少し早く
    // 解除して制御の重複を防ぐ。
    setTimeout(() => {
      bot.setControlState?.("forward", false);
      bot.setControlState?.("jump", false);
    }, 200);
  }
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
