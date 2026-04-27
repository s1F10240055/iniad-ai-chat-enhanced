/**
 * Renderer プロセス用の window.electronAPI 型拡張
 *
 * preload.ts で contextBridge.exposeInMainWorld("electronAPI", ...)
 * により公開される API の型定義。
 * Renderer 側で window.electronAPI を使うと自動的に型補完が効く。
 */
import type {
  ChatResponse,
  ChatTurn,
  AppSettings,
  AppStatus,
  PartialAppSettings,
  ConnectionTestResult,
  McpStatus,
} from "../shared/types";

export interface ElectronAPI {
  // ── チャット操作 ──
  sendChat: (userText: string) => Promise<ChatResponse>;
  cancelChat: () => Promise<void>;

  // ── 会話履歴 ──
  getChatHistory: () => Promise<ChatTurn[]>;
  clearHistory: () => Promise<void>;

  // ── ステータス ──
  getStatus: () => Promise<AppStatus>;

  // ── 設定 ──
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: PartialAppSettings) => Promise<void>;
  testApiConnection: () => Promise<ConnectionTestResult>;
  testMcpConnection: () => Promise<ConnectionTestResult>;

  // ── イベントリスナ ──
  onMcpStatusChange: (callback: (status: McpStatus) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
