// bot判断の状況をJSON Lines形式でファイルに追記する軽量ロガー。
// 後から(人間またはClaude自身が)ログファイルを直接読んで、その時々の
// 周辺状況・判断・実行結果を時系列で確認できるようにするための仕組み。
// コンソールログは要約のみだが、こちらは診断に必要な詳細を全て残す。
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class DecisionLogger {
  constructor({ filePath } = {}) {
    this.filePath = filePath || null;
    this.ready = this.filePath ? this.#ensureDir() : Promise.resolve();
  }

  async #ensureDir() {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
    } catch {
      // ディレクトリ作成に失敗してもログ機能自体は握りつぶして継続する。
    }
  }

  // 1件のイベントをJSON Lines形式で追記する。filePath未設定なら何もしない。
  async log(event) {
    if (!this.filePath) return;
    await this.ready;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + "\n";
    try {
      await appendFile(this.filePath, line, "utf8");
    } catch (err) {
      // ログ書き込み失敗でbot本体の動作を止めないよう、コンソールにのみ警告する。
      console.warn("[logger] ログ書き込みに失敗しました:", err.message);
    }
  }
}
