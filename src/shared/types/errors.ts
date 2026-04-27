/**
 * エラー関連の共通型定義
 * アプリ全体で統一的に使用するエラー型
 */

/** エラーコードの種別 */
export type ErrorCode =
  | "INVALID_RESPONSE"
  | "API_KEY_MISSING"
  | "API_REQUEST_FAILED"
  | "MCP_CONNECTION_FAILED"
  | "MCP_TIMEOUT"
  | "MCP_AUTH_FAILED"
  | "PLAYWRIGHT_NOT_INSTALLED"
  | "SEARCH_NO_RESULTS"
  | "SETTINGS_LOAD_FAILED"
  | "SETTINGS_SAVE_FAILED"
  | "CHAT_CANCELLED"
  | "UNKNOWN";

/** アプリケーションエラー */
export class AppError extends Error {
  /** エラーコード */
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** IPC 通信でシリアライズ可能なエラー情報 */
export interface SerializableError {
  code: ErrorCode;
  message: string;
}

/** AppError を IPC で転送可能な形式に変換 */
export function toSerializableError(error: unknown): SerializableError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message };
  }
  return { code: "UNKNOWN", message: String(error) };
}
