import { describe, it, expect } from "vitest";
import { SlidesIndexService } from "../../src/main/services/slides-index";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("SlidesIndexService.getTextByMoocsUrl", () => {
  it("returns indexed text for matching URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "slides-index-"));
    const path = join(dir, "slides-index.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        entries: [
          {
            courseCode: "COS201",
            courseName: "プログラミング言語",
            lectureNum: "01",
            slideNum: "01",
            slideTitle: "1. C言語の光と影",
            moocsUrl: "https://moocs.iniad.org/courses/2026/COS201/01/01",
            text: "C言語の本文",
            keywords: [],
          },
        ],
      })
    );

    const service = new SlidesIndexService();
    service.load(path);

    expect(service.getTextByMoocsUrl("https://moocs.iniad.org/courses/2026/COS201/01/01/")).toBe(
      "C言語の本文"
    );
    expect(
      service.getTextByMoocsUrl("https://moocs.iniad.org/courses/2026/COS201/01/02")
    ).toBeNull();
    expect(
      service.getEntryByMoocsUrl("https://moocs.iniad.org/courses/2026/COS201/01/01/")
    ).toMatchObject({
      courseName: "プログラミング言語",
      lectureNum: "01",
      slideNum: "01",
      slideTitle: "1. C言語の光と影",
    });
  });
});
