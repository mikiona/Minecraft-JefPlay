// bot周辺のブロック/エンティティ/プレイヤー状態を構造化し、
// Jevに投げる質問(questions)を組み立てる。

const NEARBY_RADIUS = 8;

export function buildState(bot) {
  const pos = bot.entity?.position;
  const nearbyEntities = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && pos && e.position.distanceTo(pos) <= NEARBY_RADIUS)
    .map((e) => ({
      type: e.name ?? e.username ?? "unknown",
      distance: Number(e.position.distanceTo(pos).toFixed(2)),
    }));

  return {
    health: bot.health,
    food: bot.food,
    position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    timeOfDay: bot.time?.timeOfDay ?? null,
    isRaining: bot.isRaining ?? false,
    nearbyEntities,
    heldItem: bot.heldItem?.name ?? null,
  };
}

// state から Jev への questions を組み立てる。
// 公式ドキュメント(docs.typesafe.ai)で確認した仕様に基づく:
// choice型は { type, instructions, criteria } の形式。
// criteriaのキーがそのまま選択肢を表し、optionsフィールドは不要。
// 状況データ(HP/food等)は文字列化してinstructionsに埋め込まず、
// リクエストのトップレベルの"state"フィールドとして別送りする。
export function buildQuestions() {
  return [
    {
      id: "next_action",
      type: "choice",
      instructions:
        "現在の状況(HP/food/周辺の敵性エンティティ/天候)に最も適した行動を選んでください",
      criteria: {
        explore: "周辺に脅威がなく、食料も十分にある場合",
        flee: "近くに敵性エンティティがいて体力が低い場合",
        attack_nearest_hostile: "近くに敵性エンティティがいて体力に余裕がある場合",
        eat: "空腹度が低く、脅威が近くにない場合",
        idle: "特に行動する必要がない場合",
      },
    },
  ];
}
