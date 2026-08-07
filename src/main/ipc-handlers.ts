/** Main プロセスでのみ実行する、検証済み IPC ハンドラー。 */
import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { AppError, toSerializableError } from "../shared/types/errors";
import type { ChatResponse, ChatTurn } from "../shared/types/chat";
import type { ConnectionTestResult, McpConnectionState } from "../shared/types/settings";
import { validateChatInput, validateExternalUrl, validateSettingsInput } from "./ipc-validation";
import { apiRequestJson } from "./services/api-client";
import { createAppServices } from "./services/app-services";
import type { MaterialContextInput } from "./services/in-memory-store";
import {
  disconnectMcp,
  ensureMcpConnected,
  type McpConnectionResult,
} from "./services/mcp-connection";
import { type McpClientError } from "./services/mcp-client";
import { settingsStore } from "./services/settings-store";

interface ModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

export interface RegisterIpcHandlersOptions {
  isTrustedSender: (webContentsId: number) => boolean;
}

type SecureHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>;

const services = createAppServices();
const { store, mcpClient, chatAgent } = services;

let handlersRegistered = false;
let activeController: AbortController | null = null;
let activeChatCompletion: Promise<void> | null = null;
let activeConnection: {
  controller: AbortController;
  promise: Promise<McpConnectionResult>;
} | null = null;
let removeConnectionIssueListener: (() => void) | null = null;
let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
let mcpConnectionState: McpConnectionState = { status: "disconnected" };

function broadcastMcpState(next: McpConnectionState): void {
  mcpConnectionState = {
    ...next,
    lastConnectedAt: next.lastConnectedAt ?? mcpConnectionState.lastConnectedAt,
  };
  store.setMcpConnectionState(mcpConnectionState);

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("mcp:status", { ...mcpConnectionState });
    }
  }
}

function secureHandle(
  channel: string,
  options: RegisterIpcHandlersOptions,
  handler: SecureHandler
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event, options);
    return handler(event, ...args);
  });
}

function secureNoArg(
  channel: string,
  options: RegisterIpcHandlersOptions,
  handler: (event: IpcMainInvokeEvent) => unknown | Promise<unknown>
): void {
  secureHandle(channel, options, (event, ...args) => {
    if (args.length !== 0) {
      throw new AppError("INVALID_INPUT", `IPC ${channel} does not accept arguments`);
    }
    return handler(event);
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent, options: RegisterIpcHandlersOptions): void {
  const isMainFrame = event.senderFrame === event.sender.mainFrame;
  if (event.sender.isDestroyed() || !isMainFrame || !options.isTrustedSender(event.sender.id)) {
    throw new AppError("PERMISSION_DENIED", "この IPC 呼び出しは許可されていません");
  }
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  removeConnectionIssueListener = mcpClient.onConnectionIssue((error) => {
    handleMcpConnectionIssue(error);
  });

  secureHandle("chat:send", options, async (_event, rawText) => {
    const userText = validateChatInput(rawText);
    if (activeController) {
      throw new AppError("INVALID_INPUT", "別の回答を生成中です");
    }

    const controller = new AbortController();
    activeController = controller;
    const task = runChat(userText, controller);
    const completion = task.then(
      () => undefined,
      () => undefined
    );
    activeChatCompletion = completion;

    try {
      return await task;
    } finally {
      if (activeController === controller) activeController = null;
      if (activeChatCompletion === completion) activeChatCompletion = null;
    }
  });

  secureNoArg("chat:cancel", options, async () => {
    await cancelActiveChat();
  });

  secureNoArg("chat:list", options, async () => store.getHistory());

  secureNoArg("chat:new", options, async () => {
    await cancelActiveChat();
    store.clearConversationHistory();
  });

  secureNoArg("chat:clear", options, async () => {
    await cancelActiveChat();
    store.clearConversationHistory();
  });

  secureNoArg("context:list", options, async () => store.getMaterialSummaries());

  secureNoArg("context:clear", options, async () => {
    await cancelActiveChat();
    store.clearMaterialContext();
  });

  secureNoArg("app:status", options, async () => {
    const settings = settingsStore.getRawSettings();
    store.setModel(settings.model);
    store.setHasApiKey(settingsStore.hasApiKey());
    return {
      ...store.getAppStatus(),
      mcpStatus: mcpConnectionState.status,
      mcpConnection: { ...mcpConnectionState },
    };
  });

  secureNoArg("settings:get", options, async () => settingsStore.getSettings());

  secureHandle("settings:set", options, async (_event, rawSettings) => {
    const partial = validateSettingsInput(rawSettings);
    await settingsStore.updateSettings(partial);

    if (partial.model) store.setModel(partial.model);
    store.setHasApiKey(settingsStore.hasApiKey());

    if ("moocsUsername" in partial || "moocsPassword" in partial) {
      void reconnectAfterCredentialChange();
    }
  });

  secureNoArg("settings:test-api", options, async () => testApiConnection());

  secureNoArg("settings:test-mcp", options, async () => {
    return toConnectionTestResult(await connectMcp());
  });

  secureNoArg("mcp:reconnect", options, async () => {
    return toConnectionTestResult(await reconnectMcp());
  });

  secureHandle("external:open", options, async (_event, rawUrl) => {
    const url = validateExternalUrl(rawUrl);
    try {
      await shell.openExternal(url, { activate: true });
      return true;
    } catch {
      return false;
    }
  });

  // UI の描画や操作を待たず、起動直後にバックグラウンド接続を始める。
  void tryAutoConnectMcp();
}

async function runChat(userText: string, controller: AbortController): Promise<ChatResponse> {
  const settings = settingsStore.getRawSettings();
  const userMessage: ChatTurn = {
    id: `msg_${Date.now()}_user`,
    role: "user",
    content: userText,
    timestamp: new Date().toISOString(),
  };

  try {
    const shouldTryMcp =
      mcpClient.getStatus() !== "connected" &&
      settingsStore.hasMoocsCredentials() &&
      (mcpConnectionState.status !== "error" || mcpConnectionState.error?.retryable !== false);
    if (shouldTryMcp) {
      const result = await connectMcp(controller.signal);
      if (!result.connected) {
        console.warn(
          `[McpConnection] Chat fallback after ${result.state.error?.code ?? "connection failure"}`
        );
      }
    }

    if (controller.signal.aborted) {
      throw new AppError("CHAT_CANCELLED", "リクエストがキャンセルされました");
    }

    const priorMaterials = store.selectRelevantMaterials(userText);
    const retrievedMaterials: MaterialContextInput[] = [];
    const response = await chatAgent.chat(
      userText,
      settings,
      controller.signal,
      [...store.getHistory(), userMessage],
      {
        priorMaterials,
        onMaterialsRetrieved: (materials) => {
          retrievedMaterials.push(...materials);
        },
      }
    );

    // A dependency may resolve after cancellation instead of rejecting. Never
    // repopulate history/material state after new-chat, clear, or cancel returned.
    if (controller.signal.aborted) {
      throw new AppError("CHAT_CANCELLED", "リクエストがキャンセルされました");
    }

    store.markMaterialsReferenced(priorMaterials.map((material) => material.id));
    store.addMaterials(retrievedMaterials);

    const assistantMessage: ChatTurn = {
      id: `msg_${Date.now()}_ai`,
      role: "assistant",
      content: response.content,
      citations: response.citations,
      timestamp: new Date().toISOString(),
    };
    // 未確定ターンを先に履歴へ入れない。失敗時のrollbackで上限履歴を失わないため、
    // user/assistant は回答確定後にまとめてcommitする。
    store.addMessage(userMessage);
    store.addMessage(assistantMessage);
    return response;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AppError("CHAT_CANCELLED", "リクエストがキャンセルされました");
    }
    const serialized = toSerializableError(error);
    throw new AppError(serialized.code, serialized.message);
  }
}

async function cancelActiveChat(): Promise<void> {
  const controller = activeController;
  const completion = activeChatCompletion;
  controller?.abort();
  if (completion) await waitAtMost(completion, 5_000);
}

async function connectMcp(signal?: AbortSignal): Promise<McpConnectionResult> {
  if (shuttingDown) {
    const state: McpConnectionState = {
      status: "disconnected",
      lastConnectedAt: mcpConnectionState.lastConnectedAt,
    };
    return { connected: false, state };
  }
  if (signal?.aborted) throw chatCancelledError();
  if (activeConnection) return waitForConnection(activeConnection.promise, signal);

  const controller = new AbortController();
  const promise = ensureMcpConnected(mcpClient, broadcastMcpState, settingsStore.getRawSettings(), {
    signal: controller.signal,
  }).finally(() => {
    if (activeConnection?.controller === controller) activeConnection = null;
  });
  activeConnection = { controller, promise };
  return waitForConnection(promise, signal);
}

async function reconnectMcp(): Promise<McpConnectionResult> {
  const previousConnection = activeConnection;
  previousConnection?.controller.abort();
  await disconnectMcp(mcpClient, broadcastMcpState);
  if (activeConnection === previousConnection) activeConnection = null;
  return connectMcp();
}

function waitForConnection(
  promise: Promise<McpConnectionResult>,
  signal?: AbortSignal
): Promise<McpConnectionResult> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(chatCancelledError());

  return new Promise<McpConnectionResult>((resolve, reject) => {
    const onAbort = () => reject(chatCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function chatCancelledError(): AppError {
  return new AppError("CHAT_CANCELLED", "リクエストがキャンセルされました");
}

async function reconnectAfterCredentialChange(): Promise<void> {
  if (shuttingDown) return;
  const result = await reconnectMcp();
  if (!result.connected) {
    console.warn(
      `[McpConnection] Credential update reconnect failed: ${result.state.error?.code ?? "unknown"}`
    );
  }
}

function handleMcpConnectionIssue(error: McpClientError): void {
  if (shuttingDown) return;
  broadcastMcpState({
    status: "error",
    lastConnectedAt: mcpConnectionState.lastConnectedAt,
    error: {
      code: error.code,
      message: error.message,
      guidance: error.guidance,
      retryable: error.retryable,
    },
  });

  if (error.retryable) void connectMcp();
}

async function tryAutoConnectMcp(): Promise<void> {
  if (!settingsStore.hasMoocsCredentials()) return;
  const result = await connectMcp();
  if (result.connected) {
    console.log("[McpConnection] Startup connection established");
  } else {
    console.warn(
      `[McpConnection] Startup connection failed: ${result.state.error?.code ?? "unknown"}`
    );
  }
}

function toConnectionTestResult(result: McpConnectionResult): ConnectionTestResult {
  return result.connected
    ? { success: true }
    : {
        success: false,
        error: result.state.error?.message ?? result.error ?? "MCP接続に失敗しました",
        guidance: result.state.error?.guidance,
      };
}

async function testApiConnection(): Promise<ConnectionTestResult> {
  const settings = settingsStore.getRawSettings();
  if (!settings.apiKey) {
    return { success: false, error: "API キーが設定されていません" };
  }

  try {
    const data = await apiRequestJson<ModelsResponse>({
      apiKey: settings.apiKey,
      baseURL: settings.baseURL,
      path: "models",
      timeoutMs: 10_000,
      maxAttempts: 2,
    });
    if (data.error) {
      return { success: false, error: data.error.message || "認証エラー" };
    }
    if (!data.data || !Array.isArray(data.data)) {
      return { success: false, error: "APIレスポンスが不正です" };
    }

    const modelIds = data.data
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string");
    if (modelIds.length !== data.data.length) {
      return { success: false, error: "APIレスポンスが不正です" };
    }
    if (!modelIds.includes(settings.model)) {
      return {
        success: false,
        error: `APIには接続できましたが、モデル ${settings.model} は利用可能一覧にありません`,
      };
    }
    return { success: true };
  } catch (error) {
    const serialized = toSerializableError(error);
    return { success: false, error: serialized.message };
  }
}

export function shutdownIpcServices(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  removeConnectionIssueListener?.();
  removeConnectionIssueListener = null;

  shutdownPromise = (async () => {
    activeConnection?.controller.abort();
    await cancelActiveChat();
    if (activeConnection) await waitAtMost(activeConnection.promise, 5_000);
    await waitAtMost(disconnectMcp(mcpClient, broadcastMcpState), 5_000);
  })();
  return shutdownPromise;
}

async function waitAtMost(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    promise.then(
      () => undefined,
      () => undefined
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

export const testExports = {
  services,
  store,
  mcpClient,
  chatAgent,
};
