import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// SettingsStore は内部で electron の app を import するが、
// init(customPath) でパスを注入すれば app.getPath は呼ばれない。
// モジュール解決時の副作用を避けるため app をモックしておく。
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
}));

import { SettingsStore } from "../../src/main/services/settings-store";

describe("SettingsStore", () => {
  let store: SettingsStore;
  let tempPath: string;

  beforeEach(async () => {
    tempPath = join(tmpdir(), `settings-test-${randomUUID()}.json`);
    store = new SettingsStore();
    await store.init(tempPath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ���ァイルがない場合は無視
    }
  });

  it("updateSettings で apiKey が保存され getRawSettings で読める", async () => {
    await store.updateSettings({ apiKey: "sk-real" });
    expect(store.getRawSettings().apiKey).toBe("sk-real");
  });

  it("getSettings は機密フィールド（apiKey, moocsPassword）の値を含まない", async () => {
    await store.updateSettings({ apiKey: "sk-real", moocsPassword: "secret-pass" });
    const publicSettings = store.getSettings();
    expect(publicSettings.apiKey).toBe("");
    expect(publicSettings.moocsPassword).toBe("");
  });

  it("非機密フィールドは getSettings で実値が返る", async () => {
    await store.updateSettings({
      baseURL: "https://example.com/v1",
      model: "gpt-test",
      moocsUsername: "s1F10xxx@iniad.org",
    });
    const publicSettings = store.getSettings();
    expect(publicSettings.baseURL).toBe("https://example.com/v1");
    expect(publicSettings.model).toBe("gpt-test");
    expect(publicSettings.moocsUsername).toBe("s1F10xxx@iniad.org");
  });

  it("hasApiKey フラグが APIキーの設定済み状態を示す", async () => {
    expect(store.getSettings().hasApiKey).toBe(false);
    await store.updateSettings({ apiKey: "sk-real" });
    expect(store.getSettings().hasApiKey).toBe(true);
  });

  it("hasMoocsCredentials はユーザー名＋パスワードのペアが揃った時のみ true になる", async () => {
    expect(store.getSettings().hasMoocsCredentials).toBe(false);
    await store.updateSettings({ moocsUsername: "s1F10xxx@iniad.org" });
    expect(store.getSettings().hasMoocsCredentials).toBe(false);
    await store.updateSettings({ moocsPassword: "secret-pass" });
    expect(store.getSettings().hasMoocsCredentials).toBe(true);
  });

  it("getSettings の戻り値をそのまま updateSettings に送っても既存値が壊れない（リグレッション）", async () => {
    // 機密値を保存
    await store.updateSettings({ apiKey: "sk-real", moocsPassword: "secret-pass" });

    // 【バグ再現パターン】設定画面が getSettings の戻り値をそのまま保存し直す
    // 旧実装ではマスク値 "••••••••" が保存され���本物の値が壊れていた。
    // 新仕様では空文字列が返るため、updateSettings が空文字列を無視して既存値を維持する。
    const echoed = store.getSettings();
    await store.updateSettings({
      apiKey: echoed.apiKey,
      moocsPassword: echoed.moocsPassword,
    });

    expect(store.getRawSettings().apiKey).toBe("sk-real");
    expect(store.getRawSettings().moocsPassword).toBe("secret-pass");
  });
});
