import type { McpClient } from "./mcp-client";
import type { IWebSearchProvider } from "./web-search-types";
import type { SlidesIndexService } from "./slides-index";
import type { Citation } from "../../shared/types/chat";
import { MoocsPageReader } from "./moocs-page-reader";
import { formatMcpResult, truncate, type ToolExecutionResult } from "./mcp-result";

const MAX_SNAPSHOT_CHARS = 3_000;

/** LLM に渡さない危険な MCP ツール */
const BLOCKED_MCP_TOOLS = new Set(["submit_assignment", "browser_handle_dialog"]);

export interface ToolExecutionContext {
  mcpClient: McpClient;
  webClient: IWebSearchProvider;
  mcpConnected: boolean;
  slidesIndex?: SlidesIndexService;
  /** 同一チャット内の moocs_read_slide キャッシュ (url → content) */
  slideReadCache?: Map<string, string>;
}

export async function executeAgentTool(
  toolName: string,
  argsJson: string,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return { content: "Error: tool arguments must be valid JSON", citations: [] };
  }

  const citations: Citation[] = [];
  const pageReader = new MoocsPageReader(
    ctx.mcpClient,
    ctx.slidesIndex,
    ctx.slideReadCache
  );

  try {
    switch (toolName) {
      case "moocs_login":
        return await runMoocsTool(ctx, async () => {
          const result = await ctx.mcpClient.loginToMoocs();
          return formatMcpResult(result, citations);
        });

      case "moocs_list_courses":
        return await runMoocsTool(ctx, async () => {
          const result = await ctx.mcpClient.callToolSafe("listCourses");
          return formatMcpResult(result, citations);
        });

      case "moocs_navigate": {
        const url = String(args.url ?? "");
        if (!url.startsWith("https://moocs.iniad.org/")) {
          return { content: "Error: url must be a moocs.iniad.org URL", citations: [] };
        }
        return await runMoocsTool(ctx, async () => {
          await ctx.mcpClient.navigateTo(url);
          citations.push({ title: "MOOCs ページ", url, snippet: "閲覧中のページ" });
          return { content: `Navigated to ${url}`, citations };
        });
      }

      case "moocs_list_lectures":
        return await runMoocsTool(ctx, async () => {
          const result = await ctx.mcpClient.callToolSafe("listLectureLinks");
          return formatMcpResult(result, citations);
        });

      case "moocs_list_slides":
        return await runMoocsTool(ctx, async () => {
          const result = await ctx.mcpClient.callToolSafe("listSlideLinks");
          return formatMcpResult(result, citations);
        });

      case "moocs_read_slide": {
        const slideUrl = args.url ? String(args.url) : undefined;
        if (slideUrl && !slideUrl.startsWith("https://moocs.iniad.org/")) {
          return { content: "Error: url must be a moocs.iniad.org URL", citations: [] };
        }
        return await runMoocsTool(ctx, async () => pageReader.readPage(slideUrl));
      }

      case "moocs_expand_slide_tab":
        return await runMoocsTool(ctx, async () => {
          const result = await ctx.mcpClient.callToolSafe("expandSlideTab");
          return formatMcpResult(result, citations);
        });

      case "moocs_page_content":
        return await runMoocsTool(ctx, async () => {
          const slideAttempt = await pageReader.tryExtractSlideText(citations);
          if (slideAttempt) return slideAttempt;

          const snapshot = await ctx.mcpClient.getPageSnapshot();
          if (!snapshot) {
            return { content: "Error: empty page snapshot", citations: [] };
          }
          const truncated =
            snapshot.length > MAX_SNAPSHOT_CHARS
              ? snapshot.slice(0, MAX_SNAPSHOT_CHARS) + "\n...(truncated)"
              : snapshot;
          return { content: truncated, citations };
        });

      case "moocs_google_login":
        return await runMoocsTool(ctx, async () => {
          const result = await ctx.mcpClient.callToolSafe(
            "loginToGoogleWithIniadAccount",
            undefined,
            90_000
          );
          return formatMcpResult(result, citations);
        });

      case "web_search": {
        const query = String(args.query ?? "").trim();
        if (!query) return { content: "Error: query is required", citations: [] };
        const result = await ctx.webClient.search(query);
        if (!result.success) {
          return { content: `Web search failed: ${result.error ?? "unknown"}`, citations: [] };
        }
        const lines = result.results.map(
          (r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
        );
        for (const r of result.results.slice(0, 5)) {
          citations.push({ title: r.title, url: r.url, snippet: r.snippet });
        }
        return { content: lines.join("\n\n") || "No web results", citations };
      }

      default:
        if (BLOCKED_MCP_TOOLS.has(toolName)) {
          return { content: `Error: tool "${toolName}" is not allowed`, citations: [] };
        }
        return { content: `Error: unknown tool "${toolName}"`, citations: [] };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `Tool error: ${message}`, citations: [] };
  }
}

async function runMoocsTool(
  ctx: ToolExecutionContext,
  fn: () => Promise<ToolExecutionResult>
): Promise<ToolExecutionResult> {
  if (!ctx.mcpConnected || ctx.mcpClient.getStatus() !== "connected") {
    return {
      content:
        "Error: MCP is not connected. Ask the user to configure MOOCs credentials and connect in Settings.",
      citations: [],
    };
  }

  const healthy = await ctx.mcpClient.ping();
  if (!healthy) {
    return {
      content: "Error: MCP connection lost. Ask the user to reconnect in Settings.",
      citations: [],
    };
  }

  const result = await fn();
  return {
    content: truncate(result.content),
    citations: result.citations,
  };
}
