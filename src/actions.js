// Jevの回答(Choice)をMineflayerのAPI呼び出しにマッピングする。

export async function executeAction(bot, actionName, state) {
  switch (actionName) {
    case "flee":
      return fleeFromNearest(bot, state);
    case "attack_nearest_hostile":
      return attackNearestHostile(bot, state);
    case "eat":
      return eatIfPossible(bot);
    case "explore":
      return exploreRandomly(bot);
    case "idle":
    default:
      bot.pathfinder?.setGoal(null);
      return;
  }
}

function nearestEntity(bot, state) {
  if (!state.nearbyEntities.length) return null;
  const sorted = [...state.nearbyEntities].sort((a, b) => a.distance - b.distance);
  return sorted[0];
}

function fleeFromNearest(bot, state) {
  const target = nearestEntity(bot, state);
  if (!target || !bot.entity?.position) return;
  const away = bot.entity.position.offset(
    (Math.random() - 0.5) * 10,
    0,
    (Math.random() - 0.5) * 10
  );
  moveTo(bot, away);
}

function attackNearestHostile(bot) {
  const target = Object.values(bot.entities).find(
    (e) => e.kind === "Hostile mobs" && e.position
  );
  if (!target) return;
  bot.pvp?.attack(target);
}

async function eatIfPossible(bot) {
  const food = bot.inventory?.items().find((item) => item.name.includes("bread") || item.name.includes("apple"));
  if (!food) return;
  await bot.equip(food, "hand");
  await bot.consume();
}

function exploreRandomly(bot) {
  if (!bot.entity?.position) return;
  const target = bot.entity.position.offset(
    (Math.random() - 0.5) * 20,
    0,
    (Math.random() - 0.5) * 20
  );
  moveTo(bot, target);
}

function moveTo(bot, position) {
  const { goals } = bot.pathfinderGoals ?? {};
  if (!goals) return;
  bot.pathfinder.setGoal(new goals.GoalNear(position.x, position.y, position.z, 1));
}
