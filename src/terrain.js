// bot周辺の地形を前後左右4方向×1-4ブロックの範囲でサンプリングし、
// explore/flee等の移動判断の材料にする。

const DIRECTIONS = [
  { name: "north", dx: 0, dz: -1 },
  { name: "south", dx: 0, dz: 1 },
  { name: "east", dx: 1, dz: 0 },
  { name: "west", dx: -1, dz: 0 },
];

const MAX_DISTANCE = 4;

// 接触すると危険なブロック。足元・一段下にあればhazard判定する。
const HAZARD_BLOCKS = new Set(["lava", "fire", "cactus", "magma_block"]);
// 水は boundingBox が "empty" (=通常の空気と同じ判定)になるため、
// 専用の分類をしないと explore/flee が平気で水中へ突っ込んでしまう
// (実際にbotが水から出られなくなる事例が発生した)。
const WATER_BLOCKS = new Set(["water"]);

// bot.blockAt() で各方向・各距離の地形を分類し、{ samples, isSafe } を返す。
// bot.entity.position が取得できない場合はnullを返す。
export function sampleTerrain(bot) {
  const origin = bot.entity?.position;
  if (!origin) return null;

  const samples = {};
  let isSafe = true;

  for (const dir of DIRECTIONS) {
    samples[dir.name] = [];
    for (let dist = 1; dist <= MAX_DISTANCE; dist++) {
      const footPos = origin.offset(dir.dx * dist, 0, dir.dz * dist);
      const classification = classifyColumn(bot, footPos);
      samples[dir.name].push(classification);
      if (classification === "hazard") isSafe = false;
    }
  }

  return { samples, isSafe };
}

// 指定位置の足元(feet)/頭上(head)/一段下(below)/頭上のさらに上(aboveHead)を見て、
// clear/blocked/hazard/water/one_block_rise/drop_or_no_floor/unknown のいずれかに分類する。
function classifyColumn(bot, footPos) {
  const feet = bot.blockAt(footPos);
  const head = bot.blockAt(footPos.offset(0, 1, 0));
  const below = bot.blockAt(footPos.offset(0, -1, 0));
  const aboveHead = bot.blockAt(footPos.offset(0, 2, 0));

  if (!feet || !below) return "unknown";
  if (HAZARD_BLOCKS.has(feet.name) || HAZARD_BLOCKS.has(below.name)) return "hazard";
  if (WATER_BLOCKS.has(feet.name) || WATER_BLOCKS.has(below.name)) return "water";

  const isEmpty = (block) => !block || block.boundingBox === "empty";

  if (isEmpty(feet) && isEmpty(below)) return "drop_or_no_floor";
  if (!isEmpty(feet) && !isEmpty(head)) return "blocked";
  if (isEmpty(feet) && !isEmpty(below)) {
    return isEmpty(head) ? "clear" : "blocked";
  }
  if (!isEmpty(feet) && isEmpty(head) && isEmpty(aboveHead)) {
    return "one_block_rise";
  }
  return "unknown";
}
