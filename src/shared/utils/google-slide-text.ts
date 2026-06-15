const NOISE_PATTERNS = [
  /^Shift[+＋]/,
  /^⌘/,
  /^Ctrl[+＋]/,
  /^Alt[+＋]/,
  /^[A-Z]$/,
  /^Copyright ©/i,
  /^From: https?:\/\//i,
  /C:\\Users\\/i,
  /\.bmp$/i,
  /^スライド \d+\/\d+:/,
];

/** aria-label がスライド本文として使えるか */
export function isSlideAriaLabel(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length < 6) return false;
  return !NOISE_PATTERNS.some((p) => p.test(trimmed));
}

/** 抽出テキストが読み取り可能な日本語本文か（スクリプトノイズを除外） */
export function isReadableSlideText(text: string): boolean {
  if (!text || text.length < 40) return false;

  const withoutWs = text.replace(/\s/g, "");
  if (withoutWs.length < 30) return false;

  // スクリプト/HTML ノイズ
  if (/function\s*\(|window\._|goog\.|var\s+[a-zA-Z_$]{1,3}=/i.test(text)) return false;
  if ((text.match(/\{/g)?.length ?? 0) > 10 && (text.match(/;/g)?.length ?? 0) > 10) return false;

  // 日本語または講義で使う ASCII 語が一定量あること
  const jpChars = text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z]{4,}/g)?.length ?? 0;
  return jpChars >= 15 || latinWords >= 5;
}

export function filterSlideAriaLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    // vertical tab (U+000B) を改行 (U+000A) へ置換。正規表現リテラルだと no-control-regex に引っかかるため String.fromCharCode を使用
    const label = raw.split(String.fromCharCode(0x0b)).join(String.fromCharCode(0x0a)).trim();
    if (!isSlideAriaLabel(label)) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** Google Slides 抽出結果の JSON 形 */
export interface GoogleSlideExtractResult {
  moocsUrl?: string;
  presentationId?: string;
  pubUrl?: string;
  text?: string;
  charCount?: number;
  error?: string;
  hint?: string;
}

export function parseGoogleSlideExtract(jsonText: string): GoogleSlideExtractResult | null {
  try {
    return JSON.parse(jsonText) as GoogleSlideExtractResult;
  } catch {
    return null;
  }
}

export function formatSlideTextForLlm(result: GoogleSlideExtractResult, moocsUrl?: string): string {
  if (result.error) {
    const lines = [`Error: ${result.error}`];
    if (result.hint) lines.push(`Hint: ${result.hint}`);
    if (result.pubUrl) lines.push(`Pub URL: ${result.pubUrl}`);
    if (moocsUrl || result.moocsUrl) lines.push(`MOOCs URL: ${moocsUrl ?? result.moocsUrl}`);
    return lines.join("\n");
  }

  const url = moocsUrl ?? result.moocsUrl ?? "";
  const header = [
    url ? `MOOCs URL: ${url}` : "",
    result.presentationId ? `Presentation ID: ${result.presentationId}` : "",
    result.charCount != null ? `Characters: ${result.charCount}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = result.text ?? "";
  return header ? `${header}\n\n${body}` : body;
}
