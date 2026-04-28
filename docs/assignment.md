# INIAD AI Chat Enhanced 分担書

## 1. 体制

| 役割      | 氏名 | 主な責務                                             |
| --------- | ---- | ---------------------------------------------------- |
| メンバーA | TBF  | フロントエンド（Electron Renderer / UI）             |
| メンバーB | TBF  | Electron Main プロセス / IPC 連携 / チャットサービス |
| メンバーC | TBF  | MCP クライアント / 資料検索                          |

> 本分担書は、実装3名で MVP を完成させるための責務分割を定義する。
> 全員が設計・実装を担当し、レビューは全員で行う。

## 2. 役割定義とタスク

### メンバーA: フロントエンド（Electron Renderer）

**責務**: ユーザインターフェースの実装全般

| タスクID | タスク                                       | 成果物                                      | Week |
| -------- | -------------------------------------------- | ------------------------------------------- | ---- |
| A01      | チャットUI レイアウト実装                    | `src/renderer/components/ChatView.tsx`      | W2   |
| A02      | メッセージ表示コンポーネント                 | `src/renderer/components/MessageBubble.tsx` | W2   |
| A03      | テキスト入力・送信機能                       | `src/renderer/components/ChatInput.tsx`     | W2   |
| A04      | 参照元（Citation）パネルUI                   | `src/renderer/components/CitationPanel.tsx` | W3   |
| A05      | ローディング・エラー状態UI                   | `src/renderer/components/StatusBar.tsx`     | W3   |
| A06      | MCP接続ステータスバー                        | `src/renderer/components/StatusBar.tsx`     | W3   |
| A07      | 設定画面UI実装（APIキー・モデル・MOOCs認証） | `src/renderer/components/SettingsView.tsx`  | W3-4 |
| A08      | 設定画面フォームバリデーション・マスク表示   | `src/renderer/components/SettingsView.tsx`  | W4   |
| A09      | 画面切替（チャット ↔ 設定）トランジション    | `src/renderer/App.tsx`                      | W4   |
| A10      | UIレスポンシブ調整・ポリッシュ               | `src/renderer/index.css`                    | W5   |
| A11      | 手動テスト観点整理・実行                     | テスト観点ドキュメント                      | W5   |

**技術スタック**: React 19, TypeScript, CSS（ダークテーマ）

**依存関係**:

- メンバーB の `preload.ts`（contextBridge API 定義）に依存
- `window.electronAPI` のインターフェースに従って実装

---

### メンバーB: Electron Main / IPC / チャットサービス

**責務**: Main プロセスの制御・IPC 設計・チャットサービス（INIAD API クライアント含む）の統合

| タスクID | タスク                                                             | 成果物                                        | Week |
| -------- | ------------------------------------------------------------------ | --------------------------------------------- | ---- |
| B01      | Electron BrowserWindow 設計・セキュリティ設定                      | `src/main/index.ts`                           | W1-2 |
| B02      | contextBridge（preload.ts）定義・**shared/types/ 型定義管理**      | `src/preload/preload.ts`, `src/shared/types/` | W1-2 |
| B03      | IPC チャネル実装（chat:send, chat:list, chat:clear, app:status）   | `src/main/ipc-handlers.ts`                    | W2   |
| B04      | MCP ステータス通知（mcp:status）実装                               | `src/main/ipc-handlers.ts`                    | W3   |
| B05      | 設定IPC チャネル実装（settings:get, settings:set）                 | `src/main/ipc-handlers.ts`                    | W3   |
| B06      | 設定接続テスト（settings:test-api, settings:test-mcp）実装         | `src/main/ipc-handlers.ts`                    | W4   |
| B07      | エラーレスポンス統一・例外ハンドリング                             | `src/main/ipc-handlers.ts`                    | W4   |
| B08      | アプリ起動シーケンス（MCP初期化・設定読込）                        | `src/main/index.ts`                           | W3-4 |
| B09      | INIAD API クライアント実装（認証・タイムアウト・再試行）           | `src/main/services/iniad-api-client.ts`       | W2   |
| B10      | プロンプト合成ロジック（システムプロンプト + コンテキスト + 質問） | `src/main/services/prompt-composer.ts`        | W2-3 |
| B11      | レスポンス整形（回答テキスト + 参照元抽出）                        | `src/main/services/response-composer.ts`      | W3   |
| B12      | Chat Service 統合（Retrieval → Prompt → API → Response）           | `src/main/services/chat-service.ts`           | W3   |
| B13      | フォールバックロジック実装                                         | `src/main/services/chat-service.ts`           | W3   |
| B14      | SettingsStore 実装（設定の永続化・読込・マスク処理）               | `src/main/services/settings-store.ts`         | W2-3 |
| B15      | エラーパターン一覧作成                                             | ドキュメント                                  | W4   |

**技術スタック**: Node.js, Electron API, IPC, TypeScript, React（Renderer側）, Zod（IPC検証）

**IPC チャネル定義**（設計書 §6.3 準拠）:

| チャネル             | 引数                   | 戻り値                           |
| -------------------- | ---------------------- | -------------------------------- |
| `chat:send`          | `userText: string`     | `ChatResponse`                   |
| `chat:list`          | なし                   | `ChatTurn[]`                     |
| `chat:clear`         | なし                   | `void`                           |
| `app:status`         | なし                   | `AppStatus`                      |
| `mcp:status`（通知） | `status: string`       | なし                             |
| `settings:get`       | なし                   | `AppSettings`（APIキーはマスク） |
| `settings:set`       | `Partial<AppSettings>` | `void`                           |
| `settings:test-api`  | なし                   | `{ success, error? }`            |
| `settings:test-mcp`  | なし                   | `{ success, error? }`            |

**依存関係**:

- メンバーC の `McpClient` インターフェースに依存（ChatService から利用）

---

### メンバーC: MCP クライアント / 資料検索 / Web検索スクレイピング

**責務**: INIAD-MOOCs-MCP サーバとの通信・資料検索・検索エンジンスクレイピングによる一般情報検索

| タスクID | タスク                                                                        | 成果物                                        | Week |
| -------- | ----------------------------------------------------------------------------- | --------------------------------------------- | ---- |
| C01      | MCP クライアント実装（stdio 通信・接続管理・自動起動）                        | `src/main/services/mcp-client.ts`             | W2-3 |
| C02      | MCP ツール呼び出し実装（listCourses, listLectureLinks, listSlideLinks）       | `src/main/services/mcp-client.ts`             | W3   |
| C03      | RetrievalOrchestrator 実装（MCP + Web検索統合）                               | `src/main/services/retrieval-orchestrator.ts` | W3   |
| C04      | 検索結果の整形ロジック（MCP レスポンス → Citation 変換）                      | `src/main/services/retrieval-orchestrator.ts` | W3   |
| C05      | エラー分類・フォールバック判定                                                | `src/main/services/mcp-client.ts`             | W3-4 |
| C06      | Search Client 実装（google-sr による検索スクレイピング）                      | `src/main/services/search-client.ts`          | W3-4 |
| C07      | MCP サーバ設定・起動検証                                                      | 設定ドキュメント・サンプルデータ              | W2   |
| C08      | INIAD-MOOCs-MCP (`@rarandeyo/iniad-moocs-mcp`) の動作確認・セットアップ手順書 | ドキュメント                                  | W1-2 |
| C09      | Playwright (Chromium) セットアップ・初回起動ガイド作成                        | ドキュメント                                  | W1-2 |

**技術スタック**: Node.js, `@modelcontextprotocol/sdk`, `google-sr`, TypeScript

**McpClient インターフェース**（他メンバーとの契約）:

```ts
export class McpClient {
  /**
   * MCP接続初期化
   * @rarandeyo/iniad-moocs-mcp を子プロセスとして自動起動
   */
  async connect(username: string, password: string): Promise<void> {
    // ...
  }

  /**
   * MOOCs資料検索
   */
  async searchMoocs(
    query: string,
  ): Promise<{ success: boolean; results: MoocsResult[]; error?: string }> {
    // ...
  }

  /**
   * 接続状態取得
   */
  getStatus(): "connected" | "disconnected" | "connecting" {
    // ...
  }

  /**
   * 切断
   */
  async disconnect(): Promise<void> {
    // ...
  }
}
```

**依存関係**:

- `@rarandeyo/iniad-moocs-mcp`（v0.0.5-beta.3）パッケージを `package.json` に依存追加
- MCP サーバの起動: `require.resolve("@rarandeyo/iniad-moocs-mcp")` でエントリポイントを解決
- 環境変数: `INIAD_USERNAME`, `INIAD_PASSWORD`（設定画面から SettingsStore 経由で渡す）
- Playwright (Chromium) が必要（`npx playwright install chromium`）

---

## 3. レビュー体制

全メンバーが設計・実装・レビューを担当する。

| 責務                   | 内容                           | 運用                               |
| ---------------------- | ------------------------------ | ---------------------------------- |
| 要件確定               | 機能要件・非機能要件の最終決定 | 全員で議論・合意                   |
| アーキテクチャ判断     | 技術選定・構成変更の判断       | 全員で議論・合意                   |
| 受け入れ基準承認       | AC01〜AC15 の確認・承認        | 全員で確認                         |
| 仕様変更の最終意思決定 | 実装中の仕様不明点の裁定       | 全員で議論・合意                   |
| コードレビュー         | PR レビュー・品質確認          | 実装者以外のメンバーがレビュー担当 |

## 4. 開発プロセス

### 4.1 Git 運用ルール

```text
main          ← 安定版。PR承認後のみマージ
  └── develop ← 開発統合ブランチ
       ├── feature/A-xxx  ← メンバーAの機能ブランチ
       ├── feature/B-xxx  ← メンバーBの機能ブランチ
       └── feature/C-xxx  ← メンバーCの機能ブランチ
```

- **ブランチ命名**: `feature/{担当}-{機能名}`（例: `feature/A-chat-ui`）
- **main 直push 禁止**: 全て PR ベースでレビュー後にマージ
- **コミットメッセージ**: 日本語可、タスクID を含める（例: `A01: チャットUIの基本レイアウトを実装`）

### 4.2 PR レビューフロー

1. 実装者が `feature/*` → `develop` に PR 作成
2. 実装者以外のメンバーがレビュー
3. 必要に応じて修正依頼
4. Approve 後、実装者がマージ
5. 週次タイミングで `develop` → `main` へマージ

### 4.3 コミュニケーション

| 手法                   | 頻度                   | 内容                                   |
| ---------------------- | ---------------------- | -------------------------------------- |
| 週次定例               | 週1回（30〜60分）      | 進捗共有・課題議論・仕様確認           |
| デイリースタンドアップ | 毎日（10分、非同期可） | 昨日の作業・今日の予定・ブロッカー共有 |
| PR レビュー            | 随時                   | コードレビュー・設計確認               |
| Issue 管理             | 随時                   | タスク割当・進捗管理・バグ報告         |

## 5. スケジュール（6週間）

| 週  | マイルストーン    | メンバーA                                                                | メンバーB                                                              | メンバーC                                           |
| --- | ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| W1  | 要件FIX・環境構築 | UI設計・モック作成・**モックRenderer実装（固定データ表示でUI確認可能）** | Electron環境構築・preload定義・**shared/types/ 管理責任**・API仕様確認 | MCP サーバ動作確認・Playwrightセットアップ(C08-C09) |
| W2  | 基本チャット動作  | A01-A03: チャットUI骨格                                                  | B01-B03, B09, B14: Main/IPC骨格・API接続・SettingsStore                | C01, C07: MCP クライアント基盤                      |
| W3  | MCP連携・設定実装 | A04-A07: 参照元・ステータスUI・設定画面UI                                | B04-B05, B08, B10-B13: MCP通知・設定IPC・起動シーケンス・ChatService   | C02-C04: ツール呼出・Orchestrator実装               |
| W4  | 統合・エラー処理  | A08-A09: 設定バリデーション・画面切替                                    | B06-B07, B15: 接続テストIPC・エラーハンドリング                        | C05: エラー分類                                     |
| W5  | テスト・品質向上  | A10-A11: ポリッシュ・テスト                                              | 統合テスト・バグ修正                                                   | C06: スクレイピング実装・バグ修正                   |
| W6  | 安定化・デモ      | デモ準備・エッジケース対応                                               | 安定化・パフォーマンス確認                                             | 安定化・スクレイピング検証                          |

## 6. 依存関係とインターフェース契約

```text
メンバーA (UI)  ←→  メンバーB (Main/IPC/ChatService)
                          ↓                     ↙
                   メンバーC (MCP + Search)   INIAD API
```

### インターフェース合意ポイント（W1で確定必須）

| インターフェース                    | 定義者 | 利用者 | 確定タイミング |
| ----------------------------------- | ------ | ------ | -------------- |
| `window.electronAPI`（preload API） | B      | A      | W1末           |
| `ChatService` メソッド              | B      | A, B   | W1末           |
| `McpClient` メソッド                | C      | B      | W1末           |
| `ChatResponse` / `Citation` 型      | B      | A, C   | W1末           |
| `AppStatus` 型                      | B      | A      | W1末           |
| `AppError` 型                       | B      | A, C   | W1末           |
| `SearchResult` / `MoocsResult` 型   | C      | B      | W1末           |

### インターフェース変更管理プロセス

1. 変更提案者が GitHub Issue で「Interface Change Proposal」を作成
2. 影響するメンバー全員がコメントで同意・懸念を記載
3. 全員の合意を得た上で承認
4. 承認後、shared/types/ の変更を develop にマージし、各メンバーが追従

> **原則**: インターフェース定義の変更は、影響メンバーの同意なしにはマージしない。

## 7. 品質ゲート

| ゲート             | 基準                                       | タイミング |
| ------------------ | ------------------------------------------ | ---------- |
| 結合テスト通過     | A+B+C の成果物が統合して基本チャットが動作 | W4末       |
| 受け入れテスト通過 | AC01〜AC15 の全項目を満たす                | W5末       |
| デモ可能状態       | 全メンバーのデモ操作でクラッシュしない     | W6         |

**develop → main マージゲート**:

| 条件                           | 確認方法           |
| ------------------------------ | ------------------ |
| 全 AC 項目がパス               | テストレポート確認 |
| `npm run test:coverage` が通過 | CI 自動実行        |
| `npm audit` で高危険度が 0 件  | CI 自動実行        |
| 全メンバーの Approve           | PR レビュー        |

## 8. リスク分担

| リスク                                 | 主担当     | サポート     |
| -------------------------------------- | ---------- | ------------ |
| INIAD API 側障害・仕様変更             | メンバーB  | 全メンバー   |
| MCP Server の不具合・仕様不明          | メンバーC  | 全メンバー   |
| 検索スクレイピングの規約抵触・ブロック | メンバーC  | 全メンバー   |
| UI の表示崩れ・UX 問題                 | メンバーA  | メンバーB    |
| IPC 連携不具合                         | メンバーB  | メンバーA, C |
| 仕様衝突・判断が必要な事項             | 全メンバー | —            |
| メンバー欠席（病欠・就活等）           | 全メンバー | —            |

**メンバー欠席リスク対策**:

- 各メンバーは担当モジュールのキー情報を Wiki/README に常時更新
- 欠席時は他メンバーが代替作業可能な粒度でタスクを分割
- 全員が設計・実装を把握する共有体制を維持

## 9. 共通ルール

- **コーディング規約**: TypeScript strict モード、ESLint 推奨設定に従う
- **型定義**: 公開関数には必ず TypeScript の型アノテーションを記述
- **エラー処理**: 非同期処理は必ず try-catch で囲む
- **秘密情報**: コミットに `.env` や API キーを含めない
- **設定管理**: APIキー・パスワードは `SettingsStore` で管理、Renderer にはマスク値のみ送信
- **依存パッケージ追加**: 追加前に全メンバーに相談
