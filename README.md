# Minecraft-JefPlay

Jev(TypeSafe AI "System One")を使った Minecraft 自動操作の PoC 環境。

## 前提(事実と推測の分離)

- **事実**: Mineflayer / mineflayer-pathfinder / prismarine-viewer は実在し広く使われているOSSで、この構成はそのまま動作する。
- **未検証**: 「Jev」「TypeSafe AI」「System One」というAPI・企業、およびそのエンドポイント仕様(`POST https://api.typesafe.ai/v1/systemone` 等)は、本セッションでは外部ドキュメントを確認できていない。参照元の調査メモ自体も「動画の内容と完全一致するとは断定できない」としている。
- そのため `JEV_API_KEY` が未設定の場合、`src/jevClient.js` はモックモード(ランダム応答)で動作し、Mineflayer側の疎通確認だけは実APIなしでも行える。実APIの詳細が判明したら `parseResponse()` を実際のレスポンス形式に合わせて修正すること。

## 構成

```
src/
  index.js         bot接続・pathfinder/viewerの初期化・エントリポイント
  state.js         周辺ブロック/エンティティ/プレイヤー状態の観測とquestions組み立て
  jevClient.js     Jev(System One) APIクライアント(未検証・モックフォールバックあり)
  actions.js       Jevの回答(Choice)をMineflayerの操作にマッピング
  decisionLoop.js  一定周期の観測→判断→検証→実行ループ
```

## セットアップ

### 対応バージョンの制約(重要)

`mineflayer`(正確には内部で使う`minecraft-data`/`node-minecraft-protocol`)は最新のMinecraftリリースに追従するまでタイムラグがある。2026年9月19日時点でnpm最新の`minecraft-data@3.116.0`が対応しているのは **protocol 776(Minecraft 26.2)まで**で、**26.3(protocol 777、2026年9月15日リリース)には未対応**(接続時に `Unsupported protocol version '777'` で失敗する)。

Xbox Game Pass経由のMinecraftは自動更新されるため、ワールドを起動しているMinecraft本体が26.3以降になっている場合は接続できない。回避策:

1. Minecraft Launcherの「起動構成(Installations)」タブで新しい構成を作成し、バージョンを **26.2 以前**(mineflayer対応済み)に指定する
2. その構成で新規にシングルプレイワールドを作成する(26.3で一度保存したワールドを古いバージョンで開くと警告が出るため、新規ワールド推奨)
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

## 未確認・要検討事項

- Jev APIの実際のリクエスト/レスポンス形式(本実装は調査メモからの推測)
- APIキーの取得可否・料金プランの最新条件
- 日本からのAPIレイテンシ

## 次のアクション候補

- TypeSafe AI公式ドキュメント(存在すれば)でAPI仕様を確認し、`src/jevClient.js` の `parseResponse()` を実仕様に合わせる
- 実際にMinecraftワールドをLAN公開してモックモードでの疎通確認
- APIキー取得後、実APIでの応答形式を確認しながら調整
