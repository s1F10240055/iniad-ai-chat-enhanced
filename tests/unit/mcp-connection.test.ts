import { describe, it, expect, vi } from "vitest";
import {
  disconnectMcp,
  ensureMcpConnected,
} from "../../src/main/services/mcp-connection";
import {
  McpClientError,
  type McpClient,
} from "../../src/main/services/mcp-client";
import type { McpStatus } from "../../src/shared/types/settings";

type McpMock = McpClient & {
  getStatus: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  setStatus: (status: McpStatus) => void;
};

function createMocks(initialStatus: McpStatus = "disconnected") {
  let status = initialStatus;
  const mcpClient = {
    getStatus: vi.fn(() => status),
    ping: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockImplementation(async () => {
      status = "connected";
    }),
    disconnect: vi.fn().mockImplementation(async () => {
      status = "disconnected";
    }),
    setStatus: (next: McpStatus) => {
      status = next;
    },
  } as unknown as McpMock;

  const broadcastState = vi.fn();
  return { mcpClient, broadcastState };
}

const credentials = {
  moocsUsername: "user",
  moocsPassword: "pass",
};

function transientError(): McpClientError {
  return new McpClientError(
    "MCP_CONNECTION_FAILED",
    "一時的に接続できません。",
    "transient",
    "ネットワーク状態を確認してください。",
    true
  );
}

describe("ensureMcpConnected", () => {
  it("returns connected without reconnecting when the existing connection is healthy", async () => {
    const { mcpClient, broadcastState } = createMocks("connected");

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials);

    expect(result.connected).toBe(true);
    expect(result.state.status).toBe("connected");
    expect(result.state.lastConnectedAt).toBeTruthy();
    expect(mcpClient.connect).not.toHaveBeenCalled();
    expect(broadcastState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "connected" })
    );
  });

  it("connects once and broadcasts connecting then connected", async () => {
    const { mcpClient, broadcastState } = createMocks();

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials);

    expect(result.connected).toBe(true);
    expect(mcpClient.connect).toHaveBeenCalledWith("user", "pass", expect.any(AbortSignal));
    expect(broadcastState.mock.calls.map(([state]) => state.status)).toEqual([
      "connecting",
      "connected",
    ]);
  });

  it("returns a non-retryable actionable error when credentials are missing", async () => {
    const { mcpClient, broadcastState } = createMocks();

    const result = await ensureMcpConnected(mcpClient, broadcastState, {
      moocsUsername: "",
      moocsPassword: "",
    });

    expect(result.connected).toBe(false);
    expect(result.state).toEqual(
      expect.objectContaining({
        status: "error",
        error: expect.objectContaining({
          code: "MCP_AUTH_FAILED",
          retryable: false,
        }),
      })
    );
    expect(result.state.error?.guidance).toContain("設定画面");
    expect(mcpClient.connect).not.toHaveBeenCalled();
  });

  it("uses reconnecting state when a connected client fails its health check", async () => {
    const { mcpClient, broadcastState } = createMocks("connected");
    mcpClient.ping.mockResolvedValue(false);

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials);

    expect(result.connected).toBe(true);
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "reconnecting", attempt: 1 })
    );
  });

  it("uses reconnecting immediately after a previously established connection is lost", async () => {
    const { mcpClient, broadcastState } = createMocks();
    await ensureMcpConnected(mcpClient, broadcastState, credentials);
    broadcastState.mockClear();
    mcpClient.setStatus("disconnected");

    await ensureMcpConnected(mcpClient, broadcastState, credentials);

    expect(broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "reconnecting", attempt: 1 })
    );
  });

  it("deduplicates concurrent connection attempts for the same client", async () => {
    const { mcpClient, broadcastState } = createMocks();
    let finishConnect!: () => void;
    mcpClient.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnect = () => {
            mcpClient.setStatus("connected");
            resolve();
          };
        })
    );

    const first = ensureMcpConnected(mcpClient, broadcastState, credentials);
    const second = ensureMcpConnected(mcpClient, broadcastState, credentials);

    expect(second).toBe(first);
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    finishConnect();
    await expect(first).resolves.toEqual(expect.objectContaining({ connected: true }));
  });

  it("does not share an in-flight connection between different clients", async () => {
    const first = createMocks();
    const second = createMocks();

    await Promise.all([
      ensureMcpConnected(first.mcpClient, first.broadcastState, credentials),
      ensureMcpConnected(second.mcpClient, second.broadcastState, credentials),
    ]);

    expect(first.mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(second.mcpClient.connect).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures with reconnecting state", async () => {
    const { mcpClient, broadcastState } = createMocks();
    mcpClient.connect.mockRejectedValueOnce(transientError());

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials, {
      maxAttempts: 3,
      backoffBaseMs: 0,
    });

    expect(result.connected).toBe(true);
    expect(mcpClient.connect).toHaveBeenCalledTimes(2);
    expect(broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "reconnecting",
        attempt: 1,
        error: expect.objectContaining({ retryable: true }),
      })
    );
  });

  it("stops at the retry limit", async () => {
    const { mcpClient, broadcastState } = createMocks();
    mcpClient.connect.mockRejectedValue(transientError());

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials, {
      maxAttempts: 3,
      backoffBaseMs: 0,
    });

    expect(result.connected).toBe(false);
    expect(mcpClient.connect).toHaveBeenCalledTimes(3);
    expect(result.state).toEqual(
      expect.objectContaining({
        status: "error",
        attempt: 3,
        maxAttempts: 3,
      })
    );
  });

  it("does not retry authentication failures", async () => {
    const { mcpClient, broadcastState } = createMocks();
    mcpClient.connect.mockRejectedValue(
      new McpClientError(
        "MCP_AUTH_FAILED",
        "MOOCs の認証に失敗しました。",
        "authentication",
        "設定画面で認証情報を再入力してください。",
        false
      )
    );

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials, {
      maxAttempts: 3,
      backoffBaseMs: 0,
    });

    expect(result.connected).toBe(false);
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(result.state.error).toEqual(
      expect.objectContaining({ code: "MCP_AUTH_FAILED", retryable: false })
    );
  });

  it("reports Playwright setup failures without retrying", async () => {
    const { mcpClient, broadcastState } = createMocks();
    mcpClient.connect.mockRejectedValue(
      new McpClientError(
        "PLAYWRIGHT_NOT_INSTALLED",
        "MCP のブラウザー実行環境が見つかりません。",
        "playwright",
        "Playwright のブラウザーをインストールしてください。",
        false
      )
    );

    const result = await ensureMcpConnected(mcpClient, broadcastState, credentials);

    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(result.state.error).toEqual(
      expect.objectContaining({ code: "PLAYWRIGHT_NOT_INSTALLED", retryable: false })
    );
    expect(result.state.error?.guidance).toContain("Playwright");
  });

  it("cancels an in-progress retry wait", async () => {
    const { mcpClient, broadcastState } = createMocks();
    const controller = new AbortController();
    mcpClient.connect.mockRejectedValue(transientError());

    const pending = ensureMcpConnected(mcpClient, broadcastState, credentials, {
      signal: controller.signal,
      maxAttempts: 3,
      backoffBaseMs: 60_000,
      backoffMaxMs: 60_000,
    });
    await vi.waitFor(() => expect(mcpClient.connect).toHaveBeenCalledTimes(1));
    controller.abort();

    const result = await pending;
    expect(result.connected).toBe(false);
    expect(result.state.error).toEqual(
      expect.objectContaining({ code: "CHAT_CANCELLED", retryable: false })
    );
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
  });
});

describe("disconnectMcp", () => {
  it("disconnects and broadcasts a disconnected state", async () => {
    const { mcpClient, broadcastState } = createMocks("connected");

    await disconnectMcp(mcpClient, broadcastState);

    expect(mcpClient.disconnect).toHaveBeenCalledTimes(1);
    expect(broadcastState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "disconnected" })
    );
  });

  it("waits for and removes an in-flight attempt before a new connection", async () => {
    const { mcpClient, broadcastState } = createMocks();
    mcpClient.connect.mockImplementationOnce(
      (_username: string, _password: string, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        })
    );

    const pending = ensureMcpConnected(mcpClient, broadcastState, credentials);
    await vi.waitFor(() => expect(mcpClient.connect).toHaveBeenCalledTimes(1));
    await disconnectMcp(mcpClient, broadcastState);
    await pending;

    await ensureMcpConnected(mcpClient, broadcastState, credentials);
    expect(mcpClient.connect).toHaveBeenCalledTimes(2);
  });
});
