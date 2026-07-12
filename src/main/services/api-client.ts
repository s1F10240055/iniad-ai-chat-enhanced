const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ERROR_BODY_CHARS = 1_000;

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
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiRequestError("API URLはHTTPまたはHTTPSで指定してください", "network");
  }
  return url.toString();
}

export async function apiRequestJson<T>(options: ApiRequestOptions): Promise<T> {
  const url = buildApiUrl(options.baseURL, options.path);
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let lastError: ApiRequestError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { signal, cleanup, didTimeout } = combineAbortSignals(
      options.signal,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      });

      if (!response.ok) {
        const body = sanitizeErrorBody(await response.text().catch(() => ""));
        const suffix = body ? `: ${body}` : "";
        const error = new ApiRequestError(
          httpErrorMessage(response.status) + suffix,
          "http",
          response.status
        );
        if (!isRetryableStatus(response.status) || attempt === maxAttempts) throw error;
        lastError = error;
        console.warn(
          `[ApiClient] request failed (attempt ${attempt}/${maxAttempts}, HTTP ${response.status}); retrying`
        );
        await waitBeforeRetry(attempt, response.headers.get("retry-after"), options.signal);
        continue;
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new ApiRequestError(
          "APIレスポンスをJSONとして解析できませんでした",
          "invalid-response"
        );
      }
    } catch (error) {
      const normalized = normalizeFetchError(error, options.signal, didTimeout());
      if (!isRetryableError(normalized) || attempt === maxAttempts) throw normalized;
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
    const timer = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timer);
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

function sanitizeErrorBody(body: string): string {
  return body
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
