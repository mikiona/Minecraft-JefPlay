import { buildState, buildQuestions } from "./state.js";
import { executeAction } from "./actions.js";

// 一定周期でstateを観測 → Jevに質問 → 応答の鮮度/整合性を検証 → 行動実行、を繰り返す。
export function startDecisionLoop(bot, jevClient, { intervalMs }) {
  let stopped = false;
  let lastPosition = null;

  const tick = async () => {
    if (stopped) return;

    try {
      const state = buildState(bot);
      const questions = buildQuestions(state);
      const result = await jevClient.ask(questions);

      if (!jevClient.isFresh(result)) {
        console.warn("[decisionLoop] stale response, skipping");
        return;
      }

      if (!positionPlausible(lastPosition, state.position)) {
        console.warn("[decisionLoop] position jumped unexpectedly, skipping action");
      } else {
        const nextAction = result.answers.find((a) => a.id === "next_action");
        if (nextAction?.value) {
          await executeAction(bot, nextAction.value, state);
        }
      }

      lastPosition = state.position;
    } catch (err) {
      console.error("[decisionLoop] error:", err.message);
    }
  };

  const timer = setInterval(tick, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
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
