# Minecraft-JefPlay

Jev(TypeSafe AI "System One")を使った Minecraft 自動操作の PoC 環境。

## 前提(事実と推測の分離)

- **事実**: Mineflayer / mineflayer-pathfinder / prismarine-viewer は実在し広く使われているOSSで、この構成はそのまま動作する。
- **事実**: 「Jev」「TypeSafe AI」「System One」は実在するAPIで、公式ドキュメント(`docs.typesafe.ai`、Claude Codeの`typesafe-ai`スキル経由で確認)通りの仕様で実装済み。実際にMinecraft LANワールド + 実APIキーで接続・判断・行動がエラーなく動作することを確認済み(2026-09-19)。
- `JEV_API_KEY` が未設定の場合は `src/jevClient.js` がモックモード(ランダム応答)で動作し、Mineflayer側の疎通確認だけは実APIなしでも行える。

## 構成

```
src/
  index.js         bot接続・pathfinder/viewerの初期化・エントリポイント
  state.js         周辺ブロック/エンティティ/プレイヤー状態の観測とquestions組み立て
  jevClient.js     Jev(System One) APIクライアント(公式仕様準拠・モックフォールバックあり)
  actions.js       Jevの回答(Choice)をMineflayerの操作にマッピング
  decisionLoop.js  一定周期の観測→判断→検証→実行ループ
```

## セットアップ

### 対応バージョンの制約(重要)

`mineflayer`(正確には内部で使う`minecraft-data`/`node-minecraft-protocol`)は最新のMinecraftリリースに追従するまでタイムラグがある。2026年9月19日時点で判明している対応状況:

| バージョン | protocol | 状態 |
|---|---|---|
| 26.3 | 777 | ❌ 未対応(`Unsupported protocol version '777'`で失敗) |
| 26.2 | 776 | ❌ バージョン一覧には登録済みだが詳細プロトコルデータが未整備(`No data available for version 26.2`で失敗) |
| **26.1.2 / 26.1.1 / 26.1** | 775 | ✅ **動作確認済み**(実機でMinecraft接続・Jev API連携までエラーなく動作) |
| 1.21.11 / 1.21.10 | 774 / 773 | ✅ 動作可能(データ存在を確認済み、実機未検証) |

Xbox Game Pass経由のMinecraftは自動更新されるため、ワールドを起動しているMinecraft本体のバージョンには注意が必要。回避策:

1. Minecraft Launcherの「起動構成(Installations)」タブで新しい構成を作成し、バージョンを **`26.1.2`**(動作確認済み)に指定する
2. その構成で新規にシングルプレイワールドを作成する(新しいバージョンで一度保存したワールドを古いバージョンで開くと警告が出るため、新規ワールド推奨)
3. そのワールドで「LANに公開」する

対応バージョンが更新されたら`npm update`で追従できるか確認すること。

1. Minecraft Java Edition をローカルで起動し、ワールドをLAN公開する(サーバー運営権限は不要)。
2. 依存関係をインストール:
   ```
   npm install
   ```
3. `.env.example` を `.env` にコピーし、接続先やAPIキーを設定:
   ```
   cp .env.example .env
   ```
4. 起動:
   ```
   npm start
   # ブラウザで状況確認したい場合
   npm run viewer
   ```

### `npm run viewer`(ブラウザ可視化)を使う場合の注意

`prismarine-viewer` はネイティブモジュール `canvas` に依存しており、標準の `npm install` には含まれない(`prismarine-viewer`側でdevDependency扱いのため)。`--viewer` を使う場合は追加で:

```
npm install canvas
```

が必要になることがある。Windowsでは `canvas` のビルドに Visual Studio Build Tools(C++ワークロード)が必要になる場合がある。`npm start`(viewerなし)だけならこの依存は不要。

## トラブルシューティング

- **`ECONNREFUSED`**: `.env`の`MC_PORT`が、現在LAN公開しているポート番号と一致していない。ワールドを開き直すたびにポート番号は変わるため、その都度更新が必要。
- **ポートを更新したのに`ECONNREFUSED`が直らない**: PowerShellセッションに古い`$env:MC_PORT`等が環境変数として残っていないか確認(`echo $env:MC_PORT`)。`src/index.js`は`dotenv`を`override: true`で読み込んでいるため`.env`の値が優先されるはずだが、念のため新しいシェルで試すこと。
- **`Unsupported protocol version`または`No data available for version`**: 上記の「対応バージョンの制約」を参照し、`26.1.2`など動作確認済みバージョンを使う。

## 未確認・要検討事項

- APIキーの取得可否・料金プランの最新条件
- 日本からのAPIレイテンシ
- `criteria`の説明文の質によって判断精度が変わるため、実運用では`state.js`のチューニングが必要

## 次のアクション候補

- 長時間稼働させ、explore/flee/attack/eat/idleの各判断が状況に応じて妥当か観察・調整する
- `src/actions.js`の各アクション実装(現状は簡易的な移動・攻撃・採食のみ)を拡充する
