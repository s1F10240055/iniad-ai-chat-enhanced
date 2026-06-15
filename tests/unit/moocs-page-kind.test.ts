import { describe, it, expect } from "vitest";
import {
  getMoocsPageKind,
  isGoogleSlidePage,
  pageCitationTitle,
} from "../../src/main/services/moocs-page-kind";

describe("moocs-page-kind", () => {
  describe("getMoocsPageKind", () => {
    it("classifies page types from URL", () => {
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/01")).toBe("slide");
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/review")).toBe(
        "review"
      );
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/exercise")).toBe(
        "exercise"
      );
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/atnd")).toBe(
        "attendance"
      );
      expect(isGoogleSlidePage("https://moocs.iniad.org/courses/2026/COS201/01/review")).toBe(false);
    });
  });

  describe("pageCitationTitle", () => {
    it("returns localized title for page kind", () => {
      expect(pageCitationTitle("https://moocs.iniad.org/courses/2026/COS201/01/review")).toBe(
        "課題解説"
      );
      expect(pageCitationTitle("https://moocs.iniad.org/courses/2026/COS201/01/01")).toBe(
        "MOOCs スライド"
      );
    });
  });
});
