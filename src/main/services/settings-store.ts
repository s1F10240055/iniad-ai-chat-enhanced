/**
 * SettingsStore - アプリケーション設定の永続化・管理
 *
 * 設定は userData ディレクトリの settings.json に保存される
 * セキュリティのため、APIキーやパスワードはマスクして返却する
 */

import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  PartialAppSettings,
  PublicAppSettings,
} from "../../shared/types/settings";

/** 設定ファイル名 */
const SETTINGS_FILE = "settings.json";

/**
 * SettingsStore クラス
 *
 * @example
 * ```ts
 * const store = new SettingsStore();
 * await store.init();
 * const settings = await store.getSettings(); // マスク済み
 * const rawSettings = await store.getRawSettings(); // 生の値
 * await store.updateSettings({ apiKey: "new-key" });
 * ```
 */
export class SettingsStore {
  private settingsPath: string = "";
  private cache: AppSettings | null = null;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor() {
    // コンストラクタでは何もしない（app.getPath()はapp.whenReady()後に呼ぶ必要がある）
  }

  /**
   * 設定ストアの初期化
   * 設定ファイルが存在しない場合はデフォルト値を作成する
   */
  async init(customPath?: string): Promise<void> {
    // Electron app が初期化された後にパスを解決する
    // customPath はテスト用（省略時は userData 配下を使用）
    if (customPath) {
      this.settingsPath = customPath;
    } else {
      const userDataPath = app.getPath("userData");
      this.settingsPath = join(userDataPath, SETTINGS_FILE);
    }

    try {
      await this.ensureSettingsFile();
      this.cache = await this.loadFromFile();
    } catch (error) {
      // 読み込み失敗時はデフォルト値を使用し、破損したファイルを修復する
      console.error("Failed to load settings, using defaults and healing file:", error);
      this.cache = { ...DEFAULT_SETTINGS };
      await this.saveToFile(this.cache);
    }
  }

  /**
   * 設定を取得する（APIキー・パスワードは値を含まず空文字列・設定済みフラグで示す）
   *
   * 機密値を Renderer に送らないことで、未編集時の誤上書きを防ぐ。
   * 設定済みかどうかは hasApiKey / hasMoocsCredentials フラグで伝える。
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
      await this.saveToFile(updated);
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
   * 設定をクリアしてデフォルト値に戻す（テスト用）
   */
  async reset(): Promise<void> {
    this.cache = { ...DEFAULT_SETTINGS };
    await this.saveToFile(this.cache);
  }

  /**
   * 設定ファイルが存在しない場合は作成する
   */
  private async ensureSettingsFile(): Promise<void> {
    try {
      await fs.access(this.settingsPath);
    } catch {
      // ファイルが存在しない場合はデフォルト値で作成
      await this.saveToFile(DEFAULT_SETTINGS);
    }
  }

  /**
   * 設定をファイルから読み込む
   */
  private async loadFromFile(): Promise<AppSettings> {
    const content = await fs.readFile(this.settingsPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<AppSettings>;

    // デフォルト値とマージして、全フィールドが存在するようにする
    return {
      apiKey: parsed.apiKey ?? DEFAULT_SETTINGS.apiKey,
      baseURL: parsed.baseURL ?? DEFAULT_SETTINGS.baseURL,
      model: parsed.model ?? DEFAULT_SETTINGS.model,
      moocsUsername: parsed.moocsUsername ?? DEFAULT_SETTINGS.moocsUsername,
      moocsPassword: parsed.moocsPassword ?? DEFAULT_SETTINGS.moocsPassword,
    };
  }

  /**
   * 設定をファイルに保存する
   */
  private async saveToFile(settings: AppSettings): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    await fs.writeFile(this.settingsPath, content, "utf-8");
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
