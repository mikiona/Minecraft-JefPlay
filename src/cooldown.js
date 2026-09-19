// 失敗した行動対象(ブロック位置やエンティティIDなどの文字列キー)を
// 一定時間再試行しないための単純なクールダウン管理。

export class CooldownTracker {
  constructor({ durationMs = 35000 } = {}) {
    this.durationMs = durationMs;
    this.entries = new Map(); // key -> 解除時刻(ms)
  }

  isOnCooldown(key) {
    const until = this.entries.get(key);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  markFailed(key) {
    this.entries.set(key, Date.now() + this.durationMs);
  }
}
