import { app, BrowserWindow, ipcMain } from "electron";
import { McpClient } from "./services/mcp-client";
import { WebSearchClient } from "./services/web-search-client";
import { SearchOrchestrator } from "./services/search-orchestrator";
import { settingsStore } from "./services/settings-store";
import { toSerializableError } from "../shared/types/errors";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

// Declare webpack globals injected by @electron-forge/plugin-webpack
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// ── Services ──────────────────────────────────────
const mcpClient = new McpClient();
const webClient = new WebSearchClient();
const orchestrator = new SearchOrchestrator(mcpClient, webClient);
let abortController: AbortController | null = null;

// ── Window creation ────────────────────────────────

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      // セキュリティ設定（CLAUDE.md §Security 準拠）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // 開発時のみ DevTools を有効化
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }
};

// ── IPC Handlers ────────────────────────────────────

function registerIpcHandlers(): void {
  // ── チャット操作 ──

  ipcMain.handle("chat:send", async (_event, userText: string) => {
    const settings = settingsStore.getRawSettings();
    abortController = new AbortController();

    try {
      const response = await orchestrator.chatWithRAG(
        userText,
        settings,
        abortController.signal
      );
      return response;
    } catch (error) {
      const serialized = toSerializableError(error);
      throw new Error(serialized.message);
    } finally {
      abortController = null;
    }
  });

  ipcMain.handle("chat:cancel", async () => {
    abortController?.abort();
    abortController = null;
  });

  ipcMain.handle("chat:list", async () => {
    return [];
  });

  ipcMain.handle("chat:clear", async () => {
    // セッション内履歴クリア（将来実装用）
  });

  // ── ステータス ──

  ipcMain.handle("app:status", async () => {
    const settings = settingsStore.getRawSettings();
    return {
      mcpStatus: mcpClient.getStatus(),
      model: settings.model,
      hasApiKey: settingsStore.hasApiKey(),
    };
  });

  // ── 設定 ──

  ipcMain.handle("settings:get", async () => {
    return settingsStore.getSettings();
  });

  ipcMain.handle("settings:set", async (_event, partial: Record<string, string>) => {
    await settingsStore.updateSettings(partial);

    // MOOCs 認証情報が更新された場合、MCP 接続を試行
    if (partial.moocsUsername || partial.moocsPassword) {
      const raw = settingsStore.getRawSettings();
      if (raw.moocsUsername && raw.moocsPassword) {
        try {
          await mcpClient.connect(raw.moocsUsername, raw.moocsPassword);
        } catch {
          // 接続失敗は設定保存自体をブロックしない
        }
      }
    }
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

      if (response.ok) {
        return { success: true };
      }
      return { success: false, error: `API returned ${response.status}` };
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

    try {
      await mcpClient.connect(settings.moocsUsername, settings.moocsPassword);
      return { success: true };
    } catch (error) {
      const err = toSerializableError(error);
      return { success: false, error: err.message };
    }
  });
}

// ── App lifecycle ───────────────────────────────────

app.whenReady().then(async () => {
  await settingsStore.init();
  registerIpcHandlers();
  createWindow();

  // MOOCs 認証情報があれば自動接続
  if (settingsStore.hasMoocsCredentials()) {
    const raw = settingsStore.getRawSettings();
    mcpClient.connect(raw.moocsUsername, raw.moocsPassword).catch((error) => {
      console.warn("[Main] Auto MCP connect failed:", error);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
