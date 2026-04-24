# INIAD AI Chat Enhanced

INIAD（東洋大学 情報連携学部）の学生向けに、MOOCs 講義資料等に基づく高精度な回答ができるチャットアプリケーション。Electron + TypeScript で構築されています。

## 機能概要

- INIAD API（OpenAI 互換）を利用したチャット
- MCP 経由での MOOCs 講義資料検索・参照
- 参照元（Citation）の表示
- 設定画面（APIキー・モデル・MOOCs 認証情報）
- フォールバック（MCP 未接続時もプレーン会話可能）
- Web 検索（google-sr によるスクレイピング）

## 必要環境

| 要件    | バージョン              |
| ------- | ----------------------- |
| Node.js | 18 以上                 |
| npm     | 9 以上                  |
| OS      | Windows / macOS / Linux |

## クイックスタート

### 1. リポジトリをクローン

```bash
git clone https://github.com/Ryosuke-Asano/iniad-ai-chat-enhanced.git
cd iniad-ai-chat-enhanced
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. 開発サーバーを起動

```bash
npm start
```

Electron ウィンドウが立ち上がれば成功です。

## NPM Scripts

| コマンド          | 内容                           |
| ----------------- | ------------------------------ |
| `npm start`       | 開発用に Electron アプリを起動 |
| `npm run package` | 実行可能パッケージを生成       |
| `npm run make`    | インストーラー/配布物を生成    |
| `npm run lint`    | Lint 実行（現在は未設定）      |

## プロジェクト構成

```
iniad-ai-chat-enhanced/
├── docs/
│   ├── design.md        # 詳細設計書
│   ├── assignment.md    # タスク割当表
│   └── proposal.md      # 提案書
├── src/
│   ├── index.js         # Main プロセス
│   ├── preload.js       # Preload スクリプト
│   ├── index.html       # Renderer HTML
│   └── index.css        # スタイル
├── forge.config.js      # electron-forge 設定
└── package.json
```

## ドキュメント

- [提案書](docs/proposal.md) — プロジェクトの背景・目的・技術選定
- [詳細設計書](docs/design.md) — アーキテクチャ・API・セキュリティ設計
- [タスク割当表](docs/assignment.md) — メンバー別タスク・スケジュール

## ライセンス

MIT
