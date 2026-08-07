import { OFFICIAL_API_HOST } from "../../shared/types/settings";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ERROR_BODY_CHARS = 1_000;
const MAX_ERROR_BODY_BYTES = 4_096;

const RETRYABLE_STATUS = new Set([408, 429]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export interface ApiRequestOptions {
  apiKey: string;
  baseURL: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  /** POSTなどの非冪等リクエストは既定で再試行しない。 */
  retry?: boolean;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly kind: "http" | "network" | "timeout" | "cancelled" | "invalid-response",
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function buildApiUrl(baseURL: string, path: string): string {
  const normalizedBase = baseURL.trim().replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(`${normalizedBase}/${normalizedPath}`);
  if (
    url.protocol !== "https:" ||
    url.hostname !== OFFICIAL_API_HOST ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    // Enforce this again at the final Authorization-header boundary. IPC validation
    // alone cannot protect against a legacy, corrupted, or locally modified settings file.
    throw new ApiRequestError("API URLは公式 INIAD API の HTTPS URL のみ指定できます", "network");
  }
  return url.toString();
}

export async function apiRequestJson<T>(options: ApiRequestOptions): Promise<T> {
  const url = buildApiUrl(options.baseURL, options.path);
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const shouldRetry = options.retry ?? method === "GET";
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let lastError: ApiRequestError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { signal, cleanup, didTimeout } = combineAbortSignals(
      options.signal,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      });

      if (!response.ok) {
        const body = sanitizeErrorBody(await readBoundedResponseText(response), options.apiKey);
        const suffix = body ? `: ${body}` : "";
        const error = new ApiRequestError(
          httpErrorMessage(response.status) + suffix,
          "http",
          response.status
        );
        if (!shouldRetry || !isRetryableStatus(response.status) || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        console.warn(
          `[ApiClient] request failed (attempt ${attempt}/${maxAttempts}, HTTP ${response.status}); retrying`
        );
        await waitBeforeRetry(attempt, response.headers.get("retry-after"), options.signal);
        continue;
      }

      try {
        return (await response.json()) as T;
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiRequestError(
          "APIレスポンスをJSONとして解析できませんでした",
          "invalid-response"
        );
      }
    } catch (error) {
      const normalized = normalizeFetchError(error, options.signal, didTimeout());
      if (!shouldRetry || !isRetryableError(normalized) || attempt === maxAttempts) {
        throw normalized;
      }
      lastError = normalized;
      console.warn(
        `[ApiClient] request failed (attempt ${attempt}/${maxAttempts}, ${normalized.code ?? normalized.kind}); retrying`
      );
      await waitBeforeRetry(attempt, null, options.signal);
    } finally {
      cleanup();
    }
  }

  throw lastError ?? new ApiRequestError("APIリクエストに失敗しました", "network");
}

async function readBoundedResponseText(response: Response): Promise<string> {
  if (!response.body) return response.text().catch(() => "");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (bytesRead < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_ERROR_BODY_BYTES - bytesRead;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytesRead += chunk.byteLength;
      text += decoder.decode(chunk, { stream: bytesRead < MAX_ERROR_BODY_BYTES });
      if (chunk.byteLength < value.byteLength) break;
    }
    text += decoder.decode();
    return text;
  } catch {
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function combineAbortSignals(userSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromUser = () => controller.abort(userSignal?.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("timeout"));
  }, timeoutMs);

  if (userSignal?.aborted) abortFromUser();
  else userSignal?.addEventListener("abort", abortFromUser, { once: true });

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", abortFromUser);
    },
  };
}

function normalizeFetchError(
  error: unknown,
  userSignal: AbortSignal | undefined,
  timedOut: boolean
): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (userSignal?.aborted) {
    return new ApiRequestError("リクエストがキャンセルされました", "cancelled");
  }
  if (timedOut) return new ApiRequestError("APIリクエストがタイムアウトしました", "timeout");

  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code = getErrorCode(cause) ?? getErrorCode(error);
  const detail = networkErrorDetail(code);
  return new ApiRequestError(`APIへの接続に失敗しました${detail}`, "network", undefined, code);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function networkErrorDetail(code?: string): string {
  if (!code) return "";
  const labels: Record<string, string> = {
    ENOTFOUND: "（DNSでホストを解決できません）",
    EAI_AGAIN: "（DNS応答が一時的に得られません）",
    ECONNREFUSED: "（接続を拒否されました）",
    ECONNRESET: "（接続が途中で切断されました）",
    ETIMEDOUT: "（接続がタイムアウトしました）",
    CERT_HAS_EXPIRED: "（TLS証明書の有効期限が切れています）",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "（TLS証明書を検証できません）",
  };
  return labels[code] ?? `（通信エラー: ${code}）`;
}

function isRetryableError(error: ApiRequestError): boolean {
  if (error.kind === "timeout") return true;
  return error.kind === "network" && (!error.code || RETRYABLE_NETWORK_CODES.has(error.code));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

async function waitBeforeRetry(
  attempt: number,
  retryAfter: string | null,
  signal?: AbortSignal
): Promise<void> {
  const retryAfterMs = parseRetryAfter(retryAfter);
  const exponentialMs = Math.min(8_000, 500 * 2 ** (attempt - 1));
  const delayMs = retryAfterMs ?? exponentialMs + Math.floor(Math.random() * 250);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new ApiRequestError("リクエストがキャンセルされました", "cancelled"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.min(Math.max(0, dateMs - Date.now()), 30_000);
}

function sanitizeErrorBody(body: string, apiKey: string): string {
  const keyRedacted = apiKey ? body.split(apiKey).join("[REDACTED]") : body;
  return keyRedacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_BODY_CHARS);
}

function httpErrorMessage(status: number): string {
  if (status === 401) return "APIキーが拒否されました（HTTP 401）";
  if (status === 403) return "APIへのアクセス権限がありません（HTTP 403）";
  if (status === 404) return "API URLまたはエンドポイントが見つかりません（HTTP 404）";
  if (status === 429) return "APIの利用回数制限に達しました（HTTP 429）";
  if (status >= 500) return `APIサーバーで一時的な障害が発生しています（HTTP ${status}）`;
  return `APIリクエストが失敗しました（HTTP ${status}）`;
}
