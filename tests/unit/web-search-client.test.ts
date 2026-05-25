import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSearchClient } from "../../src/main/services/web-search-client";

const DDG_RESPONSE_WITH_ABSTRACT = {
  Abstract: "Python is a high-level programming language.",
  AbstractURL: "https://en.wikipedia.org/wiki/Python_(programming_language)",
  AbstractSource: "Wikipedia",
  Heading: "Python (programming language)",
  RelatedTopics: [],
  Results: [],
};

const DDG_RESPONSE_WITH_RELATED_TOPICS = {
  Abstract: "",
  AbstractURL: "",
  AbstractSource: "",
  Heading: "",
  RelatedTopics: [
    { Text: "Python tutorial for beginners", FirstURL: "https://example.com/tutorial" },
    {
      Name: "Programming",
      Topics: [
        { Text: "Learn Python step by step", FirstURL: "https://example.com/learn" },
      ],
    },
  ],
  Results: [],
};

const DDG_RESPONSE_WITH_RESULTS = {
  Abstract: "",
  AbstractURL: "",
  AbstractSource: "",
  Heading: "",
  RelatedTopics: [],
  Results: [
    { Text: "Official Python website", FirstURL: "https://www.python.org" },
  ],
};

const DDG_EMPTY_RESPONSE = {
  Abstract: "",
  AbstractURL: "",
  AbstractSource: "",
  Heading: "",
  RelatedTopics: [],
  Results: [],
};

describe("WebSearchClient", () => {
  let client: WebSearchClient;

  beforeEach(() => {
    client = new WebSearchClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("search", () => {
    it("should return abstract result from DuckDuckGo", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(DDG_RESPONSE_WITH_ABSTRACT),
        })
      );

      const result = await client.search("Python");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          title: "Python (programming language)",
          url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
          snippet: "Python is a high-level programming language.",
          source: "web",
          relevanceScore: 0.9,
        })
      );
    });

    it("should parse RelatedTopics (flat and nested)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(DDG_RESPONSE_WITH_RELATED_TOPICS),
        })
      );

      const result = await client.search("Python");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].source).toBe("web");
      expect(result.results[1].source).toBe("web");
    });

    it("should parse Results array", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(DDG_RESPONSE_WITH_RESULTS),
        })
      );

      const result = await client.search("Python");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Official Python website");
    });

    it("should return empty results for empty response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(DDG_EMPTY_RESPONSE),
        })
      );

      const result = await client.search("xyznonexistent");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it("should return empty results for empty/whitespace query", async () => {
      const result = await client.search("   ");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it("should handle non-200 HTTP response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        })
      );

      const result = await client.search("Python");

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    it("should handle timeout errors", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Request timed out"))
      );

      const result = await client.search("Python");

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should handle generic network errors", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error"))
      );

      const result = await client.search("Python");

      expect(result.success).toBe(false);
      expect(result.error).toContain("failed");
    });

    it("should cap related topics at 10 results", async () => {
      const manyTopics = Array.from({ length: 15 }, (_, i) => ({
        Text: `Topic ${i}`,
        FirstURL: `https://example.com/topic-${i}`,
      }));

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            ...DDG_EMPTY_RESPONSE,
            RelatedTopics: manyTopics,
          }),
        })
      );

      const result = await client.search("test");

      expect(result.success).toBe(true);
      expect(result.results.length).toBeLessThanOrEqual(10);
    });
  });
});
