import type { Citation } from "../../shared/types/chat";
import { collectCitationsFromText } from "./moocs-citations";

export const MAX_TOOL_RESULT_CHARS = 4_000;

export function truncate(text: string, maxChars = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

export function mcpResultToText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");

  const typed = result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };

  if (typed.isError) {
    const errText = typed.content?.map((c) => c.text).join("\n") ?? "Unknown MCP error";
    return `Error: ${errText}`;
  }

  if (typed.content && Array.isArray(typed.content)) {
    return typed.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }

  return JSON.stringify(result);
}

export interface ToolExecutionResult {
  content: string;
  citations: Citation[];
}

export function formatMcpResult(result: unknown, citations: Citation[]): ToolExecutionResult {
  const content = mcpResultToText(result);
  collectCitationsFromText(content, citations);
  return { content: truncate(content), citations };
}
