// Minecraft攻略知識(Web調査で得た知見): クラフトによるゲーム進行の
// 優先順位を静的データ・純粋関数としてまとめたファイル。
// 序盤の定石(丸太確保→木のツルハシ→石ツール→かまど→鉄ツール)を
// 決定的なルールとして表現し、Jevには「craft_item」という1つの
// 行動選択のみを委ね、具体的に何を作るかはこちらのロジックで決める
// (mine_nearest_oreの鉱石選定と同じ設計パターン)。
import { TOOL_TIER_ORDER } from "./mobKnowledge.js";

// 丸太のアイテム名パターンと、対応する木材(planks)名への変換。
export const LOG_PATTERN = /_log$/;
export function logToPlanks(logName) {
  return logName.replace(/_log$/, "_planks");
}

function countOf(items, pred) {
  return items.filter(pred).reduce((sum, i) => sum + i.count, 0);
}

function tierIndexOf(item) {
  if (!item) return -1;
  return TOOL_TIER_ORDER.findIndex((t) => item.name.startsWith(t));
}

function bestTierIndex(items, suffix) {
  const candidates = items.filter((i) => i.name.endsWith(suffix));
  if (!candidates.length) return -1;
  return Math.max(...candidates.map(tierIndexOf));
}

// インベントリの状況から、次に作るべきアイテムを1つ判定する。
// 戻り値: { item: string, needsTable: boolean } | null(作るものが無い)
//
// 優先順位(Web調査で確認した定石):
// 1. 作業台(無ければ他の全クラフトが不可能)
// 2. 棒(木のツール作成に必要な中間素材)
// 3. 木のツルハシ(丸石を掘るのに最低限必要)
// 4. 木の剣(初日の生存率に直結)
// 5. 石のツルハシ・石の剣(丸石があれば)
// 6. かまど(鉄精錬に必須)
// 7. 鉄のツルハシ・鉄の剣(鉄インゴットがあれば)
export function determineNextCraftGoal(items, { hasNearbyCraftingTable = false } = {}) {
  const logItem = items.find((i) => LOG_PATTERN.test(i.name));
  const planksCount = countOf(items, (i) => i.name.endsWith("_planks"));
  const stickCount = countOf(items, (i) => i.name === "stick");
  const cobbleCount = countOf(items, (i) => i.name === "cobblestone");
  const ironIngotCount = countOf(items, (i) => i.name === "iron_ingot");

  const hasCraftingTable = items.some((i) => i.name === "crafting_table") || hasNearbyCraftingTable;
  const pickaxeTier = bestTierIndex(items, "_pickaxe");
  const swordTier = bestTierIndex(items, "_sword");
  const hasFurnace = items.some((i) => i.name === "furnace");

  // 0. 丸太を持っていて木材が不足していれば、まず木材に変換する
  //    (丸太1個から木材4個。作業台不要でインベントリのみで作れる)。
  if (logItem && planksCount < 4) {
    return { item: logToPlanks(logItem.name), needsTable: false };
  }

  if (!hasCraftingTable && planksCount >= 4) {
    return { item: "crafting_table", needsTable: false };
  }

  if (!hasCraftingTable) return null; // 作業台が無ければこれ以降は何も作れない

  if (pickaxeTier < 0) {
    if (stickCount < 2 && planksCount >= 2) return { item: "stick", needsTable: false };
    if (planksCount >= 3 && stickCount >= 2) return { item: "wooden_pickaxe", needsTable: true };
    return null; // 木材不足
  }

  if (swordTier < 0) {
    if (stickCount < 1 && planksCount >= 2) return { item: "stick", needsTable: false };
    if (planksCount >= 1 && stickCount >= 1) return { item: "wooden_sword", needsTable: true };
  }

  if (pickaxeTier < 1 && cobbleCount >= 3) {
    if (stickCount < 2 && planksCount >= 2) return { item: "stick", needsTable: false };
    if (stickCount >= 2) return { item: "stone_pickaxe", needsTable: true };
  }

  if (swordTier < 1 && cobbleCount >= 2) {
    if (stickCount < 1 && planksCount >= 2) return { item: "stick", needsTable: false };
    if (stickCount >= 1) return { item: "stone_sword", needsTable: true };
  }

  if (!hasFurnace && cobbleCount >= 8) {
    return { item: "furnace", needsTable: true };
  }

  if (pickaxeTier < 2 && ironIngotCount >= 3) {
    if (stickCount < 2 && planksCount >= 2) return { item: "stick", needsTable: false };
    if (stickCount >= 2) return { item: "iron_pickaxe", needsTable: true };
  }

  if (swordTier < 2 && ironIngotCount >= 2) {
    if (stickCount < 1 && planksCount >= 2) return { item: "stick", needsTable: false };
    if (stickCount >= 1) return { item: "iron_sword", needsTable: true };
  }

  return null;
}

// かまどで精錬すべき素材(名前, 燃料として使えるアイテム名)。
export const SMELTABLE_PATTERN = /^(iron_ore|raw_iron|gold_ore|raw_gold|copper_ore|raw_copper)$/;
export const RAW_MEAT_PATTERN = /^(beef|porkchop|chicken|mutton|rabbit)$/;
export const FUEL_PATTERN = /_planks$|_log$|^coal$|^charcoal$/;
