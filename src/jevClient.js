// Jev (TypeSafe AI "System One") APIクライアント。
//
// 公式ドキュメント(https://docs.typesafe.ai)で確認した仕様に基づく実装。
// リクエスト: { model, questions: { id: { type, instructions, criteria } }, state }
// レスポンス: { model, answers: { id: { type, choice|score|noul, confidence?, probabilities? } }, usage }
// JEV_API_KEY が未設定の場合はモックモードで動作する。

export class JevClient {
  constructor({ apiKey, apiUrl, model, freshnessMs, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.model = model;
    this.freshnessMs = freshnessMs;
    this.fetchImpl = fetchImpl;
    this.mockMode = !apiKey;
  }

  // questions: [{ id, type: 'choice'|'score'|'noul', prompt, options?, criteria? }]
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

    const res = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, questions: questionsById, state }),
    });

    if (!res.ok) {
      // 422等の場合、レスポンス本文に不正なフィールドの詳細が入っていることが多いため
      // 原因特定のために本文も出力する(実APIの仕様がまだ未検証のため)。
      const errorBody = await res.text().catch(() => "(本文取得失敗)");
      throw new Error(`Jev API error: ${res.status} ${res.statusText} - ${errorBody}`);
    }

    const body = await res.json();
    const receivedAt = Date.now();

    return {
      requestedAt,
      receivedAt,
      answers: this.parseResponse(body, questions),
      source: "api",
    };
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
