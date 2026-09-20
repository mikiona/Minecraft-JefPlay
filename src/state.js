// bot周辺のブロック/エンティティ/プレイヤー状態を構造化し、
// Jevに投げる質問(questions)を組み立てる。
import { sampleTerrain } from "./terrain.js";
import { classifyMob, isNightTime, selectBestByTier, selectBestFood, isHuntableAnimal } from "./mobKnowledge.js";

const NEARBY_RADIUS = 8;
// 食料になる動物の探索範囲。actions.jsのFOOD_SEARCH_RADIUSと合わせる。
const ANIMAL_SEARCH_RADIUS = 16;
// 満腹度がこの値以下だとダッシュ不可(Minecraft仕様)。最優先で食事すべき閾値。
const FOOD_URGENT_THRESHOLD = 6;
// 満腹度がこの値以下なら、機会があれば食事すべき閾値。
const FOOD_LOW_THRESHOLD = 17;
// この数以上の敵性エンティティに囲まれたらflee優先とみなす閾値。
const SURROUNDED_THRESHOLD = 3;

// actionHistory: decisionLoop側が保持する直近の行動履歴({action, result, timestamp}の配列)。
// homePosition: decisionLoop側が起動時に記録した拠点座標({x,y,z} | null)。
export function buildState(bot, { actionHistory = [], homePosition = null } = {}) {
  const pos = bot.entity?.position;
  // kind === "Hostile mobs" に限定する。これが無いと、プレイヤー自身や
  // ドロップアイテム・経験値オーブ・矢なども(minecraft-data上でkindが
  // "UNKNOWN"扱いのため)nearbyEntitiesに混入し、Jevが「敵性エンティティ」
  // と誤解して判断を誤る原因になる(実際にitemをattack_nearest_hostileの
  // 対象と誤認し続ける事例をログで確認した)。
  const nearbyEntities = Object.values(bot.entities)
    .filter(
      (e) =>
        e !== bot.entity &&
        e.kind === "Hostile mobs" &&
        e.position &&
        pos &&
        e.position.distanceTo(pos) <= NEARBY_RADIUS
    )
    .map((e) => ({
      type: e.name ?? e.username ?? "unknown",
      distance: Number(e.position.distanceTo(pos).toFixed(2)),
      engageStyle: classifyMob(e.name),
    }));

  const hostileCount = nearbyEntities.filter((e) => e.engageStyle !== "neutral_ignore").length;

  // 食料源になる動物(牛/豚/鶏/羊/うさぎ)。所持食料が無い場合にhunt_animalを
  // 選ぶ判断材料として、通常の脅威検出より広い範囲で観測する。
  const nearbyAnimals = Object.values(bot.entities)
    .filter(
      (e) =>
        e !== bot.entity &&
        isHuntableAnimal(e.name) &&
        e.position &&
        pos &&
        e.position.distanceTo(pos) <= ANIMAL_SEARCH_RADIUS
    )
    .map((e) => ({
      type: e.name,
      distance: Number(e.position.distanceTo(pos).toFixed(2)),
    }));

  const items = bot.inventory?.items() ?? [];

  return {
    health: bot.health,
    food: bot.food,
    foodStatus: {
      value: bot.food,
      urgent: bot.food != null && bot.food <= FOOD_URGENT_THRESHOLD,
      low: bot.food != null && bot.food <= FOOD_LOW_THRESHOLD,
      // 満腹度が低くても所持食料が無ければeatは常に失敗する。この情報が無いと
      // Jevが「food不足→eat」を選び続け、失敗し続けるだけの停滞が起きる
      // (実際にログで確認した)。
      hasFood: selectBestFood(items) !== null,
    },
    position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    isInWater: Boolean(bot.entity?.isInWater),
    timeOfDay: bot.time?.timeOfDay ?? null,
    isNight: isNightTime(bot.time?.timeOfDay),
    isRaining: bot.isRaining ?? false,
    nearbyEntities,
    hostileCount,
    surroundedByHostiles: hostileCount >= SURROUNDED_THRESHOLD,
    nearbyAnimals,
    heldItem: bot.heldItem?.name ?? null,
    equipment: {
      heldItem: bot.heldItem?.name ?? null,
      hasSword: Boolean(bot.heldItem?.name?.endsWith("_sword")),
      bestPickaxeTier: selectBestByTier(items, "_pickaxe")?.name ?? null,
      bestSwordTier: selectBestByTier(items, "_sword")?.name ?? null,
    },
    terrain: sampleTerrain(bot),
    recentActions: actionHistory,
    homePosition,
    homeDistance: homePosition && pos ? Number(distance3d(pos, homePosition).toFixed(2)) : null,
  };
}

function distance3d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// state から Jev への questions を組み立てる。
// 公式ドキュメント(docs.typesafe.ai)で確認した仕様に基づく:
// choice型は { type, instructions, criteria } の形式。
// criteriaのキーがそのまま選択肢を表し、optionsフィールドは不要。
// 状況データ(HP/food等)は文字列化してinstructionsに埋め込まず、
// リクエストのトップレベルの"state"フィールドとして別送りする。
//
// criteriaの文言はMinecraft攻略知識(Web調査)を反映した数値観点を含む:
// - 満腹度6以下は緊急、17以下は機会があれば食事すべき
// - クリーパーは近接厳禁、エンダーマンは中立なので攻撃対象外
// - 敵性エンティティ3体以上に囲まれたらflee優先
// - 鉱石はY座標の最適範囲に近いものを優先(石炭Y136/鉄Y16/ダイヤ・レッドストーンY-58付近)
export function buildQuestions() {
  return [
    {
      id: "next_action",
      type: "choice",
      instructions:
        "現在の状況(HP/満腹度と食料の所持有無/周辺の敵性エンティティとその種別/周辺の動物とその距離/" +
        "夜間かどうか/装備/直近の行動履歴/周辺地形の安全性/拠点からの距離)に最も適した行動を選んで" +
        "ください。地形が安全でない場合は移動を伴う行動を避けてください。" +
        "同じ行動を実行しても状況(HP/満腹度/位置など)が変化しない場合、その行動は効果が無いか" +
        "失敗しているとみなし、他の行動に切り替えるべきです。",
      criteria: {
        explore:
          "他に緊急性のある行動(戦闘・逃走・食事・採掘・帰還)が不要なときのデフォルトの行動。" +
          "周辺に脅威がなく地形が安全なら、特別な理由が無くても継続して探索し続けるべき。" +
          "同じ場所に留まり続ける理由がない限りこれを選ぶこと",
        flee:
          "体力が10以下の場合、近くにクリーパーがいる場合、または敵性エンティティに3体以上囲まれている場合。" +
          "体力が低いまま戦闘を続けるのは避けるべき",
        attack_nearest_hostile:
          "体力が15以上に余裕があり、近くに敵性エンティティ(クリーパー・エンダーマンを除く)が" +
          "1〜2体のみいる場合。剣を装備できるとなお良い。体力が低下してきたら戦闘を継続せずfleeに切り替えるべき",
        hunt_animal:
          "食料を所持しておらず(または満腹度が低く)、周辺に食料源の動物(牛/豚/鶏/羊/うさぎ)がいる場合。" +
          "動物を倒すと生肉がドロップし、それをeatで消費できるようになる",
        eat:
          "満腹度が17以下で、食料を所持しており、脅威が近くにない場合。満腹度が6以下の場合は最優先で行うこと。" +
          "食料を所持していない場合はeatを選ばず、近くに動物がいればhunt_animalを、いなければexploreで" +
          "動物を探すこと",
        mine_nearest_ore:
          "周辺に採掘可能な鉱石があり、そのY座標が対象鉱石に適しており" +
          "(石炭はY136付近、鉄はY16付近、ダイヤ・レッドストーンはY-58付近)、" +
          "十分なツールを持ち、脅威がない場合",
        place_block: "足場や防御のためにブロックを設置する必要があり、設置可能なブロックアイテムを持っている場合",
        return_to_base: "拠点から離れすぎており、緊急の脅威がない場合",
        idle:
          "本当に他に選ぶべき行動がない極めて限定的な場合のみ(例: 危険な地形に完全に囲まれ、" +
          "移動も採掘も設置も戦闘も不可能な場合)。周辺が安全なだけの平常時はidleではなくexploreを選ぶこと",
      },
    },
  ];
}
