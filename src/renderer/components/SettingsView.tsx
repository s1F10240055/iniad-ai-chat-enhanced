import React, { useState, useEffect, useCallback, useRef } from "react";
import type { AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";

/** バリデーションエラーの型 */
interface ValidationErrors {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  moocsUsername?: string;
  moocsPassword?: string;
}

/** 接続テスト結果 */
interface TestResult {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
}

interface SettingsViewProps {
  /** 設定画面を閉じてチャット画面に戻る */
  onClose: () => void;
}

/** 利用可能なモデル一覧 */
const AVAILABLE_MODELS = [
  { value: "gpt-5.4-nano", label: "GPT-5.4 Nano (高速・低コスト)" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini (バランス)" },
  { value: "gpt-5.4", label: "GPT-5.4 (高性能)" },
];

/** APIキー・パスワードをマスク表示する */
function maskSecret(value: string): string {
  if (!value || value.length <= 4) return "●●●●●●●●";
  return "●".repeat(value.length - 4) + value.slice(-4);
}

/** URLバリデーション */
function isValidURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onClose }) => {
  // ── State ──
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [editedFields, setEditedFields] = useState<Set<keyof AppSettings>>(new Set());
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [showMoocsPassword, setShowMoocsPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [apiTestResult, setApiTestResult] = useState<TestResult>({ status: "idle" });
  const [mcpTestResult, setMcpTestResult] = useState<TestResult>({ status: "idle" });

  // ── 最後の文字を一瞬見せるマスキング ──
  const [revealIndex, setRevealIndex] = useState<{ field: string; index: number } | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, []);

  /** 秘密フィールドの表示値を生成（最後の1文字だけ一瞬見せる） */
  const _getMaskedValue = (field: string, raw: string, forceShow: boolean): string => {
    if (!raw) return "";
    if (forceShow) return raw;
    return raw
      .split("")
      .map((ch, i) => {
        if (revealIndex && revealIndex.field === field && revealIndex.index === i) {
          return ch; // 最後に打った文字を一瞬表示
        }
        return "●";
      })
      .join("");
  };

  /** 秘密フィールドの更新（最後の文字を一瞬見せてからマスク） */
  const updateSecretField = (field: keyof AppSettings, newValue: string) => {
    const oldValue = settings[field];
    updateField(field, newValue);

    // 文字が追加された場合のみ、最後の文字を一瞬見せる
    if (newValue.length > oldValue.length) {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      setRevealIndex({ field, index: newValue.length - 1 });
      revealTimerRef.current = setTimeout(() => {
        setRevealIndex(null);
      }, 600);
    } else {
      setRevealIndex(null);
    }
  };

  // ── 初期読み込み ──
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Main プロセスの IPC ハンドラが未登録の場合はスキップ
        if (window.electronAPI?.getSettings) {
          const loaded = await window.electronAPI.getSettings();
          setSettings({ ...DEFAULT_SETTINGS, ...loaded });
        }
      } catch {
        // IPC ハンドラ未登録時のエラーは無視（モック動作）
      }
    };
    loadSettings();
  }, []);

  // ── バリデーション ──
  const validate = useCallback(
    (current: AppSettings): ValidationErrors => {
      const errs: ValidationErrors = {};

      // APIキー: 編集済みかつ空の場合のみエラー
      if (editedFields.has("apiKey") && !current.apiKey.trim()) {
        errs.apiKey = "APIキーは必須です";
      }

      // ベースURL
      if (current.baseURL && !isValidURL(current.baseURL)) {
        errs.baseURL = "有効なURL形式で入力してください";
      }

      // モデル
      if (!current.model.trim()) {
        errs.model = "モデルを選択してください";
      }

      // MOOCsユーザー名・パスワードはペア入力
      const hasUsername = current.moocsUsername.trim().length > 0;
      const hasPassword = editedFields.has("moocsPassword")
        ? current.moocsPassword.trim().length > 0
        : current.moocsPassword.length > 0; // マスク値でも存在判定

      if (hasUsername && !hasPassword) {
        errs.moocsPassword = "パスワードも入力してください";
      }
      if (!hasUsername && hasPassword && editedFields.has("moocsPassword")) {
        errs.moocsUsername = "ユーザー名も入力してください";
      }

      return errs;
    },
    [editedFields]
  );

  // ── フィールド更新 ──
  const updateField = (field: keyof AppSettings, value: string) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    setEditedFields((prev) => new Set(prev).add(field));
    setSaveMessage(null);

    // バリデーションを実行
    const newErrors = validate(newSettings);
    setErrors(newErrors);
  };

  // ── 保存 ──
  const handleSave = async () => {
    const validationErrors = validate(settings);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setSaveMessage({ type: "error", text: "入力内容にエラーがあります" });
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      // 編集されたフィールドのみ送信
      const partial: Partial<AppSettings> = {};
      for (const field of editedFields) {
        partial[field] = settings[field];
      }

      if (window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings(partial);
      }

      setSaveMessage({ type: "success", text: "設定を保存しました" });
      setEditedFields(new Set());

      // 3秒後にメッセージをクリア
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (e) {
      setSaveMessage({
        type: "error",
        text: `保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ── 接続テスト ──
  const handleTestApi = async () => {
    setApiTestResult({ status: "testing" });
    try {
      // Save settings first so the test handler has the latest values
      const partial: Partial<AppSettings> = {};
      for (const field of editedFields) {
        partial[field] = settings[field];
      }
      if (Object.keys(partial).length > 0 && window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings(partial);
        setEditedFields(new Set());
      }

      if (window.electronAPI?.testApiConnection) {
        const result = await window.electronAPI.testApiConnection();
        setApiTestResult({
          status: result.success ? "success" : "error",
          message: result.success ? "接続成功" : result.error || "接続失敗",
        });
      } else {
        setApiTestResult({ status: "success", message: "接続成功（モック）" });
      }
    } catch (e) {
      setApiTestResult({
        status: "error",
        message: e instanceof Error ? e.message : "テスト失敗",
      });
    }
  };

  const handleTestMcp = async () => {
    setMcpTestResult({ status: "testing" });
    try {
      // Save settings first so the login handler has the latest credentials
      const partial: Partial<AppSettings> = {};
      for (const field of editedFields) {
        partial[field] = settings[field];
      }
      if (Object.keys(partial).length > 0 && window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings(partial);
        setEditedFields(new Set());
      }

      if (window.electronAPI?.testMcpConnection) {
        const result = await window.electronAPI.testMcpConnection();
        setMcpTestResult({
          status: result.success ? "success" : "error",
          message: result.success ? "MCP接続成功" : result.error || "接続失敗",
        });
      } else {
        setMcpTestResult({ status: "success", message: "接続成功（モック）" });
      }
    } catch (e) {
      setMcpTestResult({
        status: "error",
        message: e instanceof Error ? e.message : "テスト失敗",
      });
    }
  };

  // ── 表示ヘルパー ──
  const _getSecretDisplayValue = (field: "apiKey" | "moocsPassword", showRaw: boolean): string => {
    const value = settings[field];
    if (!value) return "";
    if (editedFields.has(field)) return value; // 編集中は常に平文
    return showRaw ? value : maskSecret(value);
  };

  const renderTestButton = (label: string, result: TestResult, onTest: () => void) => (
    <div className="settings-test-row">
      <button
        type="button"
        className="settings-test-button"
        onClick={onTest}
        disabled={result.status === "testing"}
      >
        {result.status === "testing" ? "テスト中..." : label}
      </button>
      {result.status !== "idle" && (
        <span className={`settings-test-result ${result.status}`}>
          {result.status === "testing" && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="settings-icon-spin"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {result.status === "success" && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#a6e3a1"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {result.status === "error" && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f38ba8"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
          {result.message && ` ${result.message}`}
        </span>
      )}
    </div>
  );

  return (
    <div className="settings-view" id="settings-view">
      <div className="settings-content">
        {/* ── API設定セクション ── */}
        <section className="settings-section" id="settings-api">
          <h3 className="settings-section-title">
            <span className="settings-section-icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </span>
            API設定
          </h3>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-apiKey">
              APIキー
            </label>
            <div className="settings-input-group">
              <input
                id="settings-apiKey"
                type={showApiKey ? "text" : "password"}
                className={`settings-input settings-secret-input ${errors.apiKey ? "error" : ""}`}
                value={settings.apiKey}
                onChange={(e) => updateSecretField("apiKey", e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
              <button
                type="button"
                className={`settings-toggle-visibility ${showApiKey ? "active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowApiKey(true);
                }}
                onMouseUp={() => setShowApiKey(false)}
                onMouseLeave={() => setShowApiKey(false)}
                aria-label="長押しでAPIキーを表示"
                title="長押しで表示"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            {errors.apiKey && <span className="settings-error">{errors.apiKey}</span>}
            <span className="settings-hint">※ INIAD Slack「GPT-4o mini」で取得可能</span>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-baseURL">
              APIベースURL
            </label>
            <input
              id="settings-baseURL"
              type="text"
              className={`settings-input ${errors.baseURL ? "error" : ""}`}
              value={settings.baseURL}
              onChange={(e) => updateField("baseURL", e.target.value)}
              placeholder="https://api.openai.iniad.org/api/v1"
            />
            {errors.baseURL && <span className="settings-error">{errors.baseURL}</span>}
          </div>

          {renderTestButton("API接続テスト", apiTestResult, handleTestApi)}
        </section>

        {/* ── モデル設定セクション ── */}
        <section className="settings-section" id="settings-model">
          <h3 className="settings-section-title">
            <span className="settings-section-icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M12 3c-1.66 0-3 1.34-3 3v5h6V6c0-1.66-1.34-3-3-3z" />
                <circle cx="12" cy="16" r="1" />
              </svg>
            </span>
            モデル設定
          </h3>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-model-select">
              使用モデル
            </label>
            <select
              id="settings-model-select"
              className={`settings-input settings-select ${errors.model ? "error" : ""}`}
              value={settings.model}
              onChange={(e) => updateField("model", e.target.value)}
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {errors.model && <span className="settings-error">{errors.model}</span>}
          </div>
        </section>

        {/* ── MOOCs認証セクション ── */}
        <section className="settings-section" id="settings-moocs">
          <h3 className="settings-section-title">
            <span className="settings-section-icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" />
              </svg>
            </span>
            INIAD MOOCs 認証
          </h3>
          <p className="settings-section-description">
            学籍番号とパスワードを入力後、「接続テスト」を押してください。 認証情報を使って MCP
            サーバー（Playwright）経由で MOOCs
            に接続します。起動時・チャット送信時にも自動接続を試みます。
          </p>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-moocsUsername">
              ユーザー名（学籍番号）
            </label>
            <input
              id="settings-moocsUsername"
              type="text"
              className={`settings-input ${errors.moocsUsername ? "error" : ""}`}
              value={settings.moocsUsername}
              onChange={(e) => updateField("moocsUsername", e.target.value)}
              placeholder="s1F10XXXXXX"
              autoComplete="off"
            />
            {errors.moocsUsername && <span className="settings-error">{errors.moocsUsername}</span>}
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-moocsPassword">
              パスワード
            </label>
            <div className="settings-input-group">
              <input
                id="settings-moocsPassword"
                type={showMoocsPassword ? "text" : "password"}
                className={`settings-input settings-secret-input ${errors.moocsPassword ? "error" : ""}`}
                value={settings.moocsPassword}
                onChange={(e) => updateSecretField("moocsPassword", e.target.value)}
                placeholder="パスワード"
                autoComplete="off"
              />
              <button
                type="button"
                className={`settings-toggle-visibility ${showMoocsPassword ? "active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowMoocsPassword(true);
                }}
                onMouseUp={() => setShowMoocsPassword(false)}
                onMouseLeave={() => setShowMoocsPassword(false)}
                aria-label="長押しでパスワードを表示"
                title="長押しで表示"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            {errors.moocsPassword && <span className="settings-error">{errors.moocsPassword}</span>}
          </div>

          {renderTestButton("接続テスト", mcpTestResult, handleTestMcp)}
        </section>
      </div>

      {/* ── フッター（保存・キャンセル） ── */}
      <div className="settings-footer">
        {saveMessage && (
          <span className={`settings-save-message ${saveMessage.type}`}>
            {saveMessage.type === "success" ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#a6e3a1"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ verticalAlign: "middle", marginRight: "4px" }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f38ba8"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ verticalAlign: "middle", marginRight: "4px" }}
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
            {saveMessage.text}
          </span>
        )}
        <div className="settings-footer-buttons">
          <button type="button" className="settings-button-cancel" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="settings-button-save"
            onClick={handleSave}
            disabled={isSaving || Object.keys(errors).length > 0}
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
};
