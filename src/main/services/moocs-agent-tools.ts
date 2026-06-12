import type { McpClient } from "./mcp-client";
import type { IWebSearchProvider } from "./search-orchestrator";
import type { SlidesIndexService } from "./slides-index";
import type { ChatToolDefinition } from "../../shared/types/chat";
import type { Citation } from "../../shared/types/chat";
import {
  parseGoogleSlideExtract,
  formatSlideTextForLlm,
  isReadableSlideText,
} from "../../shared/utils/google-slide-text";
import {
  getMoocsPageKind,
  isGoogleSlidePage,
  type MoocsPageKind,
} from "./moocs-query";

const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_SNAPSHOT_CHARS = 3_000;

/** LLM に渡さない危険な MCP ツール */
const BLOCKED_MCP_TOOLS = new Set(["submit_assignment", "browser_handle_dialog"]);

export const MOOCS_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "moocs_login",
      description:
        "INIAD MOOCs にログインする。コース一覧の取得前、またはセッション切れが疑われるときに呼ぶ。成功すると登録コース一覧が返る。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_list_courses",
      description: "ログイン済みの状態で、登録されているコース一覧を取得する。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_navigate",
      description:
        "MOOCs の指定 URL に移動する。コースページ・講義ページ・スライドページの URL は list_* ツールの結果から取得する。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "移動先の MOOCs URL" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_list_lectures",
      description:
        "現在のコースページで講義（回）のリンク一覧を取得する。事前に moocs_navigate でコース URL に移動すること。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_list_slides",
      description:
        "現在の講義ページでスライド・教材のリンク一覧を取得する。事前に moocs_navigate で講義 URL に移動すること。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_read_slide",
      description:
        "MOOCs ページ本文を取得する。数値スライド URL（/01/01 等）は Google Slides から抽出。課題解説（/review）・演習課題（/exercise）・出席確認（/atnd）は HTML ページとして読む（Google ログイン不要）。非公開の場合はその旨が返る。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "省略可。指定時は先にこの MOOCs スライド URL に移動してから読み取る。",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_expand_slide_tab",
      description:
        "スライドページで「スライド」タブを開く。通常は moocs_read_slide を使えば不要。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_page_content",
      description:
        "現在のページのアクセシビリティスナップショット。スライド本文には moocs_read_slide を使うこと（iframe 内はこのツールでは取れない）。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_google_login",
      description:
        "数値スライドページ（Google Slides iframe あり）でのみ使用。課題解説・演習課題ページでは呼ばない。google_login_required が出たときだけ 1 回試す。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "MOOCs 外の補足情報を Web 検索する。INIAD 講義内容の回答には MOOCs ツールを優先すること。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索クエリ" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export interface ToolExecutionContext {
  mcpClient: McpClient;
  webClient: IWebSearchProvider;
  mcpConnected: boolean;
  slidesIndex?: SlidesIndexService;
  /** 同一チャット内の moocs_read_slide キャッシュ (url → content) */
  slideReadCache?: Map<string, string>;
}

export interface ToolExecutionResult {
  content: string;
  citations: Citation[];
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

  try {
    switch (toolName) {
      case "moocs_login":
        return await runMoocsTool(ctx, "login", async () => {
          const result = await ctx.mcpClient.loginToMoocs();
          return formatMcpResult(result, citations);
        });

      case "moocs_list_courses":
        return await runMoocsTool(ctx, "listCourses", async () => {
          const result = await ctx.mcpClient.callToolSafe("listCourses");
          return formatMcpResult(result, citations);
        });

      case "moocs_navigate": {
        const url = String(args.url ?? "");
        if (!url.startsWith("https://moocs.iniad.org/")) {
          return { content: "Error: url must be a moocs.iniad.org URL", citations: [] };
        }
        return await runMoocsTool(ctx, "browser_navigate", async () => {
          await ctx.mcpClient.navigateTo(url);
          citations.push({ title: "MOOCs ページ", url, snippet: "閲覧中のページ" });
          return { content: `Navigated to ${url}`, citations };
        });
      }

      case "moocs_list_lectures":
        return await runMoocsTool(ctx, "listLectureLinks", async () => {
          const result = await ctx.mcpClient.callToolSafe("listLectureLinks");
          return formatMcpResult(result, citations);
        });

      case "moocs_list_slides":
        return await runMoocsTool(ctx, "listSlideLinks", async () => {
          const result = await ctx.mcpClient.callToolSafe("listSlideLinks");
          return formatMcpResult(result, citations);
        });

      case "moocs_read_slide": {
        const slideUrl = args.url ? String(args.url) : undefined;
        if (slideUrl && !slideUrl.startsWith("https://moocs.iniad.org/")) {
          return { content: "Error: url must be a moocs.iniad.org URL", citations: [] };
        }
        return await runMoocsTool(ctx, "read_slide", async () =>
          readSlideContent(ctx, citations, slideUrl)
        );
      }

      case "moocs_expand_slide_tab":
        return await runMoocsTool(ctx, "expandSlideTab", async () => {
          const result = await ctx.mcpClient.callToolSafe("expandSlideTab");
          return formatMcpResult(result, citations);
        });

      case "moocs_page_content":
        return await runMoocsTool(ctx, "browser_snapshot", async () => {
          const slideAttempt = await tryExtractSlideText(ctx, citations);
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
        return await runMoocsTool(ctx, "loginToGoogleWithIniadAccount", async () => {
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
  _mcpToolName: string,
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

function formatMcpResult(result: unknown, citations: Citation[]): ToolExecutionResult {
  const content = mcpResultToText(result);
  collectCitationsFromText(content, citations);
  return { content: truncate(content), citations };
}

function mcpResultToText(result: unknown): string {
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

function isCourseListUrl(url: string): boolean {
  return /^https:\/\/moocs\.iniad\.org\/courses\/\d{4}\/[A-Z0-9]+\/?$/.test(url);
}

function collectCitationsFromText(text: string, citations: Citation[]): void {
  const urlRegex = /https:\/\/moocs\.iniad\.org\/[^\s"'<>]+/g;
  const urls = text.match(urlRegex) ?? [];
  for (const url of urls) {
    if (isCourseListUrl(url)) continue;
    if (!citations.some((c) => c.url === url)) {
      citations.push({ title: "MOOCs", url, snippet: undefined });
    }
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return text.slice(0, MAX_TOOL_RESULT_CHARS) + "\n...(truncated)";
}

async function readSlideContent(
  ctx: ToolExecutionContext,
  citations: Citation[],
  slideUrl?: string
): Promise<ToolExecutionResult> {
  const moocsUrl = slideUrl;

  if (moocsUrl && ctx.slideReadCache?.has(moocsUrl)) {
    const cached = ctx.slideReadCache.get(moocsUrl)!;
    citations.push({ title: "MOOCs スライド", url: moocsUrl });
    return { content: cached, citations };
  }

  if (moocsUrl) {
    await ctx.mcpClient.navigateTo(moocsUrl);
    citations.push({ title: pageCitationTitle(moocsUrl), url: moocsUrl });
  }

  const pageKind = moocsUrl ? getMoocsPageKind(moocsUrl) : "other";
  if (moocsUrl && !isGoogleSlidePage(moocsUrl)) {
    return readHtmlMoocsPage(ctx, moocsUrl, pageKind, citations);
  }

  // 既知 URL はオフラインインデックスを優先（高速・確実）
  if (moocsUrl && ctx.slidesIndex?.isLoaded()) {
    const indexed = ctx.slidesIndex.getTextByMoocsUrl(moocsUrl);
    if (indexed) {
      const content = truncate(
        `MOOCs URL: ${moocsUrl}\nSource: slides-index\n\n${indexed}`
      );
      ctx.slideReadCache?.set(moocsUrl, content);
      return { content, citations };
    }
  }

  await ctx.mcpClient.expandSlideTab();
  const extractResult = await ctx.mcpClient.extractGoogleSlideText();
  const rawText = mcpResultToText(extractResult);
  const parsed = parseGoogleSlideExtract(rawText);
  const resolvedUrl = moocsUrl ?? parsed?.moocsUrl;

  if (resolvedUrl) {
    citations.push({ title: "MOOCs スライド", url: resolvedUrl });
  }

  if (parsed?.error === "no_google_slides_iframe") {
    return readHtmlMoocsPage(ctx, moocsUrl ?? "", pageKind, citations);
  }

  if (parsed?.error === "google_login_required") {
    return {
      content:
        "Error: google_login_required — this page has Google Slides. Call moocs_google_login once, then retry. If login times out, tell the user MOOCs may need manual Google sign-in in Settings.",
      citations,
    };
  }

  if (parsed?.text && isReadableSlideText(parsed.text)) {
    const content = truncate(formatSlideTextForLlm(parsed, resolvedUrl));
    if (resolvedUrl) ctx.slideReadCache?.set(resolvedUrl, content);
    return { content, citations };
  }

  if (resolvedUrl && ctx.slidesIndex?.isLoaded()) {
    const indexed = ctx.slidesIndex.getTextByMoocsUrl(resolvedUrl);
    if (indexed) {
      const content = truncate(
        `MOOCs URL: ${resolvedUrl}\nSource: slides-index (fallback)\n\n${indexed}`
      );
      ctx.slideReadCache?.set(resolvedUrl, content);
      return { content, citations };
    }
  }

  if (parsed) {
    return { content: formatSlideTextForLlm(parsed, moocsUrl), citations };
  }

  return {
    content:
      "Error: could not extract slide text. Try moocs_google_login if Google login wall appears.",
    citations,
  };
}

function pageCitationTitle(url: string): string {
  const kind = getMoocsPageKind(url);
  switch (kind) {
    case "review":
      return "課題解説";
    case "exercise":
      return "演習課題";
    case "attendance":
      return "出席確認";
    case "slide":
      return "MOOCs スライド";
    default:
      return "MOOCs";
  }
}

async function readHtmlMoocsPage(
  ctx: ToolExecutionContext,
  moocsUrl: string,
  pageKind: MoocsPageKind,
  citations: Citation[]
): Promise<ToolExecutionResult> {
  const snapshot = await ctx.mcpClient.getPageSnapshot();
  if (!snapshot) {
    return {
      content: `Error: empty page content for ${moocsUrl} (pageKind=${pageKind})`,
      citations,
    };
  }

  const isPrivate = /現在この問題は非公開です/.test(snapshot);
  const lines = [
    `MOOCs URL: ${moocsUrl}`,
    `Page kind: ${pageKind} (HTML page, not Google Slides)`,
    isPrivate ? "Status: 非公開（講師が公開するまで内容は閲覧できません）" : "",
    "",
    snapshot.slice(0, MAX_SNAPSHOT_CHARS),
  ].filter(Boolean);

  const content = truncate(lines.join("\n"));
  ctx.slideReadCache?.set(moocsUrl, content);
  return { content, citations };
}

async function tryExtractSlideText(
  ctx: ToolExecutionContext,
  citations: Citation[]
): Promise<ToolExecutionResult | null> {
  try {
    const result = await ctx.mcpClient.extractGoogleSlideText();
    const rawText = mcpResultToText(result);
    const parsed = parseGoogleSlideExtract(rawText);
    if (parsed?.text && isReadableSlideText(parsed.text)) {
      const moocsUrl = parsed.moocsUrl;
      if (moocsUrl) citations.push({ title: "MOOCs スライド", url: moocsUrl });
      return {
        content: truncate(formatSlideTextForLlm(parsed, moocsUrl)),
        citations,
      };
    }
  } catch {
    // fall through to accessibility snapshot
  }
  return null;
}
