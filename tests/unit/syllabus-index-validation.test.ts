import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SyllabusIndexService } from "../../src/main/services/syllabus-index";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SyllabusIndexService validation", () => {
  it.each([
    ["non-array courses", { version: 1, courses: { length: 1 } }],
    ["invalid course entry", { version: 1, courses: [null] }],
  ])("fails closed for %s", (_label, payload) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), "syllabus-index-validation-"));
    temporaryDirectories.push(dir);
    const indexPath = join(dir, "syllabus-index.json");
    writeFileSync(indexPath, JSON.stringify(payload));
    const service = new SyllabusIndexService();

    service.load(indexPath);

    expect(service.isLoaded()).toBe(false);
    expect(service.matchCourses("プログラミング")).toEqual([]);
  });
});
