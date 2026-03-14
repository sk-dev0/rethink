# a
ハッカソンチーム: A*

## 使用する技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | HTML / CSS / Bootstrap / JavaScript |
| バックエンド | Node.js / Express |
| デプロイ | Vercel / Google Cloud Run |

---



## ディレクトリ構成（例）

```
rethink/
├── frontend/
│   ├── index.html          # 画面1: セッション作成 or 招待URL入力による参加選択
│   ├── lobby.html          # 画面2: 参加者待機・ホストによる議題設定・スタート操作
│   ├── dialogue.html       # 画面3: 各参加者とAIの1対1対話（情報収集フェーズ）
│   ├── loading.html        # 画面4: 代弁者エージェント生成中のローディング表示
│   ├── debate.html         # 画面5: エージェント間のAI討論をリアルタイム表示
│   ├── result.html         # 画面6: 対立軸・問い・マインドマップデータの提示
│   ├── css/
│   │   └── style.css       # 全画面共通スタイル
│   └── js/
│       ├── api.js          # バックエンドへのfetchリクエスト共通ラッパー
│       ├── lobby.js        # 参加者リストのポーリング・スタートボタン制御
│       ├── dialogue.js     # 1対1対話のSSE受信・チャットUI制御
│       ├── debate.js       # AI討論のSSE受信・発言ログ表示・中間提示UI制御
│       └── result.js       # 結果データの受信・対立軸とマインドマップの描画
│
├── backend/
│   ├── server.js           # Expressサーバー起動・ルーティング登録・ミドルウェア設定
│   ├── store.js            # インメモリによるセッション・参加者・議論ログの一時管理
│   ├── routes/
│   │   ├── session.js      # セッション作成・招待URL発行・参加者登録・状態取得のエンドポイント
│   │   └── debate.js       # 対話開始・エージェント生成・討論起動・結果取得・SSEエンドポイント
│   ├── services/
│   │   ├── geminiClient.js     # Vertex AI（@google/genai）の初期化・API呼び出しラッパー
│   │   ├── dialogueService.js  # 1対1対話の進行制御（ターン管理・終了条件判定）
│   │   ├── agentService.js     # 対話ログから代弁者エージェント定義を生成するロジック
│   │   ├── debateEngine.js     # エージェント間討論のターン制御・ハードリミット強制終了
│   │   ├── moderatorService.js # 意味的乖離スコアによる分岐点検出・司会エージェント呼び出し
│   │   └── resultService.js    # 討論ログから対立軸・合意点・問いを構造化して抽出
│
```



## ブランチの命名規則

| ブランチ名 | 機能 | 派生元 | マージ先 | 補足 |
|---|---|---|---|---|
| `main` | 本番・公開用ブランチ（常に動く状態を保つ） | - | - | 直接コミット禁止 |
| `develop` | 統合ブランチ（全員の変更が集まる場所） | `main` | `main` | - |
| `develop-*` | 個人・機能単位の作業ブランチ | `develop` | `develop` | `*`は任意文字 |
| `fix-*` | `main`で見つかったエラー・バグを直す | `main` | `main`, `develop` | `*`は任意文字 |

### フロー概要

```
main
 └─ develop                  # 統合ブランチ
     ├─ develop-login        # 例: ログイン機能の開発
     ├─ develop-review       # 例: レビュー機能の開発
     └─ develop-keigo        # 例: 個人作業ブランチ

main
 └─ fix-header-crash         # 例: mainで見つかったバグの修正
```

### ルール
- `main`への直接プッシュは絶対に禁止。必ずdevelopからPull Requestを経由すること。
- `develop`への直接プッシュは絶対に禁止。必ずPull Requestを経由すること。
- `develop-*`は作業完了後、`develop`にPull Requestを出してマージする。
- `fix-*`はマージ後、`main`と`develop`の両方に反映すること。
- ブランチ名は英小文字・ハイフン区切りで統一する（例: `develop-user-auth`）。

