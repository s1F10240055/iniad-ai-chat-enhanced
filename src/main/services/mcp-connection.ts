import { AppError } from "../../shared/types/errors";
import type { McpConnectionError, McpConnectionState } from "../../shared/types/settings";
import { McpClientError, type McpClient } from "./mcp-client";

const DEFAULT_MAX_ATTEMPTS = 3;
const ABSOLUTE_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 4_000;
const MANUAL_DISCONNECT_REASON = Symbol("manual-mcp-disconnect");

export interface McpCredentials {
  moocsUsername: string;
  moocsPassword: string;
}

export interface McpConnectionOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export interface McpConnectionResult {
  connected: boolean;
  error?: string;
  state: McpConnectionState;
}

export type McpConnectionBroadcast = (state: McpConnectionState) => void;

/** client ごとに接続処理を一本化し、別 client の処理とは干渉させない。 */
const connectInFlight = new WeakMap<McpClient, Promise<McpConnectionResult>>();
const operationControllers = new WeakMap<McpClient, AbortController>();
const lastConnectedAt = new WeakMap<McpClient, string>();

/**
 * MCP 接続を確立する。initialize + 必須 tools/list 確認は McpClient.connect が担う。
 * 一時障害だけを上限付き指数バックオフで再試行する。
 */
export function ensureMcpConnected(
  mcpClient: McpClient,
  broadcastState: McpConnectionBroadcast,
  credentials: McpCredentials,
  options: McpConnectionOptions = {}
): Promise<McpConnectionResult> {
  const existing = connectInFlight.get(mcpClient);
  if (existing) return existing;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const operation = connectWithRetry(
    mcpClient,
    broadcastState,
    credentials,
    normalizeOptions(options),
    controller.signal
  );

  const cleanup = () => {
    options.signal?.removeEventListener("abort", abortFromCaller);
    if (operationControllers.get(mcpClient) === controller) {
      operationControllers.delete(mcpClient);
    }
    if (connectInFlight.get(mcpClient) === operation) {
      connectInFlight.delete(mcpClient);
    }
  };

  operationControllers.set(mcpClient, controller);
  connectInFlight.set(mcpClient, operation);
  void operation.then(cleanup, cleanup);
  return operation;
}

async function connectWithRetry(
  mcpClient: McpClient,
  broadcastState: McpConnectionBroadcast,
  credentials: McpCredentials,
  options: Required<Omit<McpConnectionOptions, "signal">>,
  signal: AbortSignal
): Promise<McpConnectionResult> {
  let reconnecting = lastConnectedAt.has(mcpClient) || mcpClient.getStatus() !== "disconnected";

  try {
    if (mcpClient.getStatus() === "connected") {
      const healthy = await mcpClient.ping(signal);
      if (signal.aborted) throw signal.reason ?? cancelledConnectionError();
      if (healthy) {
        const connectedAt = lastConnectedAt.get(mcpClient) ?? new Date().toISOString();
        lastConnectedAt.set(mcpClient, connectedAt);
        const state: McpConnectionState = {
          status: "connected",
          lastConnectedAt: connectedAt,
        };
        broadcastState(state);
        return { connected: true, state };
      }
      reconnecting = true;
    }

    if (!hasValidCredentials(credentials)) {
      const error: McpConnectionError = {
        code: "MCP_AUTH_FAILED",
        message: "MOOCs 認証情報が設定されていません。",
        guidance: "設定画面で学籍番号とパスワードを入力してください。",
        retryable: false,
      };
      const state = errorState(error, 0, options.maxAttempts, mcpClient);
      broadcastState(state);
      return { connected: false, error: error.message, state };
    }

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      if (signal.aborted) throw signal.reason ?? cancelledConnectionError();

      const state: McpConnectionState = {
        status: reconnecting || attempt > 1 ? "reconnecting" : "connecting",
        lastConnectedAt: lastConnectedAt.get(mcpClient),
        attempt,
        maxAttempts: options.maxAttempts,
      };
      broadcastState(state);

      try {
        await mcpClient.connect(
          credentials.moocsUsername.trim(),
          credentials.moocsPassword,
          signal
        );

        if (mcpClient.getStatus() !== "connected") {
          throw new McpClientError(
            "MCP_CONNECTION_FAILED",
            "MCP の接続確認に失敗しました。",
            "transient",
            "ネットワーク状態を確認してください。自動再接続も試行されます。",
            true
          );
        }

        const connectedAt = new Date().toISOString();
        lastConnectedAt.set(mcpClient, connectedAt);
        const connectedState: McpConnectionState = {
          status: "connected",
          lastConnectedAt: connectedAt,
          attempt,
          maxAttempts: options.maxAttempts,
        };
        broadcastState(connectedState);
        return { connected: true, state: connectedState };
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? cancelledConnectionError();

        const connectionError = toConnectionError(error);
        if (!connectionError.retryable || attempt >= options.maxAttempts) {
          const failedState = errorState(connectionError, attempt, options.maxAttempts, mcpClient);
          broadcastState(failedState);
          return { connected: false, error: connectionError.message, state: failedState };
        }

        reconnecting = true;
        broadcastState({
          status: "reconnecting",
          lastConnectedAt: lastConnectedAt.get(mcpClient),
          error: connectionError,
          attempt,
          maxAttempts: options.maxAttempts,
        });

        const delayMs = Math.min(options.backoffMaxMs, options.backoffBaseMs * 2 ** (attempt - 1));
        await waitForRetry(delayMs, signal);
      }
    }

    // for ループの上限で必ず return するため、通常は到達しない。
    const fallback = toConnectionError(new Error("retry limit reached"));
    const state = errorState(fallback, options.maxAttempts, options.maxAttempts, mcpClient);
    broadcastState(state);
    return { connected: false, error: fallback.message, state };
  } catch (error) {
    if (error === MANUAL_DISCONNECT_REASON || signal.reason === MANUAL_DISCONNECT_REASON) {
      const state: McpConnectionState = {
        status: "disconnected",
        lastConnectedAt: lastConnectedAt.get(mcpClient),
      };
      return { connected: false, state };
    }

    const connectionError = toConnectionError(signal.aborted ? cancelledConnectionError() : error);
    const state = errorState(connectionError, undefined, options.maxAttempts, mcpClient);
    broadcastState(state);
    return { connected: false, error: connectionError.message, state };
  }
}

/** 再試行待ちを止めた上で MCP を切断する。 */
export async function disconnectMcp(
  mcpClient: McpClient,
  broadcastState: McpConnectionBroadcast
): Promise<void> {
  const operation = connectInFlight.get(mcpClient);
  operationControllers.get(mcpClient)?.abort(MANUAL_DISCONNECT_REASON);
  await mcpClient.disconnect();
  if (operation) {
    await operation.catch(() => undefined);
    if (connectInFlight.get(mcpClient) === operation) connectInFlight.delete(mcpClient);
  }
  operationControllers.delete(mcpClient);
  broadcastState({
    status: "disconnected",
    lastConnectedAt: lastConnectedAt.get(mcpClient),
  });
}

function hasValidCredentials(credentials: McpCredentials): boolean {
  return (
    typeof credentials.moocsUsername === "string" &&
    typeof credentials.moocsPassword === "string" &&
    credentials.moocsUsername.trim().length > 0 &&
    credentials.moocsUsername.length <= 320 &&
    credentials.moocsPassword.length > 0 &&
    credentials.moocsPassword.length <= 4_096
  );
}

function normalizeOptions(
  options: McpConnectionOptions
): Required<Omit<McpConnectionOptions, "signal">> {
  const maxAttempts = clampInteger(
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    1,
    ABSOLUTE_MAX_ATTEMPTS
  );
  const backoffBaseMs = clampInteger(options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS, 0, 30_000);
  const backoffMaxMs = clampInteger(
    options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS,
    backoffBaseMs,
    60_000
  );
  return { maxAttempts, backoffBaseMs, backoffMaxMs };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toConnectionError(error: unknown): McpConnectionError {
  if (error instanceof McpClientError) {
    return {
      code: error.code,
      message: error.message,
      guidance: error.guidance,
      retryable: error.retryable,
    };
  }

  if (error instanceof AppError) {
    return {
      code: error.code,
      message: safeMessageForCode(error.code),
      guidance: guidanceForCode(error.code),
      retryable: error.code === "MCP_TIMEOUT",
    };
  }

  return {
    code: "MCP_CONNECTION_FAILED",
    message: "MCP サーバーへの接続に失敗しました。",
    guidance: "MCP の設定とネットワーク状態を確認して、もう一度お試しください。",
    retryable: false,
  };
}

function safeMessageForCode(code: AppError["code"]): string {
  switch (code) {
    case "MCP_AUTH_FAILED":
      return "MOOCs の認証に失敗しました。";
    case "MCP_TIMEOUT":
      return "MCP サーバーへの接続がタイムアウトしました。";
    case "PLAYWRIGHT_NOT_INSTALLED":
      return "MCP のブラウザー実行環境が見つかりません。";
    case "CHAT_CANCELLED":
      return "MCP 接続がキャンセルされました。";
    default:
      return "MCP サーバーへの接続に失敗しました。";
  }
}

function guidanceForCode(code: AppError["code"]): string {
  switch (code) {
    case "MCP_AUTH_FAILED":
      return "設定画面で学籍番号とパスワードを再入力してください。";
    case "PLAYWRIGHT_NOT_INSTALLED":
      return "Playwright のブラウザーをインストールしてから再試行してください。";
    case "MCP_TIMEOUT":
      return "ネットワーク状態を確認して、もう一度お試しください。";
    case "CHAT_CANCELLED":
      return "必要であれば、もう一度接続してください。";
    default:
      return "MCP の設定を確認して、もう一度お試しください。";
  }
}

function errorState(
  error: McpConnectionError,
  attempt: number | undefined,
  maxAttempts: number,
  mcpClient: McpClient
): McpConnectionState {
  return {
    status: "error",
    lastConnectedAt: lastConnectedAt.get(mcpClient),
    error,
    attempt,
    maxAttempts,
  };
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? cancelledConnectionError();
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? cancelledConnectionError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function cancelledConnectionError(): McpClientError {
  return new McpClientError(
    "CHAT_CANCELLED",
    "MCP 接続がキャンセルされました。",
    "cancelled",
    "必要であれば、もう一度接続してください。",
    false
  );
}
