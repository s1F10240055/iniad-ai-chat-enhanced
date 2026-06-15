import { describe, it, expect } from "vitest";
import { toIniadGoogleEmail } from "../../src/shared/utils/iniad-email";

describe("toIniadGoogleEmail", () => {
  it("appends @iniad.org to student id", () => {
    expect(toIniadGoogleEmail("s1F102400011")).toBe("s1F102400011@iniad.org");
  });

  it("returns email unchanged if already contains @", () => {
    expect(toIniadGoogleEmail("s1F102400011@iniad.org")).toBe("s1F102400011@iniad.org");
  });

  it("returns empty for blank input", () => {
    expect(toIniadGoogleEmail("  ")).toBe("");
  });
});
