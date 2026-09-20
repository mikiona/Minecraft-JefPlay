import { buildState, buildQuestions } from "./state.js";
import { executeAction } from "./actions.js";
import { JevFatalError } from "./jevClient.js";
import { CooldownTracker } from "./cooldown.js";

// 同一actionがこのtick数以上連続したら停滞とみなし警告する(既定: 250ms×120=30秒相当)。
const STUCK_ACTION_TICKS = 120;
// 位置がこの時間(ms)以上ほぼ変化しなければ停滞とみなし警告する。
const STUCK_POSITION_MS = 30000;
// 位置が変化したとみなす最小移動量(ブロック)。
const POSITION_MOVE_THRESHOLD = 0.5;
// 直近何件の行動履歴をstateに含めてJevに渡すか。
const HISTORY_LIMIT = 8;
// このHP以下になったらJevの応答を待たずに即座に緊急離脱(flee)する既定閾値。
const DEFAULT_EMERGENCY_HEALTH_THRESHOLD = 6;

// 一定周期でstateを観測 → Jevに質問 → 応答の鮮度/整合性を検証 → 行動実行、を繰り返す。
// homePosition未指定時は、最初に観測できた位置を拠点として自動記録する。
export function startDecisionLoop(
  bot,
  jevClient,
  { intervalMs, cooldownMs, homePosition = null, emergencyHealthThreshold } = {}
) {
  const healthThreshold = emergencyHealthThreshold ?? DEFAULT_EMERGENCY_HEALTH_THRESHOLD;
  let stopped = false;
  let lastPosition = null;
  let lastLoggedAction = null;
  let home = homePosition;

  // 停滞watchdog用の状態。
  let sameActionStreak = 0;
  let lastActionForStreak = null;
  let lastMovedAt = Date.now();
  let lastCheckedPosition = null;

  // 直近の行動履歴(Jevへの判断材料として使う)。
  const actionHistory = [];
  const cooldown = new CooldownTracker(cooldownMs != null ? { durationMs: cooldownMs } : undefined);

  const recordHistory = (action, result) => {
    actionHistory.push({ action, result, timestamp: Date.now() });
    if (actionHistory.length > HISTORY_LIMIT) actionHistory.shift();
  };

  const checkStuck = (actionName, position) => {
    if (actionName === lastActionForStreak) {
      sameActionStreak++;
    } else {
      sameActionStreak = 1;
      lastActionForStreak = actionName;
    }
    if (sameActionStreak === STUCK_ACTION_TICKS) {
      console.warn(`[decisionLoop] watchdog: 同一action(${actionName})が${STUCK_ACTION_TICKS}tick連続しています`);
    }

    if (position && lastCheckedPosition) {
      const dx = position.x - lastCheckedPosition.x;
      const dy = position.y - lastCheckedPosition.y;
      const dz = position.z - lastCheckedPosition.z;
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz) >= POSITION_MOVE_THRESHOLD;
      if (moved) {
        lastMovedAt = Date.now();
      } else if (Date.now() - lastMovedAt >= STUCK_POSITION_MS) {
        console.warn(`[decisionLoop] watchdog: 位置が${STUCK_POSITION_MS / 1000}秒以上変化していません`);
        lastMovedAt = Date.now(); // 連続警告を避けるためリセット
      }
    }
    lastCheckedPosition = position;
  };

  const tick = async () => {
    if (stopped) return;

    try {
      const observedPosition = bot.entity?.position;
      if (!home && observedPosition) {
        home = { x: observedPosition.x, y: observedPosition.y, z: observedPosition.z };
        console.log(`[decisionLoop] 拠点座標を記録しました: (${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)})`);
      }

      const state = buildState(bot, { actionHistory, homePosition: home });

      // 緊急回避: HPが危険域まで下がっている場合、Jev API呼び出しの応答を
      // 待たず直ちにfleeを実行する。APIレイテンシに関係なく即応するための
      // ローカルの安全装置(通常フローとは独立に、このtickの先頭で割り込む)。
      if (bot.health != null && bot.health <= healthThreshold) {
        console.warn(
          `[decisionLoop] 緊急回避: HP=${bot.health}が閾値(${healthThreshold})以下のため、Jev応答を待たずfleeを実行します`
        );
        let emergencyResult;
        try {
          emergencyResult = await executeAction(bot, "flee", state, { cooldown });
        } catch (err) {
          emergencyResult = { ok: false, reason: err.message };
        }
        recordHistory("flee", emergencyResult?.ok ? "ok" : "failed");
        checkStuck("flee", state.position);
        lastPosition = state.position;
        return;
      }

      const questions = buildQuestions();
      const result = await jevClient.ask(questions, state);

      if (!jevClient.isFresh(result)) {
        console.warn("[decisionLoop] stale response, skipping");
        return;
      }

      if (!positionPlausible(lastPosition, state.position)) {
        console.warn("[decisionLoop] position jumped unexpectedly, skipping action");
      } else {
        const nextAction = result.answers.find((a) => a.id === "next_action");
        if (nextAction?.value) {
          if (nextAction.value !== lastLoggedAction) {
            console.log(
              `[decisionLoop] action=${nextAction.value} confidence=${nextAction.confidence} source=${result.source}`
            );
            lastLoggedAction = nextAction.value;
          }

          let actionResult;
          try {
            actionResult = await executeAction(bot, nextAction.value, state, { cooldown });
          } catch (err) {
            actionResult = { ok: false, reason: err.message };
          }
          recordHistory(nextAction.value, actionResult?.ok ? "ok" : "failed");
          checkStuck(nextAction.value, state.position);
        }
      }

      lastPosition = state.position;
    } catch (err) {
      if (err instanceof JevFatalError) {
        console.error("[decisionLoop] 致命的エラー、ループを停止します:", err.message);
        stop();
        return;
      }
      console.error("[decisionLoop] error:", err.message);
    }
  };

  const timer = setInterval(tick, intervalMs);

  function stop() {
    stopped = true;
    clearInterval(timer);
  }

  return { stop };
}

// 直前の観測位置から大きく飛んでいたら、古い/不整合な状態として扱う。
function positionPlausible(prev, current) {
  if (!prev || !current) return true;
  const dx = current.x - prev.x;
  const dy = current.y - prev.y;
  const dz = current.z - prev.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return distance < 50;
}
