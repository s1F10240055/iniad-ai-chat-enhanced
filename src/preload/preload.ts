/**
 * Preload スクリプト — contextBridge による安全な IPC 橋渡し
 *
 * Renderer プロセスから Main プロセスへの通信を、
 * contextBridge.exposeInMainWorld 経由で型安全に公開する。
 * Renderer は window.electronAPI を通じてのみ Main と通信する。
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatResponse,
  ChatTurn,
  AppSettings,
  AppStatus,
  PartialAppSettings,
  ConnectionTestResult,
  McpStatus,
} from "../shared/types";

const api = {
  // ── チャット操作 ──
  /** ユーザーメッセージを送信し、AIの回答を取得する */
  sendChat: (userText: string): Promise<ChatResponse> =>
    ipcRenderer.invoke("chat:send", userText),

  /** 送信中のチャットをキャンセルする */
  cancelChat: (): Promise<void> => ipcRenderer.invoke("chat:cancel"),

  // ── 会話履歴 ──
  /** セッション内の会話履歴を取得する */
  getChatHistory: (): Promise<ChatTurn[]> => ipcRenderer.invoke("chat:list"),

  /** 会話履歴をクリアする */
  clearHistory: (): Promise<void> => ipcRenderer.invoke("chat:clear"),

  // ── ステータス ──
  /** アプリケーションの現在の状態を取得する */
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke("app:status"),

  // ── 設定 ──
  /** 設定値を取得する（APIキーはマスク済み） */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),

  /** 設定値を部分更新する（空文字列は既存値を維持） */
  saveSettings: (settings: PartialAppSettings): Promise<void> =>
    ipcRenderer.invoke("settings:set", settings),

  /** INIAD API への接続テスト */
  testApiConnection: (): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke("settings:test-api"),

  /** MCP サーバへの接続テスト */
  testMcpConnection: (): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke("settings:test-mcp"),

  // ── イベントリスナ（Main→Renderer へのプッシュ通知） ──
  /** MCP 接続状態の変更を監視する（cleanup 関数を返す） */
  onMcpStatusChange: (callback: (status: McpStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: McpStatus) =>
      callback(status);
    ipcRenderer.on("mcp:status", handler);
    return () => {
      ipcRenderer.removeListener("mcp:status", handler);
    };
  },
};

// window.electronAPI として Renderer に公開
contextBridge.exposeInMainWorld("electronAPI", api);
