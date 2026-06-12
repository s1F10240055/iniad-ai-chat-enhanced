import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatAgent } from "../../src/main/services/chat-agent";
import type { McpClient } from "../../src/main/services/mcp-client";
import type { IWebSearchProvider } from "../../src/main/services/search-orchestrator";
import type { AppSettings } from "../../src/shared/types/settings";

const settings: AppSettings = {
  apiKey: "test-key",
  baseURL: "https://api.example.com/v1",
  model: "gpt-test",
  moocsUsername: "",
  moocsPassword: "",
};

function createMcpMock(): McpClient {
  return {
    getStatus: vi.fn().mockReturnValue("disconnected"),
    ping: vi.fn().mockResolvedValue(false),
  } as unknown as McpClient;
}

const webClient: IWebSearchProvider = {
  search: vi.fn(),
};

describe("ChatAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("completes after tool calls and final answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "web_search", arguments: '{"query":"C言語"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "C言語について説明します。",
              },
              finish_reason: "stop",
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    webClient.search = vi.fn().mockResolvedValue({
      success: true,
      results: [
        {
          title: "C言語入門",
          url: "https://example.com/c",
          snippet: "メモリとポインタ",
          source: "web",
        },
      ],
    });

    const agent = new ChatAgent(createMcpMock(), webClient);
    const result = await agent.chat("C言語の変数とは？", settings);

    expect(result.content).toContain("C言語");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody.tools).toBeDefined();
    expect(firstBody.tool_choice).toBe("auto");
  });

  it("throws when API key is missing", async () => {
    const agent = new ChatAgent(createMcpMock(), webClient);
    await expect(agent.chat("test", { ...settings, apiKey: "" })).rejects.toThrow("API キー");
  });
});
