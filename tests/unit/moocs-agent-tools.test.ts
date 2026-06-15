import { describe, it, expect, vi } from "vitest";
import { executeAgentTool } from "../../src/main/services/moocs-tool-executor";
import type { McpClient } from "../../src/main/services/mcp-client";
import type { IWebSearchProvider } from "../../src/main/services/web-search-types";

function createMcpMock(overrides: Partial<McpClient> = {}): McpClient {
  return {
    getStatus: vi.fn().mockReturnValue("connected"),
    ping: vi.fn().mockResolvedValue(true),
    loginToMoocs: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '[{"title":"Python基礎","url":"https://moocs.iniad.org/courses/python"}]' }],
    }),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    callToolSafe: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    }),
    getPageSnapshot: vi.fn().mockResolvedValue("スライド本文です"),
    ...overrides,
  } as unknown as McpClient;
}

const webClient: IWebSearchProvider = {
  search: vi.fn().mockResolvedValue({
    success: true,
    results: [{ title: "Web", url: "https://example.com", snippet: "info", source: "web" }],
  }),
};

describe("executeAgentTool", () => {
  it("returns error when MCP is not connected", async () => {
    const result = await executeAgentTool("moocs_list_courses", "{}", {
      mcpClient: createMcpMock({ getStatus: vi.fn().mockReturnValue("disconnected") }),
      webClient,
      mcpConnected: false,
    });

    expect(result.content).toContain("not connected");
  });

  it("executes moocs_login and extracts citations", async () => {
    const mcpClient = createMcpMock();
    const result = await executeAgentTool("moocs_login", "{}", {
      mcpClient,
      webClient,
      mcpConnected: true,
    });

    expect(mcpClient.loginToMoocs).toHaveBeenCalled();
    expect(result.content).toContain("Python基礎");
    expect(result.citations.some((c) => c.url.includes("moocs.iniad.org"))).toBe(true);
  });

  it("rejects non-moocs URLs for moocs_navigate", async () => {
    const result = await executeAgentTool(
      "moocs_navigate",
      JSON.stringify({ url: "https://evil.example.com" }),
      { mcpClient: createMcpMock(), webClient, mcpConnected: true }
    );

    expect(result.content).toContain("moocs.iniad.org");
  });

  it("executes web_search without MCP", async () => {
    const result = await executeAgentTool(
      "web_search",
      JSON.stringify({ query: "INIAD" }),
      { mcpClient: createMcpMock(), webClient, mcpConnected: false }
    );

    expect(result.content).toContain("Web");
    expect(webClient.search).toHaveBeenCalledWith("INIAD");
  });
});
