import { describe, expect, it } from "vitest";
import {
  validateApiBaseUrl,
  validateChatInput,
  validateExternalUrl,
  validateSettingsInput,
} from "../../src/main/ipc-validation";

describe("IPC input validation", () => {
  it("normalizes a valid chat message and rejects oversized input", () => {
    expect(validateChatInput("  質問です  ")).toBe("質問です");
    expect(() => validateChatInput("x".repeat(8_001))).toThrow("8,000");
    expect(() => validateChatInput({ text: "bad" })).toThrow("文字列");
  });

  it("accepts only known settings and official API origin", () => {
    expect(validateSettingsInput({ model: "gpt-5.4-mini" })).toEqual({
      model: "gpt-5.4-mini",
    });
    expect(() => validateSettingsInput({ unexpected: "value" })).toThrow("許可されていない");
    expect(() => validateSettingsInput({ model: "arbitrary-model" })).toThrow("モデル");
    expect(validateApiBaseUrl("https://api.openai.iniad.org/api/v1/")).toBe(
      "https://api.openai.iniad.org/api/v1"
    );
    expect(() => validateApiBaseUrl("https://evil.example/v1")).toThrow("公式 INIAD API");
    expect(() => validateApiBaseUrl("http://api.openai.iniad.org/api/v1")).toThrow("HTTPS");
    expect(() => validateApiBaseUrl("https://api.openai.iniad.org/api/v1?token=leak")).toThrow(
      "公式 INIAD API"
    );
  });

  it("allows public HTTPS citations and rejects dangerous destinations", () => {
    expect(validateExternalUrl("https://moocs.iniad.org/courses/2026/COS201")).toContain(
      "moocs.iniad.org"
    );
    expect(() => validateExternalUrl("javascript:alert(1)")).toThrow("安全でない");
    expect(() => validateExternalUrl("https://127.0.0.1/admin")).toThrow("安全でない");
    expect(() => validateExternalUrl("https://[::ffff:127.0.0.1]/admin")).toThrow(
      "安全でない"
    );
    expect(() => validateExternalUrl("https://printer.local/admin")).toThrow("安全でない");
    expect(() => validateExternalUrl("https://intranet/admin")).toThrow("安全でない");
    expect(() => validateExternalUrl("https://user:pass@example.com")).toThrow("安全でない");
  });
});
