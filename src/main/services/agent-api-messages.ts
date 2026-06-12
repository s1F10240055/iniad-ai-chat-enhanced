import type { AgentMessage } from "../../shared/types/chat";

/** API に送る際、直近 N 件のツール結果だけ本文を残す（それ以前は省略） */
const KEEP_RECENT_TOOL_RESULTS = 2;

const OMITTED_TOOL_BODY = "[以前のツール結果は省略。直近の調査結果を参照してください。]";

/**
 * OpenAI 互換 API 用にメッセージ列を整える。
 * 古い tool メッセージの本文だけ差し替え（assistant/tool_calls の対応は維持）。
 */
export function prepareApiMessages(messages: AgentMessage[]): AgentMessage[] {
  const toolIndices = messages
    .map((m, i) => (m.role === "tool" ? i : -1))
    .filter((i) => i >= 0);

  if (toolIndices.length <= KEEP_RECENT_TOOL_RESULTS) {
    return messages;
  }

  const omitBefore = toolIndices[toolIndices.length - KEEP_RECENT_TOOL_RESULTS];

  return messages.map((m, i) => {
    if (m.role !== "tool" || i >= omitBefore) return m;
    return { ...m, content: OMITTED_TOOL_BODY };
  });
}

export function estimatePayloadChars(messages: AgentMessage[]): number {
  return JSON.stringify(messages).length;
}
