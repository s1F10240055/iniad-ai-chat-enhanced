import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SlidesIndexService } from "../../src/main/services/slides-index";

const FIXTURE = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    {
      courseCode: "COS201",
      courseName: "プログラミング言語",
      lectureNum: "01",
      slideNum: "01",
      slideTitle: "1. C言語の光と影",
      moocsUrl: "https://moocs.iniad.org/courses/2026/COS201/01/01",
      text: "C言語はメモリ上の変数と機械語について学ぶ",
      keywords: ["C言語", "メモリ"],
    },
  ],
};

describe("SlidesIndexService", () => {
  let indexPath: string;
  let service: SlidesIndexService;

  beforeEach(() => {
    const dir = join(tmpdir(), `slides-index-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    indexPath = join(dir, "slides-index.json");
    writeFileSync(indexPath, JSON.stringify(FIXTURE));
    service = new SlidesIndexService();
    service.load(indexPath);
  });

  it("loads index and matches query tokens", () => {
    expect(service.isLoaded()).toBe(true);
    const matches = service.matchSlides("C言語 メモリ");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].slideTitle).toContain("C言語");
  });

  it("returns empty for unrelated query", () => {
    expect(service.matchSlides("量子力学")).toHaveLength(0);
  });

  it("matches 初回 to lecture 01 entries", () => {
    const matches = service.matchSlides("講義資料の初回をまとめてください");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].text).toContain("C言語");
    expect(matches[0].moocsUrl).toContain("/01/01");
  });
});
