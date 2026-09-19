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
// 最大20個程度という制約(メモ記載)を意識し、ここでは代表的な
// 「次に何をするか」の1問(Choice)に絞った最小構成にしている。
export function buildQuestions(state) {
  const options = ["explore", "flee", "attack_nearest_hostile", "eat", "idle"];

  return [
    {
      id: "next_action",
      type: "choice",
      prompt: buildPrompt(state),
      options,
    },
  ];
}

function buildPrompt(state) {
  return [
    `HP=${state.health}`,
    `food=${state.food}`,
    `nearby=${state.nearbyEntities.length}`,
    `raining=${state.isRaining}`,
  ].join(" ");
}
