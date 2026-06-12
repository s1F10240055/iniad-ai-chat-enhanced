import { describe, it, expect } from "vitest";
import {
  parseLectureOrdinal,
  lectureNumFromTitle,
  impliesLectureContent,
  pickLectures,
  pickSlides,
  isContentSlide,
  getMoocsPageKind,
  isGoogleSlidePage,
  pickAssignmentSlides,
} from "../../src/main/services/moocs-query";
import type { LectureLink, SlideLink } from "../../src/shared/types/search";

const LECTURES: LectureLink[] = [
  { title: "00: オリエンテーション", url: "https://moocs.iniad.org/courses/2026/COS201/00" },
  { title: "01: C言語と開発環境", url: "https://moocs.iniad.org/courses/2026/COS201/01" },
  { title: "02: ポインタ", url: "https://moocs.iniad.org/courses/2026/COS201/02" },
];

const SLIDES: SlideLink[] = [
  { title: "出席確認", url: "https://moocs.iniad.org/courses/2026/COS201/01/atnd" },
  { title: "1. C言語の光と影", url: "https://moocs.iniad.org/courses/2026/COS201/01/01" },
  { title: "2. 開発環境", url: "https://moocs.iniad.org/courses/2026/COS201/01/02" },
  { title: "演習課題", url: "#" },
];

const titleMatcher = (title: string, query: string) =>
  title.toLowerCase().includes(query.toLowerCase());

describe("moocs-query", () => {
  describe("parseLectureOrdinal", () => {
    it("maps 初回 to 01", () => {
      expect(parseLectureOrdinal("講義資料の初回をまとめて")).toBe("01");
    });

    it("maps 第2回 to 02", () => {
      expect(parseLectureOrdinal("第2回の要点")).toBe("02");
    });
  });

  describe("lectureNumFromTitle", () => {
    it("extracts lecture number from MOOCs title", () => {
      expect(lectureNumFromTitle("01: C言語と開発環境")).toBe("01");
    });
  });

  describe("impliesLectureContent", () => {
    it("detects lecture material queries", () => {
      expect(impliesLectureContent("講義資料の初回をまとめてください")).toBe(true);
    });
  });

  describe("pickLectures", () => {
    it("selects lecture by ordinal when title tokens do not match", () => {
      const picked = pickLectures(LECTURES, "講義資料の初回をまとめて", titleMatcher);
      expect(picked).toHaveLength(1);
      expect(picked[0].title).toContain("01:");
    });

    it("falls back to first numbered lecture for generic 講義資料 query", () => {
      const picked = pickLectures(LECTURES, "講義資料をまとめて", titleMatcher);
      expect(picked[0].title).toContain("01:");
    });
  });

  describe("isContentSlide", () => {
    it("excludes attendance and placeholder slides", () => {
      expect(isContentSlide(SLIDES[0])).toBe(false);
      expect(isContentSlide(SLIDES[1])).toBe(true);
      expect(isContentSlide(SLIDES[3])).toBe(false);
    });
  });

  describe("pickSlides", () => {
    it("returns content slides for lecture material queries", () => {
      const picked = pickSlides(SLIDES, "講義資料の初回をまとめて", titleMatcher);
      expect(picked.map((s) => s.title)).toEqual(["1. C言語の光と影", "2. 開発環境"]);
    });
  });

  describe("getMoocsPageKind", () => {
    it("classifies page types from URL", () => {
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/01")).toBe("slide");
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/review")).toBe(
        "review"
      );
      expect(getMoocsPageKind("https://moocs.iniad.org/courses/2026/COS201/01/exercise")).toBe(
        "exercise"
      );
      expect(isGoogleSlidePage("https://moocs.iniad.org/courses/2026/COS201/01/review")).toBe(false);
    });
  });

  describe("pickAssignmentSlides", () => {
    const slides: SlideLink[] = [
      { title: "課題解説", url: "https://moocs.iniad.org/courses/2026/COS201/01/review" },
      { title: "演習課題", url: "https://moocs.iniad.org/courses/2026/COS201/01/exercise" },
    ];

    it("picks review page for 課題解説 query", () => {
      const picked = pickAssignmentSlides(slides, "第1回の課題解説");
      expect(picked[0].url).toContain("/review");
    });
  });
});
