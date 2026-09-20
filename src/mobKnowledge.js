// Minecraft攻略知識(Web調査で得た知見)を静的データとしてまとめたファイル。
// ロジックを持たず、参照データと純粋関数のみを提供する。

// Mob名 -> 交戦方針。攻撃対象選定・flee判断・武器選択の材料にする。
export const HOSTILE_MOB_PROFILES = {
  zombie: { engageStyle: "melee_ok", note: "単体なら弱い。スプリント接近が有効" },
  husk: { engageStyle: "melee_ok", note: "ゾンビ系。空腹効果に注意" },
  creeper: { engageStyle: "avoid_melee", note: "近接厳禁、即flee対象" },
  skeleton: { engageStyle: "ranged_threat", note: "遠距離が脅威。遮蔽物か盾が必要" },
  stray: { engageStyle: "ranged_threat", note: "遅効性の矢を放つ。スケルトン同様の対応" },
  enderman: { engageStyle: "neutral_ignore", note: "視線を合わせなければ中立" },
  spider: { engageStyle: "melee_ok", note: "壁を登れるが単体では脅威度は低め" },
};

// 未登録のMobは既定でmelee_ok(通常の近接戦闘可能)として扱う。
export function classifyMob(name) {
  return HOSTILE_MOB_PROFILES[name]?.engageStyle ?? "melee_ok";
}

// 食料: 調理済みを優先(満腹度回復量が高いため)。生食料は次点。
const COOKED_FOOD_PATTERN =
  /^(cooked_beef|cooked_porkchop|cooked_chicken|cooked_mutton|cooked_rabbit|bread|baked_potato|golden_apple)$/;
const RAW_FOOD_PATTERN = /^(apple|beef|porkchop|chicken|mutton|rabbit|potato|carrot)$/;

// インベントリのアイテム一覧から最も優先すべき食料を選ぶ(調理済み優先)。
export function selectBestFood(items) {
  const cooked = items.find((i) => COOKED_FOOD_PATTERN.test(i.name));
  if (cooked) return cooked;
  return items.find((i) => RAW_FOOD_PATTERN.test(i.name)) ?? null;
}

// 道具の性能順(木<石<鉄<ダイヤ<ネザライト)。pickaxe/sword共通で使う。
export const TOOL_TIER_ORDER = ["wooden", "stone", "iron", "diamond", "netherite"];

// インベントリから指定サフィックス(例: "_pickaxe", "_sword")の道具のうち
// 最も性能の高いものを選ぶ。
export function selectBestByTier(items, suffix) {
  const candidates = items.filter((i) => i.name.endsWith(suffix));
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      TOOL_TIER_ORDER.findIndex((t) => b.name.startsWith(t)) -
      TOOL_TIER_ORDER.findIndex((t) => a.name.startsWith(t))
  );
  return candidates[0];
}

// 鉱石ごとの最適Y座標範囲(Minecraft 1.18以降の新しい地形生成基準)。
export const ORE_Y_RANGES = {
  coal_ore: { min: 0, max: 320, optimal: 136 },
  iron_ore: { min: -24, max: 256, optimal: 16 },
  copper_ore: { min: -16, max: 112, optimal: 48 },
  gold_ore: { min: -64, max: 32, optimal: -16 },
  diamond_ore: { min: -64, max: 16, optimal: -58 },
  redstone_ore: { min: -64, max: 16, optimal: -58 },
  lapis_ore: { min: -64, max: 64, optimal: 0 },
  emerald_ore: { min: -16, max: 320, optimal: 236 },
};

// 指定Y座標が鉱石の最適範囲にどれだけ適しているかを0〜1のスコアで返す。
// 範囲外なら0、optimalに近いほど1に近づく。
export function evaluateOreYFitness(oreName, y) {
  const range = ORE_Y_RANGES[oreName];
  if (!range || y == null) return 0.5; // 未知の鉱石/Y不明は中立スコア
  if (y < range.min || y > range.max) return 0;
  const span = Math.max(range.max - range.optimal, range.optimal - range.min, 1);
  const distance = Math.abs(y - range.optimal);
  return Math.max(0, 1 - distance / span);
}

// 夜間判定(Minecraftのtick基準。13000〜23000を夜とする)。
export function isNightTime(timeOfDay) {
  return timeOfDay != null && timeOfDay >= 13000 && timeOfDay <= 23000;
}
