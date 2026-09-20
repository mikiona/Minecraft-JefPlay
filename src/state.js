// bot周辺のブロック/エンティティ/プレイヤー状態を構造化し、
// Jevに投げる質問(questions)を組み立てる。
import { sampleTerrain } from "./terrain.js";
import { classifyMob, isNightTime, selectBestByTier } from "./mobKnowledge.js";

const NEARBY_RADIUS = 8;
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
  const nearbyEntities = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && pos && e.position.distanceTo(pos) <= NEARBY_RADIUS)
    .map((e) => ({
      type: e.name ?? e.username ?? "unknown",
      distance: Number(e.position.distanceTo(pos).toFixed(2)),
      engageStyle: classifyMob(e.name),
    }));

  const hostileCount = nearbyEntities.filter((e) => e.engageStyle !== "neutral_ignore").length;
  const items = bot.inventory?.items() ?? [];

  return {
    health: bot.health,
    food: bot.food,
    foodStatus: {
      value: bot.food,
      urgent: bot.food != null && bot.food <= FOOD_URGENT_THRESHOLD,
      low: bot.food != null && bot.food <= FOOD_LOW_THRESHOLD,
    },
    position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    timeOfDay: bot.time?.timeOfDay ?? null,
    isNight: isNightTime(bot.time?.timeOfDay),
    isRaining: bot.isRaining ?? false,
    nearbyEntities,
    hostileCount,
    surroundedByHostiles: hostileCount >= SURROUNDED_THRESHOLD,
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
        "現在の状況(HP/満腹度/周辺の敵性エンティティとその種別/夜間かどうか/装備/直近の行動履歴/" +
        "周辺地形の安全性/拠点からの距離)に最も適した行動を選んでください。" +
        "地形が安全でない場合は移動を伴う行動を避けてください。",
      criteria: {
        explore: "周辺に脅威がなく、満腹度も十分にあり、地形も安全な場合",
        flee:
          "体力が10以下の場合、近くにクリーパーがいる場合、または敵性エンティティに3体以上囲まれている場合。" +
          "体力が低いまま戦闘を続けるのは避けるべき",
        attack_nearest_hostile:
          "体力が15以上に余裕があり、近くに敵性エンティティ(クリーパー・エンダーマンを除く)が" +
          "1〜2体のみいる場合。剣を装備できるとなお良い。体力が低下してきたら戦闘を継続せずfleeに切り替えるべき",
        eat: "満腹度が17以下で機会があり脅威が近くにない場合。満腹度が6以下の場合は最優先で行うこと",
        mine_nearest_ore:
          "周辺に採掘可能な鉱石があり、そのY座標が対象鉱石に適しており" +
          "(石炭はY136付近、鉄はY16付近、ダイヤ・レッドストーンはY-58付近)、" +
          "十分なツールを持ち、脅威がない場合",
        place_block: "足場や防御のためにブロックを設置する必要があり、設置可能なブロックアイテムを持っている場合",
        return_to_base: "拠点から離れすぎており、緊急の脅威がない場合",
        idle: "特に行動する必要がない場合",
      },
    },
  ];
}
