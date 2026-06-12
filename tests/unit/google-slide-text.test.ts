import { describe, it, expect } from "vitest";
import {
  parseGoogleSlideExtract,
  formatSlideTextForLlm,
  isReadableSlideText,
  isSlideAriaLabel,
  filterSlideAriaLabels,
} from "../../src/shared/utils/google-slide-text";

describe("google-slide-text", () => {
  it("parses successful extract JSON", () => {
    const parsed = parseGoogleSlideExtract(
      JSON.stringify({
        moocsUrl: "https://moocs.iniad.org/courses/2026/COS201/01/01",
        text: "C言語は組込みで使われる",
        charCount: 12,
      })
    );
    expect(parsed?.text).toContain("C言語");
  });

  it("formats slide text with header", () => {
    const formatted = formatSlideTextForLlm(
      {
        moocsUrl: "https://moocs.iniad.org/courses/2026/COS201/01/01",
        text: "本文",
        charCount: 2,
      },
      "https://moocs.iniad.org/courses/2026/COS201/01/01"
    );
    expect(formatted).toContain("MOOCs URL:");
    expect(formatted).toContain("本文");
  });

  it("formats login error with hint", () => {
    const formatted = formatSlideTextForLlm({ error: "google_login_required" });
    expect(formatted).toContain("google_login_required");
  });

  it("rejects script noise as unreadable", () => {
    const noise = "function(a,b){window._docs_flag_initialData={};var x=1;}".repeat(20);
    expect(isReadableSlideText(noise)).toBe(false);
  });

  it("accepts Japanese lecture text", () => {
    const text =
      "C言語は組込みシステムや科学技術計算で標準的な言語である。効率的なプログラミングにはコンピュータの動作原理の理解が不可欠。";
    expect(isReadableSlideText(text)).toBe(true);
  });

  it("filters aria-label noise", () => {
    const filtered = filterSlideAriaLabels([
      "Shift+A",
      "C言語は機械語に近く、とにかく速い",
      "Copyright © 2018 by INIAD",
    ]);
    expect(filtered).toEqual(["C言語は機械語に近く、とにかく速い"]);
    expect(isSlideAriaLabel("⌘+Shift+F")).toBe(false);
  });
});
