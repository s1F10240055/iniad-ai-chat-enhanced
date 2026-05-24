/**
 * IPCハンドラー登録
 *
 * RendererプロセスからのIPCリクエストを処理するハンドラーを登録する。
 *
 * チャネル:
 * - chat:send: チャットメッセージを送信（RAG パイプライン）
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
import { InMemoryStore } from "./services/in-memory-store";
import { McpClient } from "./services/mcp-client";
import { WebSearchClient } from "./services/web-search-client";
import { SearchOrchestrator } from "./services/search-orchestrator";
import { loginViaBrowser } from "./services/iniad-login";
import { settingsStore } from "./services/settings-store";
import type { ChatTurn } from "../shared/types/chat";
import type { McpStatus } from "../shared/types/settings";
import type { ChatResponse } from "../shared/types/chat";

const store = new InMemoryStore();
const mcpClient = new McpClient();
const webClient = new WebSearchClient();
const orchestrator = new SearchOrchestrator(mcpClient, webClient);
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

      const response: ChatResponse = await orchestrator.chatWithRAG(
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

    return loginViaBrowser(
      settings.moocsUsername,
      settings.moocsPassword,
      mcpClient,
      broadcastMcpStatus
    );
  });
}

export const testExports = {
  store,
  mcpClient,
  webClient,
  orchestrator,
};
