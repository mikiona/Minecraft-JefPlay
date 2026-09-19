// Jev (TypeSafe AI "System One") APIクライアント。
//
// 注意: このクライアントが送受信するJSON形式は、調査メモに記載された
// 仕様(エンドポイント/認証方式/Choice・Score・Noulという3種の質問形式)を
// もとに組み立てた推測であり、公式ドキュメントで検証したものではない。
// JEV_API_KEY が未設定の場合はモックモードで動作し、Mineflayer側の
// 動作確認だけは実APIなしでも行えるようにしてある。
// 実APIの実際のレスポンス形式が判明したら parseResponse() を合わせて調整すること。

export class JevClient {
  constructor({ apiKey, apiUrl, freshnessMs, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.freshnessMs = freshnessMs;
    this.fetchImpl = fetchImpl;
    this.mockMode = !apiKey;
  }

  // questions: [{ id, type: 'choice'|'score'|'noul', prompt, options? }]
  async ask(questions) {
    const requestedAt = Date.now();

    if (this.mockMode) {
      return {
        requestedAt,
        receivedAt: Date.now(),
        answers: this.mockAnswers(questions),
        source: "mock",
      };
    }

    const res = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ questions }),
    });

    if (!res.ok) {
      throw new Error(`Jev API error: ${res.status} ${res.statusText}`);
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
    // 未検証: 実際のレスポンスキー名が判明したらここを直す。
    const rawAnswers = body?.answers ?? body?.results ?? [];
    const byId = new Map(rawAnswers.map((a) => [a.id, a]));

    return questions.map((q) => {
      const raw = byId.get(q.id);
      if (!raw) {
        return { id: q.id, type: q.type, value: null, confidence: 0 };
      }
      return {
        id: q.id,
        type: q.type,
        value: raw.value ?? raw.choice ?? raw.score ?? raw.probability ?? null,
        confidence: raw.confidence ?? raw.probability ?? null,
      };
    });
  }

  mockAnswers(questions) {
    return questions.map((q) => {
      if (q.type === "choice") {
        const options = q.options ?? [];
        const value = options.length
          ? options[Math.floor(Math.random() * options.length)]
          : null;
        return { id: q.id, type: q.type, value, confidence: 1 / (options.length || 1) };
      }
      if (q.type === "score") {
        return { id: q.id, type: q.type, value: Math.floor(Math.random() * 5) + 1, confidence: 0.5 };
      }
      // noul: yes確率
      return { id: q.id, type: q.type, value: Math.random(), confidence: 0.5 };
    });
  }
}
