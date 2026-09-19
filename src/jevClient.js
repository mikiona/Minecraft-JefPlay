// Jev (TypeSafe AI "System One") APIクライアント。
//
// 公式ドキュメント(https://docs.typesafe.ai)で確認した仕様に基づく実装。
// リクエスト: { model, questions: { id: { type, instructions, criteria } }, state }
// レスポンス: { model, answers: { id: { type, choice|score|noul, confidence?, probabilities? } }, usage }
// JEV_API_KEY が未設定の場合はモックモードで動作する。

// リトライ対象のHTTPステータス(429=レート制限、5xx=サーバ側の一時的な不調)。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
// 指数バックオフの待機時間(1回目リトライ前1秒、2回目リトライ前2秒)。
const RETRY_DELAYS_MS = [1000, 2000];
// この回数連続で失敗(リトライ枯渇後の失敗、またはstale応答)するとJevFatalErrorを投げる。
const MAX_CONSECUTIVE_FAILURES = 3;

// Jev APIが連続して応答できない状態を示す致命的エラー。
// 呼び出し側(decisionLoop)はこれを捕捉した場合、単発エラーとは異なりループを停止すべき。
export class JevFatalError extends Error {}

export class JevClient {
  #consecutiveFailures = 0;

  constructor({
    apiKey,
    apiUrl,
    model,
    freshnessMs,
    fetchImpl = fetch,
    sleepImpl = defaultSleep,
    requestTimeoutMs = 10000,
  }) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.model = model;
    this.freshnessMs = freshnessMs;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.mockMode = !apiKey;
  }

  // questions: [{ id, type: 'choice'|'score'|'noul', instructions, criteria }]
  // state: buildState()の出力(HP/food/周辺状況などの構造化データ)
  async ask(questions, state) {
    const requestedAt = Date.now();

    if (this.mockMode) {
      return {
        requestedAt,
        receivedAt: Date.now(),
        answers: this.mockAnswers(questions),
        source: "mock",
      };
    }

    const questionsById = Object.fromEntries(
      questions.map(({ id, ...rest }) => [id, rest])
    );

    let res;
    try {
      res = await this.#fetchWithRetry(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, questions: questionsById, state }),
      });
    } catch (err) {
      this.#recordFailure();
      throw err;
    }

    if (!res.ok) {
      // 422等の場合、レスポンス本文に不正なフィールドの詳細が入っていることが多いため
      // 原因特定のために本文も出力する。
      const errorBody = await res.text().catch(() => "(本文取得失敗)");
      this.#recordFailure();
      throw new Error(`Jev API error: ${res.status} ${res.statusText} - ${errorBody}`);
    }

    const body = await res.json();
    const receivedAt = Date.now();
    const result = {
      requestedAt,
      receivedAt,
      answers: this.parseResponse(body, questions),
      source: "api",
    };

    // stale応答(鮮度切れ)も連続失敗としてカウントする。応答内容自体は
    // 正常でも、判断材料として使えない状態が続いていることに変わりないため。
    if (!this.isFresh(result)) {
      this.#recordFailure();
    } else {
      this.#consecutiveFailures = 0;
    }

    return result;
  }

  // 失敗(リトライ枯渇後のエラー、またはstale応答)を記録し、
  // 一定回数連続したらJevFatalErrorを投げてbot側にループ停止を促す。
  #recordFailure() {
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      throw new JevFatalError(
        `Jev APIが${MAX_CONSECUTIVE_FAILURES}回連続で失敗しました(リトライ後も含む)`
      );
    }
  }

  // 429/5xxとタイムアウトを対象に、指数バックオフで最大3試行(初回+リトライ2回)する。
  async #fetchWithRetry(url, options) {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const res = await this.fetchImpl(url, { ...options, signal: controller.signal });
        if (RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
          lastError = new Error(`Jev API retryable error: ${res.status}`);
          await this.sleepImpl(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.sleepImpl(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw lastError;
  }

  // 応答の鮮度チェック。古い応答は決定ループ側で捨てる。
  isFresh(result) {
    return Date.now() - result.receivedAt <= this.freshnessMs;
  }

  parseResponse(body, questions) {
    // answers: { id: { type, choice|score|noul, confidence?, probabilities? } }
    const answers = body?.answers ?? {};

    return questions.map((q) => {
      const raw = answers[q.id];
      if (!raw) {
        return { id: q.id, type: q.type, value: null, confidence: 0 };
      }

      const validated = validateAnswer(raw, q);
      if (!validated) {
        console.warn(`[jevClient] 不正な応答を破棄しました: id=${q.id}`, raw);
        return { id: q.id, type: q.type, value: null, confidence: 0, invalid: true };
      }

      return {
        id: q.id,
        type: q.type,
        value: raw.choice ?? raw.score ?? raw.noul ?? null,
        confidence: raw.confidence ?? null,
      };
    });
  }

  mockAnswers(questions) {
    return questions.map((q) => {
      if (q.type === "choice") {
        const optionKeys = Object.keys(q.criteria ?? {});
        const value = optionKeys.length
          ? optionKeys[Math.floor(Math.random() * optionKeys.length)]
          : null;
        return { id: q.id, type: q.type, value, confidence: 1 / (optionKeys.length || 1) };
      }
      if (q.type === "score") {
        const levels = Array.isArray(q.criteria) ? q.criteria.length : 5;
        return { id: q.id, type: q.type, value: Math.floor(Math.random() * levels), confidence: 0.5 };
      }
      // noul: yes確率
      return { id: q.id, type: q.type, value: Math.random(), confidence: 0.5 };
    });
  }
}

// choice: criteriaのキーに含まれる値か、confidenceが0-1か、probabilities合計が
// 1.0付近(誤差0.05以内)かを検証する。score/noulは型・範囲のみ検証する。
function validateAnswer(raw, question) {
  if (question.type === "choice") {
    const validKeys = Object.keys(question.criteria ?? {});
    if (!validKeys.includes(raw.choice)) return false;
    if (raw.confidence != null && !isProbability(raw.confidence)) return false;
    if (raw.probabilities) {
      const sum = Object.values(raw.probabilities).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.05) return false;
    }
    return true;
  }
  if (question.type === "score") {
    return typeof raw.score === "number" && Number.isFinite(raw.score);
  }
  if (question.type === "noul") {
    return isProbability(raw.noul);
  }
  return true;
}

function isProbability(value) {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
