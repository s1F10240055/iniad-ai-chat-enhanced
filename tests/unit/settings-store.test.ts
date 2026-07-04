import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// safeStorage は vi.fn で定義し、テスト内で vi.mocked() により挙動を切り替える
// （フォールバックテスト��� isEncryptionAvailable を false にするなど）。
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    // 可逆な単純変換（UTF-8 Buffer）。本番の OS 暗号化の代用。
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf-8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf-8")),
  },
}));

// vi.mock は hoisting ���れるので、import はモック適用後に解決される
import { safeStorage } from "electron";
import { SettingsStore } from "../../src/main/services/settings-store";

/** ファイルの存在チェック */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("SettingsStore", () => {
  let store: SettingsStore;
  let tempPath: string;
  let credPath: string;

  beforeEach(async () => {
    // safeStorage デフォルト（暗号化利用可能・可逆変換）に戻す
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => Buffer.from(s, "utf-8"));
    vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString("utf-8"));

    tempPath = join(tmpdir(), `settings-test-${randomUUID()}.json`);
    credPath = join(dirname(tempPath), "credentials.enc");
    store = new SettingsStore();
    await store.init(tempPath);
  });

  afterEach(async () => {
    for (const p of [tempPath, credPath, `${credPath}.bak`]) {
      try {
        await fs.unlink(p);
      } catch {
        // ファイルがない場合は無視
      }
    }
  });

  // ── 既存の基本テスト（暗号化下でも契約不变） ──

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
    await store.updateSettings({ apiKey: "sk-real", moocsPassword: "secret-pass" });
    const echoed = store.getSettings();
    await store.updateSettings(echoed);

    expect(store.getRawSettings().apiKey).toBe("sk-real");
    expect(store.getRawSettings().moocsPassword).toBe("secret-pass");
  });

  // ── safeStorage 暗号化・2ファイル分離 ──

  it("保存した機密値はファイル再読込で正しく復元される（暗号化往復・マルチバイト含む）", async () => {
    await store.updateSettings({ apiKey: "sk-12345", moocsPassword: "パスワード123" });

    const reloaded = new SettingsStore();
    await reloaded.init(tempPath);
    expect(reloaded.getRawSettings().apiKey).toBe("sk-12345");
    expect(reloaded.getRawSettings().moocsPassword).toBe("パスワード123");
  });

  it("credentials.enc に機密の平文が含まれな��", async () => {
    await store.updateSettings({ apiKey: "sk-secret-key", moocsPassword: "plain-secret-pass" });
    const credContent = await fs.readFile(credPath, "utf-8");
    expect(credContent).not.toContain("sk-secret-key");
    expect(credContent).not.toContain("plain-secret-pass");
  });

  it("settings.json には機密フィールドが含まれず、非機密のみ格納される", async () => {
    await store.updateSettings({ apiKey: "sk-real", moocsPassword: "secret" });
    const parsed = JSON.parse(await fs.readFile(tempPath, "utf-8"));
    expect(parsed).not.toHaveProperty("apiKey");
    expect(parsed).not.toHaveProperty("moocsPassword");
    expect(parsed).toHaveProperty("baseURL");
    expect(parsed).toHaveProperty("model");
    expect(parsed).toHaveProperty("moocsUsername");
  });

  it("旧形式（平文 settings.json に機密含む）から credentials.enc に自動移行する", async () => {
    // init が作ったファイルを一旦削除し、旧形式の平文 settings.json ���置く
    await fs.unlink(tempPath);
    if (await exists(credPath)) await fs.unlink(credPath);
    const legacy = {
      apiKey: "legacy-key",
      baseURL: "https://legacy.example.com/v1",
      model: "gpt-legacy",
      moocsUsername: "legacy-user",
      moocsPassword: "legacy-pass",
    };
    await fs.writeFile(tempPath, JSON.stringify(legacy, null, 2), "utf-8");

    const migrated = new SettingsStore();
    await migrated.init(tempPath);

    // 機密は credentials.enc から復元
    expect(migrated.getRawSettings().apiKey).toBe("legacy-key");
    expect(migrated.getRawSettings().moocsPassword).toBe("legacy-pass");
    // 非機密も保持
    expect(migrated.getRawSettings().baseURL).toBe("https://legacy.example.com/v1");
    expect(migrated.getRawSettings().moocsUsername).toBe("legacy-user");

    // settings.json から機密が削除されている
    const settingsAfter = JSON.parse(await fs.readFile(tempPath, "utf-8"));
    expect(settingsAfter).not.toHaveProperty("apiKey");
    expect(settingsAfter).not.toHaveProperty("moocsPassword");
    // credentials.enc が生成され、平文を含まない
    expect(await exists(credPath)).toBe(true);
    const credContent = await fs.readFile(credPath, "utf-8");
    expect(credContent).not.toContain("legacy-key");
    expect(credContent).not.toContain("legacy-pass");
  });

  it("credentials.enc の復号に失敗した場合は .bak に退避し機密は空にフォールバックする", async () => {
    await store.updateSettings({ apiKey: "sk-real", moocsPassword: "secret" });
    // credentials.enc を復号不能な内容で破損させる
    await fs.writeFile(credPath, "this-is-not-valid-encrypted-content", "utf-8");

    const reloaded = new SettingsStore();
    await reloaded.init(tempPath);

    // 機密は空（ユーザー再入力が必要）
    expect(reloaded.getRawSettings().apiKey).toBe("");
    expect(reloaded.getRawSettings().moocsPassword).toBe("");
    // 破損ファイルは .bak に退避されている
    expect(await exists(`${credPath}.bak`)).toBe(true);
  });

  it("safeStorage が利用不可の場合は平文フォールバックで保存・復元��きる", async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

    const fallback = new SettingsStore();
    await fallback.init(tempPath);
    await fallback.updateSettings({ apiKey: "sk-fallback", moocsPassword: "fallback-pass" });

    // 再読込でも復元できる（平文フォールバック経由）
    const reloaded = new SettingsStore();
    await reloaded.init(tempPath);
    expect(reloaded.getRawSettings().apiKey).toBe("sk-fallback");
    expect(reloaded.getRawSettings().moocsPassword).toBe("fallback-pass");
  });
});
