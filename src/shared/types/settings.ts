/**
 * 設定関連の共通型定義
 * SettingsStore と設定画面で使用する型
 */

/** アプリケーション設定 */
export interface AppSettings {
  /** INIAD API キー（設定画面ではマスク表示） */
  apiKey: string;
  /** API ベースURL */
  baseURL: string;
  /** デフォルトモデル名 */
  model: string;
  /** INIAD MOOCs ユーザー名（学籍番号） */
  moocsUsername: string;
  /** INIAD MOOCs パスワード（設定画面ではマスク表示） */
  moocsPassword: string;
}

/** AppSettings のデフォルト値 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  baseURL: "https://api.openai.iniad.org/api/v1",
  model: "gpt-5.4-nano",
  moocsUsername: "",
  moocsPassword: "",
};

/** MCP 接続状態 */
export type McpStatus = "connected" | "disconnected" | "connecting";

/** アプリケーション全体のステータス（app:status で返却） */
export interface AppStatus {
  /** MCP 接続状態 */
  mcpStatus: McpStatus;
  /** 現在使用中のモデル名 */
  model: string;
  /** API キーが設定済みか */
  hasApiKey: boolean;
}

/** 設定保存時の部分更新用（空文字列は既存値を維持） */
export type PartialAppSettings = Partial<AppSettings>;

/** 接続テスト結果 */
export interface ConnectionTestResult {
  success: boolean;
  error?: string;
}
