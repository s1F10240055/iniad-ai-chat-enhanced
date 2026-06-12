import { describe, it, expect } from "vitest";
import {
  isBlockedSnapshot,
  sortSnapshotsByPriority,
  filterSnapshotsForRag,
  snapshotKindFromCacheKey,
  type CachedSnapshot,
} from "../../src/main/services/moocs-snapshot";

describe("moocs-snapshot", () => {
  describe("isBlockedSnapshot", () => {
    it("detects Google login wall in slide snapshots", () => {
      expect(
        isBlockedSnapshot("heading\niframe:\n  Google アカウントにログイン")
      ).toBe(true);
    });

    it("does not block course overview snapshots", () => {
      const overview = "講義の内容・目的\nC言語は組込みシステムで...";
      expect(isBlockedSnapshot(overview, "course:https://moocs.iniad.org/courses/2026/COS201")).toBe(
        false
      );
    });

    it("does not block normal slide text", () => {
      expect(isBlockedSnapshot("変数はメモリ上に配置される")).toBe(false);
    });

    it("blocks attendance / unpublished pages", () => {
      expect(isBlockedSnapshot("現在この問題は非公開です\n出席確認 Bookmark")).toBe(true);
    });
  });

  describe("snapshotKindFromCacheKey", () => {
    it("maps cache key prefixes to kinds", () => {
      expect(snapshotKindFromCacheKey("course:https://example.com")).toBe("course");
      expect(snapshotKindFromCacheKey("lecture:https://example.com")).toBe("lecture");
      expect(snapshotKindFromCacheKey("https://example.com/slide")).toBe("slide");
    });
  });

  describe("sortSnapshotsByPriority", () => {
    const snapshots: CachedSnapshot[] = [
      { url: "https://s", title: "Slide", data: "x", kind: "slide" },
      { url: "course:https://c", title: "Course", data: "y", kind: "course" },
      { url: "lecture:https://l", title: "Lecture", data: "z", kind: "lecture" },
    ];

    it("orders course before lecture before slide", () => {
      const sorted = sortSnapshotsByPriority(snapshots);
      expect(sorted.map((s) => s.kind)).toEqual(["course", "lecture", "slide"]);
    });
  });

  describe("filterSnapshotsForRag", () => {
    it("includes course and slide kinds but excludes lecture", () => {
      const snapshots: CachedSnapshot[] = [
        { url: "course:c", title: "C", data: "a", kind: "course" },
        { url: "lecture:l", title: "L", data: "現在この問題は非公開です", kind: "lecture" },
        { url: "https://slide", title: "S", data: "変数はメモリ上に配置される", kind: "slide" },
      ];
      const filtered = filterSnapshotsForRag(snapshots);
      expect(filtered.map((s) => s.kind)).toEqual(["course", "slide"]);
    });
  });
});
