import { describe, it, expect } from "vitest";
import {
  parseLectureOrdinal,
  impliesLectureContent,
} from "../../src/main/services/moocs-query";

describe("moocs-query", () => {
  describe("parseLectureOrdinal", () => {
    it("maps 初回 to 01", () => {
      expect(parseLectureOrdinal("講義資料の初回をまとめて")).toBe("01");
    });

    it("maps 第2回 to 02", () => {
      expect(parseLectureOrdinal("第2回の要点")).toBe("02");
    });

    it("maps full-width 第１回 to 01", () => {
      expect(parseLectureOrdinal("第１回の要点")).toBe("01");
    });

    it("maps full-width １回目 to 01", () => {
      expect(parseLectureOrdinal("課題の１回目を教えて")).toBe("01");
    });
  });

  describe("impliesLectureContent", () => {
    it("detects lecture material queries", () => {
      expect(impliesLectureContent("講義資料の初回をまとめてください")).toBe(true);
    });
  });
});
