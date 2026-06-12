/**
 * チャット関連の共通型定義
 * Main ↔ Renderer 間で共有されるチャットデータの型
 */

/** 会話の1ターン（ユーザーまたはAIの発言） */
export interface ChatTurn {
  /** 一意なメッセージID */
  id: string;
  /** "user" | "assistant" */
  role: "user" | "assistant";
  /** メッセージ本文 */
  content: string;
  /** AI回答の場合、参照元の引用情報 */
  citations?: Citation[];
  /** タイムスタンプ（ISO 8601 文字列） */
  timestamp: string;
}

/** 参照元（RAGで取得した資料の引用情報） */
export interface Citation {
  /** 資料のタイトル */
  title: string;
  /** 資料のURL */
  url: string;
  /** 関連部分のスニペット */
  snippet?: string;
}

/** chat:send のレスポンス */
export interface ChatResponse {
  /** AIの回答テキスト */
  content: string;
  /** 参照元の一覧 */
  citations: Citation[];
  /** レスポンスのレイテンシ（ミリ秒） */
  latencyMs?: number;
}

/** OpenAI 互換のツール定義 */
export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** ツール呼び出し（assistant メッセージ内） */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** エージェントループ用メッセージ */
export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Chat Completions API のレスポンス（INIAD API / OpenAI 互換） */
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
