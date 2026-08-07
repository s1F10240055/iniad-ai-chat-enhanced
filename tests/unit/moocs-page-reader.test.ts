import { describe, it, expect, vi } from "vitest";
import { MoocsPageReader } from "../../src/main/services/moocs-page-reader";
import type { McpClient } from "../../src/main/services/mcp-client";
import type { SlidesIndexService } from "../../src/main/services/slides-index";

const SLIDE_URL = "https://moocs.iniad.org/courses/2026/COS201/01/01";
const REVIEW_URL = "https://moocs.iniad.org/courses/2026/COS201/01/review";

function createMcpMock(overrides: Partial<McpClient> = {}): McpClient {
  return {
    navigateTo: vi.fn().mockResolvedValue(undefined),
    expandSlideTab: vi.fn().mockResolvedValue(undefined),
    extractGoogleSlideText: vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            moocsUrl: SLIDE_URL,
            text: "C言語は組込みシステムで標準的な言語である。",
            slideCount: 1,
          }),
        },
      ],
    }),
    getPageSnapshot: vi.fn().mockResolvedValue("現在この問題は非公開です"),
    ...overrides,
  } as unknown as McpClient;
}

describe("MoocsPageReader", () => {
  it("reads HTML review page without Google slide extraction", async () => {
    const mcpClient = createMcpMock();
    const reader = new MoocsPageReader(mcpClient);

    const result = await reader.readPage(REVIEW_URL);

    expect(mcpClient.navigateTo).toHaveBeenCalledWith(REVIEW_URL, undefined);
    expect(mcpClient.extractGoogleSlideText).not.toHaveBeenCalled();
    expect(result.content).toContain("Page kind: review");
    expect(result.content).toContain("非公開");
    expect(result.citations.some((c) => c.url === REVIEW_URL)).toBe(true);
  });

  it("uses slides-index when loaded before MCP extraction", async () => {
    const mcpClient = createMcpMock();
    const slidesIndex = {
      isLoaded: vi.fn().mockReturnValue(true),
      getEntryByMoocsUrl: vi.fn().mockReturnValue({
        courseCode: "COS201",
        courseName: "プログラミング言語",
        lectureNum: "01",
        slideNum: "01",
        slideTitle: "C言語の光と影",
        moocsUrl: SLIDE_URL,
        text: "indexed slide text",
        keywords: [],
      }),
    } as unknown as SlidesIndexService;

    const reader = new MoocsPageReader(mcpClient, slidesIndex);
    const result = await reader.readPage(SLIDE_URL);

    expect(slidesIndex.getEntryByMoocsUrl).toHaveBeenCalledWith(SLIDE_URL);
    expect(mcpClient.extractGoogleSlideText).not.toHaveBeenCalled();
    expect(result.content).toContain("slides-index");
    expect(result.content).toContain("indexed slide text");
    expect(result.citations[0]).toMatchObject({
      title: "プログラミング言語: C言語の光と影",
      location: "第1回 / 資料1",
      sourceType: "moocs",
    });
    expect(result.materials).toEqual([
      expect.objectContaining({
        url: SLIDE_URL,
        content: expect.stringContaining("indexed slide text"),
      }),
    ]);
  });

  it("extracts Google slide text when index has no entry", async () => {
    const mcpClient = createMcpMock();
    const slidesIndex = {
      isLoaded: vi.fn().mockReturnValue(true),
      getEntryByMoocsUrl: vi.fn().mockReturnValue(null),
    } as unknown as SlidesIndexService;

    const reader = new MoocsPageReader(mcpClient, slidesIndex);
    const result = await reader.readPage(SLIDE_URL);

    expect(mcpClient.expandSlideTab).toHaveBeenCalled();
    expect(mcpClient.extractGoogleSlideText).toHaveBeenCalled();
    expect(result.content).toContain("C言語");
  });

  it("returns cached content on repeated read", async () => {
    const mcpClient = createMcpMock();
    const cache = new Map<string, string>();
    cache.set(SLIDE_URL, "cached content");

    const reader = new MoocsPageReader(mcpClient, undefined, cache);
    const result = await reader.readPage(SLIDE_URL);

    expect(mcpClient.navigateTo).not.toHaveBeenCalled();
    expect(result.content).toBe("cached content");
  });
});
