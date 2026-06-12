import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureMcpConnected } from "../../src/main/services/mcp-connection";
import type { McpClient } from "../../src/main/services/mcp-client";
import type { MoocsSearch } from "../../src/main/services/moocs-search";

function createMocks() {
  const mcpClient = {
    getStatus: vi.fn().mockReturnValue("disconnected"),
    ping: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpClient & {
    getStatus: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  };

  const moocsSearch = {
    reset: vi.fn(),
  } as unknown as MoocsSearch & { reset: ReturnType<typeof vi.fn> };

  const broadcastStatus = vi.fn();

  return { mcpClient, moocsSearch, broadcastStatus };
}

describe("ensureMcpConnected", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns connected when already connected and healthy", async () => {
    const { mcpClient, moocsSearch, broadcastStatus } = createMocks();
    mcpClient.getStatus.mockReturnValue("connected");

    const result = await ensureMcpConnected(mcpClient, moocsSearch, broadcastStatus, {
      moocsUsername: "user",
      moocsPassword: "pass",
    });

    expect(result.connected).toBe(true);
    expect(mcpClient.connect).not.toHaveBeenCalled();
  });

  it("connects with credentials when disconnected", async () => {
    const { mcpClient, moocsSearch, broadcastStatus } = createMocks();

    const result = await ensureMcpConnected(mcpClient, moocsSearch, broadcastStatus, {
      moocsUsername: "user",
      moocsPassword: "pass",
    });

    expect(result.connected).toBe(true);
    expect(moocsSearch.reset).toHaveBeenCalled();
    expect(mcpClient.connect).toHaveBeenCalledWith("user", "pass");
    expect(broadcastStatus).toHaveBeenCalledWith("connecting");
    expect(broadcastStatus).toHaveBeenCalledWith("connected");
  });

  it("returns error when credentials are missing", async () => {
    const { mcpClient, moocsSearch, broadcastStatus } = createMocks();

    const result = await ensureMcpConnected(mcpClient, moocsSearch, broadcastStatus, {
      moocsUsername: "",
      moocsPassword: "",
    });

    expect(result.connected).toBe(false);
    expect(result.error).toContain("認証情報");
    expect(mcpClient.connect).not.toHaveBeenCalled();
  });

  it("reconnects when ping fails on connected client", async () => {
    const { mcpClient, moocsSearch, broadcastStatus } = createMocks();
    mcpClient.getStatus.mockReturnValue("connected");
    mcpClient.ping.mockResolvedValue(false);

    const result = await ensureMcpConnected(mcpClient, moocsSearch, broadcastStatus, {
      moocsUsername: "user",
      moocsPassword: "pass",
    });

    expect(result.connected).toBe(true);
    expect(mcpClient.connect).toHaveBeenCalled();
  });
});
