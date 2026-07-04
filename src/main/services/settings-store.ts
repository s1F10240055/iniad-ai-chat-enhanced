/**
 * SettingsStore - アプリケーション設定の永続化・管理
 *
 * 設定は機密性に応じて2ファイルに分離して保存する:
 * - settings.json : 非機密設定（baseURL/model/moocsUsername）
 * - credentials.enc : 機密情報（apiKey/moocsPassword）を safeStorage で暗号化
 *
 * 機密値は Renderer に送信せず、設定済みフラグ（hasApiKey/hasMoocsCredentials）でのみ伝える。
 */

import { app, safeStorage } from "electron";
import { promises as fs } from "fs";
import { join, dirname } from "path";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  PartialAppSettings,
  PublicAppSettings,
} from "../../shared/types/settings";

/** 設定ファイル名 */
const SETTINGS_FILE = "settings.json";
/** 機密情報（APIキー・MOOCsパスワード）の暗号化ファイル名 */
const CREDENTIALS_FILE = "credentials.enc";

/** 平文フォールバック時のプレフィックス（safeStorage が利用不可の環境向け） */
const PLAINTEXT_PREFIX = "plaintext:";

/** credentials.enc に格納する機密情報の構造 */
interface Secrets {
  apiKey: string;
  moocsPassword: string;
}

/**
 * SettingsStore クラス
 *
 * @example
 * ```ts
 * const store = new SettingsStore();
 * await store.init();
 * const settings = store.getSettings();     // 機密は空文字列+設定済みフラグ
 * const rawSettings = store.getRawSettings(); // 生の値（main プロセス内のみ）
 * await store.updateSettings({ apiKey: "new-key" });
 * ```
 */
export class SettingsStore {
  private settingsPath: string = "";
  private credentialsPath: string = "";
  private cache: AppSettings | null = null;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor() {
    // コンストラクタでは何もしない（app.getPath()はapp.whenReady()後に呼ぶ必要がある）
  }

  /**
   * 設定ストアの初期化
   *
   * 1. 旧形式（機密が平文で settings.json に含まれる）があれば credentials.enc に自動移行
   * 2. settings.json（非機密）と credentials.enc（機密）を読み込みマージ
   *
   * @param customPath - テスト用 settings.json フルパス（省略時は userData 配下）
   */
  async init(customPath?: string): Promise<void> {
    // Electron app が初期化された後にパスを解決する
    // customPath はテスト用（省略時は userData 配下���使用）
    if (customPath) {
      this.settingsPath = customPath;
    } else {
      const userDataPath = app.getPath("userData");
      this.settingsPath = join(userDataPath, SETTINGS_FILE);
    }
    // credentials.enc は settings.json と同��ディレクトリに置く
    this.credentialsPath = join(dirname(this.settingsPath), CREDENTIALS_FILE);

    try {
      await this.migrateLegacySecrets();
      await this.ensureSettingsFile();
      this.cache = await this.loadFromFiles();
    } catch (error) {
      // 読み込み失敗時はデフォルト値を使用し、ファイルを修復する
      console.error("Failed to load settings, using defaults and healing files:", error);
      this.cache = { ...DEFAULT_SETTINGS };
      await this.saveAllFiles(this.cache);
    }
  }

  /**
   * 設定を取得する（APIキー・パスワードは値を含まず空文字列・設定済みフラグで示す）
   *
   * 機密値を Renderer に送らないことで、未編集時の誤上書きを防ぐ。
   */
  getSettings(): PublicAppSettings {
    if (!this.cache) {
      throw new Error("SettingsStore not initialized. Call init() first.");
    }
    return {
      apiKey: "",
      baseURL: this.cache.baseURL,
      model: this.cache.model,
      moocsUsername: this.cache.moocsUsername,
      moocsPassword: "",
      hasApiKey: this.cache.apiKey.length > 0,
      hasMoocsCredentials:
        this.cache.moocsUsername.length > 0 && this.cache.moocsPassword.length > 0,
    };
  }

  /**
   * 生の設定値を取得する（IPC等、内部処理用）
   */
  getRawSettings(): AppSettings {
    if (!this.cache) {
      throw new Error("SettingsStore not initialized. Call init() first.");
    }
    return { ...this.cache };
  }

  /**
   * 設定を部分的に更新する
   *
   * @param partialSettings - 部分的な設定値（空文字列は既存値を維持）
   */
  async updateSettings(partialSettings: PartialAppSettings): Promise<void> {
    if (!this.cache) {
      throw new Error("SettingsStore not initialized. Call init() first.");
    }

    // 前の更新が完了するまで待つことで、レースコンディションを防止
    this.updateQueue = this.updateQueue.then(async () => {
      const updated = { ...this.cache! };

      // 既知のキーのみを許可（未知のキーやプロトタイプ汚染対策）
      const knownKeys = ["apiKey", "baseURL", "model", "moocsUsername", "moocsPassword"] as const;

      for (const [key, value] of Object.entries(partialSettings)) {
        // バリデーション: 既知のキー && 文字列型 && 空文字でない
        if (
          knownKeys.includes(key as (typeof knownKeys)[number]) &&
          typeof value === "string" &&
          value !== ""
        ) {
          (updated as Record<string, string>)[key] = value;
        }
        // undefined/null や未知のキーは無音でスキップ
      }

      this.cache = updated;
      await this.saveAllFiles(updated);
    });

    await this.updateQueue;
  }

  /**
   * APIキーが設定されているかチェック
   */
  hasApiKey(): boolean {
    return this.getRawSettings().apiKey.length > 0;
  }

  /**
   * MOOCs認証情報が設定されているかチェック
   */
  hasMoocsCredentials(): boolean {
    const raw = this.getRawSettings();
    return raw.moocsUsername.length > 0 && raw.moocsPassword.length > 0;
  }

  /**
   * 設定ファイルのパスを取得（テスト用）
   */
  getSettingsPath(): string {
    return this.settingsPath;
  }

  /**
   * 機密ファイルのパスを取得（テスト用）
   */
  getCredentialsPath(): string {
    return this.credentialsPath;
  }

  /**
   * 設定をクリアしてデフォルト値に戻す（テスト用）
   */
  async reset(): Promise<void> {
    this.cache = { ...DEFAULT_SETTINGS };
    await this.saveAllFiles(this.cache);
  }

  // ── 初期化・読み込み ──────────────────────────────

  /**
   * 設定ファイルが存在しない場合は作成する（非機密のみ）
   */
  private async ensureSettingsFile(): Promise<void> {
    if (await this.fileExists(this.settingsPath)) return;
    // ファイルが存在しない場合はデフォルト値で作成
    await this.saveSettingsFile(DEFAULT_SETTINGS);
  }

  /**
   * settings.json（非機密）と credentials.enc（機密）を読み込みマージする
   */
  private async loadFromFiles(): Promise<AppSettings> {
    const nonSecret = await this.loadSettingsFile();
    const secrets = await this.loadCredentialsFile();
    return {
      apiKey: secrets.apiKey,
      baseURL: nonSecret.baseURL ?? DEFAULT_SETTINGS.baseURL,
      model: nonSecret.model ?? DEFAULT_SETTINGS.model,
      moocsUsername: nonSecret.moocsUsername ?? DEFAULT_SETTINGS.moocsUsername,
      moocsPassword: secrets.moocsPassword,
    };
  }

  /**
   * settings.json を読み込む（非機密。旧形式なら機密が含まれている可能性もある）
   */
  private async loadSettingsFile(): Promise<Partial<AppSettings>> {
    try {
      const content = await fs.readFile(this.settingsPath, "utf-8");
      return JSON.parse(content) as Partial<AppSettings>;
    } catch {
      // ファイルなし・破損時は空（デフォルトで補完される）
      return {};
    }
  }

  /**
   * credentials.enc を読み込み復号する
   * 復号失敗/破損時は .bak に退避し、機密は空で継続（ユーザーに再入力を促す）
   */
  private async loadCredentialsFile(): Promise<Secrets> {
    const empty: Secrets = { apiKey: "", moocsPassword: "" };
    if (!(await this.fileExists(this.credentialsPath))) {
      return empty;
    }

    try {
      const content = await fs.readFile(this.credentialsPath, "utf-8");
      const decrypted = this.decryptSecrets(content);
      const parsed = JSON.parse(decrypted) as Partial<Secrets>;
      return {
        apiKey: parsed.apiKey ?? "",
        moocsPassword: parsed.moocsPassword ?? "",
      };
    } catch (error) {
      // 復号失敗（破損/別PC持ち込みでDPAPI復号不可）→ .bak に退避
      console.warn(
        "[SettingsStore] Failed to decrypt credentials.enc, backing up. Re-enter secrets:",
        error
      );
      try {
        await fs.rename(this.credentialsPath, `${this.credentialsPath}.bak`);
      } catch {
        // リネーム失敗（権限等）は無視
      }
      return empty;
    }
  }

  /**
   * 旧形式（機密が平文で settings.json に含まれる）から credentials.enc に移行する
   *
   * - credentials.enc が未生成なら settings.json の機密を暗号化して新規作成
   * - credentials.enc が既存ならそちらを正とし settings.json の機��は無視
   * - いずれの場合も settings.json から機密を削除して非機密のみに正規化
   */
  private async migrateLegacySecrets(): Promise<void> {
    const legacy = await this.loadSettingsFile();
    const hasLegacySecrets =
      (legacy.apiKey && legacy.apiKey.length > 0) ||
      (legacy.moocsPassword && legacy.moocsPassword.length > 0);

    if (!hasLegacySecrets) return;

    if (!(await this.fileExists(this.credentialsPath))) {
      // credentials.enc なし → settings.json の機密を暗号化して移行
      await this.saveCredentialsFile({
        apiKey: legacy.apiKey ?? "",
        moocsPassword: legacy.moocsPassword ?? "",
      });
      console.log("[SettingsStore] Migrated legacy plaintext secrets to credentials.enc");
    }
    // credentials.enc が既存ならそちらを正とみなし、settings.json の機密は無視して破棄

    // settings.json を非機密のみに正規化（apiKey/moocsPassword は保存対象外で自動的に消える）
    const sanitized: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...legacy,
      apiKey: "",
      moocsPassword: "",
    };
    await this.saveSettingsFile(sanitized);
  }

  // ── 保存 ──────────────────────────────────────────

  /**
   * 両ファイルを保存する（updateQueue 内で呼ばれ原子性を確保）
   */
  private async saveAllFiles(settings: AppSettings): Promise<void> {
    await this.saveSettingsFile(settings);
    await this.saveCredentialsFile({
      apiKey: settings.apiKey,
      moocsPassword: settings.moocsPassword,
    });
  }

  /**
   * settings.json に非機密フィールドのみ保存する
   */
  private async saveSettingsFile(settings: AppSettings): Promise<void> {
    const nonSecret = {
      baseURL: settings.baseURL,
      model: settings.model,
      moocsUsername: settings.moocsUsername,
    };
    await fs.writeFile(this.settingsPath, JSON.stringify(nonSecret, null, 2), "utf-8");
    await this.chmod0600(this.settingsPath);
  }

  /**
   * credentials.enc に機密を暗号化して保存する
   */
  private async saveCredentialsFile(secrets: Secrets): Promise<void> {
    const json = JSON.stringify(secrets);
    const encrypted = this.encryptSecrets(json);
    await fs.writeFile(this.credentialsPath, encrypted, "utf-8");
    await this.chmod0600(this.credentialsPath);
  }

  // ── 暗号化ヘルパー ────────────────────────────────

  /**
   * 機密 JSON を暗号化して base64 文字列で返す
   * safeStorage が利用不可（Linux 一部等）の場合は平文フォールバック
   */
  private encryptSecrets(plaintextJson: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plaintextJson);
      return encrypted.toString("base64");
    }
    console.warn(
      "[SettingsStore] safeStorage unavailable. Credentials fall back to plaintext (insecure)."
    );
    return PLAINTEXT_PREFIX + Buffer.from(plaintextJson, "utf-8").toString("base64");
  }

  /**
   * 暗号化された文字列を復号して JSON 文字列を返す
   */
  private decryptSecrets(stored: string): string {
    if (stored.startsWith(PLAINTEXT_PREFIX)) {
      const b64 = stored.slice(PLAINTEXT_PREFIX.length);
      return Buffer.from(b64, "base64").toString("utf-8");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage unavailable but credentials appear to be encrypted");
    }
    const buf = Buffer.from(stored, "base64");
    return safeStorage.decryptString(buf);
  }

  // ── ユーティリティ ────────────────────────────────

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ファイル権限を 0600（オーナー読み書きのみ）に設定（POSIX 環境でのみ実効）
   */
  private async chmod0600(filePath: string): Promise<void> {
    try {
      await fs.chmod(filePath, 0o600);
    } catch {
      // Windows や権限不足では無視（design.md §6 準拠: Windows は ACL で保護）
    }
  }
}

/**
 * シングルトンインスタンス
 *
 * @example
 * ```ts
 * import { settingsStore } from "./settings-store.js";
 * await settingsStore.init();
 * ```
 */
export const settingsStore = new SettingsStore();
