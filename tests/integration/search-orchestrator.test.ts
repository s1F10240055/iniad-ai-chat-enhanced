import { describe, it, expect, vi, afterEach } from "vitest";
import { SearchOrchestrator } from "../../src/main/services/search-orchestrator";
import type { SearchResult } from "../../src/shared/types/search";

function createMockMcpClient(results: SearchResult[] = [], shouldFail = false) {
  return {
    searchMoocs: vi.fn().mockImplementation(async (_query: string) => {
      if (shouldFail) throw new Error("MCP connection failed");
      return { success: true, results };
    }),
    getStatus: vi.fn().mockReturnValue("connected"),
  } as any;
}

function createMockWebClient(results: SearchResult[] = [], shouldFail = false) {
  return {
    search: vi.fn().mockImplementation(async (_query: string) => {
      if (shouldFail) throw new Error("Web search failed");
      return { success: true, results };
    }),
  } as any;
}

describe("SearchOrchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const moocsResult: SearchResult = {
    title: "Python基礎",
    url: "https://moocs.iniad.org/courses/python",
    snippet: "Pythonの基礎を学ぶ",
    source: "moocs",
    relevanceScore: 0.9,
  };

  const webResult: SearchResult = {
    title: "Python Tutorial",
    url: "https://example.com/python",
    snippet: "Learn Python programming",
    source: "web",
    relevanceScore: 0.8,
  };

  describe("search", () => {
    it("should merge results from both sources", async () => {
      const mcpClient = createMockMcpClient([moocsResult]);
      const webClient = createMockWebClient([webResult]);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("Python");

      expect(results).toHaveLength(2);
      expect(mcpClient.searchMoocs).toHaveBeenCalledWith("Python");
      expect(webClient.search).toHaveBeenCalledWith("Python");
    });

    it("should sort results by relevanceScore descending", async () => {
      const mcpClient = createMockMcpClient([moocsResult]);
      const webClient = createMockWebClient([webResult]);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("Python");

      expect(results[0].relevanceScore!).toBeGreaterThanOrEqual(results[1].relevanceScore!);
    });

    it("should cap results at 10", async () => {
      const manyResults: SearchResult[] = Array.from({ length: 15 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        snippet: `Snippet ${i}`,
        source: "moocs" as const,
        relevanceScore: 0.5,
      }));
      const mcpClient = createMockMcpClient(manyResults);
      const webClient = createMockWebClient([]);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("test");

      expect(results.length).toBeLessThanOrEqual(10);
    });

    it("should return web results even when MCP fails", async () => {
      const mcpClient = createMockMcpClient([], true);
      const webClient = createMockWebClient([webResult]);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("Python");

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("web");
    });

    it("should return moocs results even when web search fails", async () => {
      const mcpClient = createMockMcpClient([moocsResult]);
      const webClient = createMockWebClient([], true);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("Python");

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("moocs");
    });

    it("should return empty array for empty query", async () => {
      const mcpClient = createMockMcpClient([moocsResult]);
      const webClient = createMockWebClient([webResult]);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("   ");

      expect(results).toHaveLength(0);
      expect(mcpClient.searchMoocs).not.toHaveBeenCalled();
      expect(webClient.search).not.toHaveBeenCalled();
    });

    it("should return empty array when both sources fail", async () => {
      const mcpClient = createMockMcpClient([], true);
      const webClient = createMockWebClient([], true);
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const results = await orchestrator.search("Python");

      expect(results).toHaveLength(0);
    });
  });

  describe("buildContext", () => {
    it("should format results into context string", () => {
      const mcpClient = createMockMcpClient();
      const webClient = createMockWebClient();
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const context = orchestrator.buildContext([moocsResult, webResult]);

      expect(context).toContain("【検索結果】");
      expect(context).toContain("[1] (MOOCs) Python基礎");
      expect(context).toContain("[2] (Web) Python Tutorial");
      expect(context).toContain("https://moocs.iniad.org/courses/python");
      expect(context).toContain("https://example.com/python");
    });

    it("should return empty string for empty results", () => {
      const mcpClient = createMockMcpClient();
      const webClient = createMockWebClient();
      const orchestrator = new SearchOrchestrator(mcpClient, webClient);

      const context = orchestrator.buildContext([]);

      expect(context).toBe("");
    });
  });
});
