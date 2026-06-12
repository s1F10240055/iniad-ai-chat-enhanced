/**
 * IPCハンドラー登録
 *
 * RendererプロセスからのIPCリクエストを処理するハンドラーを登録する。
 *
 * チャネル:
 * - chat:send: チャットメッセージを送信（エージェント + ツール呼び出し）
 * - chat:cancel: チャット送信をキャンセル
 * - chat:list: チャット履歴を取得
 * - chat:clear: チャット履歴をクリア
 * - app:status: アプリケーションステータスを取得
 * - settings:get: 設定値を取得
 * - settings:set: 設定値を更新
 * - settings:test-api: API接続テスト
 * - settings:test-mcp: MCP接続テスト
 */

import { ipcMain, BrowserWindow } from "electron";
import { toSerializableError } from "../shared/types/errors";
import { createAppServices } from "./services/app-services";
import { ensureMcpConnected } from "./services/mcp-connection";
import { settingsStore } from "./services/settings-store";
import type { ChatTurn } from "../shared/types/chat";
import type { McpStatus } from "../shared/types/settings";
import type { ChatResponse } from "../shared/types/chat";

const services = createAppServices();
const { store, mcpClient, chatAgent } = services;
let activeController: AbortController | null = null;

// ── Helper: broadcast MCP status to all windows ────

function broadcastMcpStatus(status: McpStatus): void {
  store.setMcpStatus(status);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("mcp:status", status);
  }
}

// ── Error handling wrapper ──────────────────────────

async function withErrorHandler<T>(
  handler: () => Promise<T>
): Promise<
  { success: true; data: T } | { success: false; error: { code: string; message: string } }
> {
  try {
    const data = await handler();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: toSerializableError(error) };
  }
}

// ── Register IPC handlers ───────────────────────────

export function registerIpcHandlers(): void {
  // 保存済み認証情報があればバックグラウンドで MCP 接続を試みる
  void tryAutoConnectMcp();

  // ── チャット操作 ──

  ipcMain.handle("chat:send", async (_event, userText: string) => {
    if (!userText || typeof userText !== "string" || userText.trim().length === 0) {
      throw new Error("INVALID_INPUT");
    }

    if (activeController) {
      throw new Error("CHAT_IN_PROGRESS");
    }

    const settings = settingsStore.getRawSettings();
    activeController = new AbortController();

    try {
      const userMessage: ChatTurn = {
        id: `msg_${Date.now()}_user`,
        role: "user",
        content: userText,
        timestamp: new Date().toISOString(),
      };
      store.addMessage(userMessage);

      // MOOCs 検索のため、未接続時は認証情報があれば自動接続を試みる
      if (mcpClient.getStatus() !== "connected" && settingsStore.hasMoocsCredentials()) {
        const connectResult = await ensureMcpConnected(
          mcpClient,
          broadcastMcpStatus,
          settings
        );
        if (!connectResult.connected) {
          console.warn("[chat:send] MCP auto-connect failed:", connectResult.error);
        }
      }

      const response: ChatResponse = await chatAgent.chat(
        userText,
        settings,
        activeController.signal,
        store.getHistory()
      );

      const assistantMessage: ChatTurn = {
        id: `msg_${Date.now()}_ai`,
        role: "assistant",
        content: response.content,
        citations: response.citations,
        timestamp: new Date().toISOString(),
      };
      store.addMessage(assistantMessage);

      return response;
    } catch (error) {
      const serialized = toSerializableError(error);
      throw new Error(serialized.message);
    } finally {
      activeController = null;
    }
  });

  ipcMain.handle("chat:cancel", async () => {
    return withErrorHandler(async () => {
      activeController?.abort();
      activeController = null;
    });
  });

  ipcMain.handle("chat:list", async () => {
    return withErrorHandler(async () => {
      return store.getHistory();
    });
  });

  ipcMain.handle("chat:clear", async () => {
    return withErrorHandler(async () => {
      store.clearHistory();
    });
  });

  // ── ステータス ──

  ipcMain.handle("app:status", async () => {
    const settings = settingsStore.getRawSettings();
    store.setModel(settings.model);
    store.setHasApiKey(settingsStore.hasApiKey());
    return store.getAppStatus();
  });

  // ── 設定 ──

  ipcMain.handle("settings:get", async () => {
    return settingsStore.getSettings();
  });

  ipcMain.handle("settings:set", async (_event, partial: Record<string, string>) => {
    await settingsStore.updateSettings(partial);
  });

  ipcMain.handle("settings:test-api", async () => {
    const settings = settingsStore.getRawSettings();
    if (!settings.apiKey) {
      return { success: false, error: "API キーが設定されていません" };
    }

    try {
      const url = `${settings.baseURL}/models`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return { success: false, error: `API returned ${response.status}` };
      }

      const data = (await response.json()) as { data?: unknown[]; error?: { message?: string } };
      if (data.error) {
        return { success: false, error: data.error.message || "認証エラー" };
      }
      if (!data.data || !Array.isArray(data.data)) {
        return { success: false, error: "APIレスポンスが不正です" };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("settings:test-mcp", async () => {
    const settings = settingsStore.getRawSettings();
    if (!settings.moocsUsername || !settings.moocsPassword) {
      return { success: false, error: "MOOCs 認証情報が設定されていません" };
    }

    const result = await ensureMcpConnected(mcpClient, broadcastMcpStatus, settings);

    return result.connected
      ? { success: true }
      : { success: false, error: result.error ?? "MCP接続に失敗しました" };
  });
}

async function tryAutoConnectMcp(): Promise<void> {
  if (!settingsStore.hasMoocsCredentials()) return;
  if (mcpClient.getStatus() === "connected") return;

  const settings = settingsStore.getRawSettings();
  const result = await ensureMcpConnected(mcpClient, broadcastMcpStatus, settings);

  if (result.connected) {
    console.log("[McpConnection] Auto-connected on startup");
  } else {
    console.warn("[McpConnection] Auto-connect on startup failed:", result.error);
  }
}

export const testExports = {
  services,
  store,
  mcpClient,
  chatAgent,
};
