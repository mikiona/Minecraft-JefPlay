import "dotenv/config";
import mineflayer from "mineflayer";
// mineflayer-pathfinderはCommonJSモジュールで、Nodeの静的解析が
// 名前付きexportを全て検出できないため、default importから取り出す。
import pathfinderPkg from "mineflayer-pathfinder";
const { pathfinder, Movements, goals } = pathfinderPkg;
import { JevClient } from "./jevClient.js";
import { startDecisionLoop } from "./decisionLoop.js";

const config = {
  host: process.env.MC_HOST ?? "localhost",
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USERNAME ?? "JevBot",
  version: process.env.MC_VERSION || undefined,
  decisionIntervalMs: Number(process.env.DECISION_INTERVAL_MS ?? 250),
  freshnessMs: Number(process.env.RESPONSE_FRESHNESS_MS ?? 5000),
  jevApiKey: process.env.JEV_API_KEY || null,
  jevApiUrl: process.env.JEV_API_URL ?? "https://api.typesafe.ai/v1/systemone",
  // 公式ドキュメント(docs.typesafe.ai)確認済み: 推奨モデル名は"jev-latest"。
  jevModel: process.env.JEV_MODEL || "jev-latest",
  viewerPort: Number(process.env.VIEWER_PORT ?? 3000),
  enableViewer: process.argv.includes("--viewer"),
};

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version,
});

bot.loadPlugin(pathfinder);
// actions.js から参照するための簡易アクセサ。
bot.pathfinderGoals = { goals };

const jevClient = new JevClient({
  apiKey: config.jevApiKey,
  apiUrl: config.jevApiUrl,
  model: config.jevModel,
  freshnessMs: config.freshnessMs,
});

if (jevClient.mockMode) {
  console.warn(
    "[index] JEV_API_KEY が未設定のため Jev API はモックモードで動作します(ランダム応答)。"
  );
}

bot.once("spawn", () => {
  const movements = new Movements(bot);
  bot.pathfinder.setMovements(movements);

  if (config.enableViewer) {
    // prismarine-viewerはネイティブモジュール`canvas`に依存するため、
    // --viewer指定時のみ動的にロードする(未使用時はcanvas不要にするため)。
    import("prismarine-viewer")
      .then(({ mineflayer: mineflayerViewer }) => {
        mineflayerViewer(bot, { port: config.viewerPort });
        console.log(`[index] prismarine-viewer: http://localhost:${config.viewerPort}`);
      })
      .catch((err) => {
        console.error(
          "[index] prismarine-viewerの読み込みに失敗しました。`npm install canvas` が必要な場合があります:",
          err.message
        );
      });
  }

  console.log(`[index] ${config.username} spawned. decision loop starting...`);
  const loop = startDecisionLoop(bot, jevClient, {
    intervalMs: config.decisionIntervalMs,
  });

  bot.once("end", () => loop.stop());
});

bot.on("kicked", (reason) => console.error("[index] kicked:", reason));
bot.on("error", (err) => console.error("[index] error:", err));
bot.on("end", (reason) =>
  console.log(
    `[index] disconnected (reason: ${reason ?? "unknown"}). 接続直後に切れる場合はMC_VERSIONが実際のゲームバージョンと一致しているか確認してください。`
  )
);
