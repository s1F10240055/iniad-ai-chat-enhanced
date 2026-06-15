import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { createRequire } from "module";
import path from "path";
import { z } from "zod";
import { AppError } from "../../shared/types/errors";
import type { CourseSummary, LectureLink, SlideLink } from "../../shared/types/search";
import type { McpStatus } from "../../shared/types/settings";

const TOOL_TIMEOUT_MS = 45_000;
const GOOGLE_LOGIN_TIMEOUT_MS = 90_000;
const CONNECT_TIMEOUT_MS = 30_000;
const LOGIN_TOOL_TIMEOUT_MS = 90_000;

export class McpClient {
  private status: McpStatus = "disconnected";
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  getStatus(): McpStatus {
    return this.status;
  }

  /** 子プロセスが生存し、ツール一覧が取得できるか確認する */
  async ping(): Promise<boolean> {
    if (!this.client || this.status !== "connected") return false;

    try {
      await this.client.request(
        { method: "tools/list", params: {} },
        z.object({ tools: z.any() }),
        { timeout: 5_000 }
      );
      return true;
    } catch {
      this.status = "disconnected";
      await this.cleanupResources();
      return false;
    }
  }

  isConnectionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("not initialized") ||
      message.includes("not connected") ||
      message.includes("Connection closed") ||
      message.includes("ECONNRESET") ||
      message.includes("EPIPE") ||
      message.includes("spawn") ||
      message.includes("ENOENT")
    );
  }

  async connect(username: string, password: string): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      await this.disconnect();
    }

    this.status = "connecting";

    try {
      const require = createRequire(__filename);
      const pkgDir = path.dirname(require.resolve("@rarandeyo/iniad-moocs-mcp/package.json"));
      const cliPath = path.join(pkgDir, "cli.js");

      // Playwright のバンドル Chromium を使用（Electron バイナリは使用不可）
      this.transport = new StdioClientTransport({
        command: "node",
        args: [cliPath, "--headless"],
        env: {
          ...process.env,
          INIAD_USERNAME: username,
          INIAD_PASSWORD: password,
        },
      });

      this.client = new Client({ name: "iniad-ai-chat", version: "1.0.0" }, { capabilities: {} });

      console.log(`[McpClient] Connecting to MCP server... (cliPath: ${cliPath})`);
      console.log(`[McpClient] Username provided: ${username ? "yes" : "NO"}`);
      await Promise.race([
        this.client.connect(this.transport),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)),
            CONNECT_TIMEOUT_MS
          )
        ),
      ]);

      console.log(`[McpClient] Connected successfully`);
      this.status = "connected";
    } catch (error) {
      this.status = "disconnected";
      console.error(
        `[McpClient] Connection failed:`,
        error instanceof Error ? error.message : error
      );
      await this.cleanupResources();
      throw this.classifyError(error);
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanupResources();
    this.status = "disconnected";
  }

  // ── ツール呼び出し ──────────────────────────────

  async callToolSafe(
    toolName: string,
    args?: Record<string, unknown>,
    timeoutMs = TOOL_TIMEOUT_MS
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error("MCP client is not initialized");
    }

    console.log(`[McpClient] callToolSafe: "${toolName}"`, args ?? {});
    try {
      const result = await this.client.callTool({ name: toolName, arguments: args }, undefined, {
        timeout: timeoutMs,
      });
      console.log(`[McpClient] callToolSafe "${toolName}" succeeded`);
      return result;
    } catch (callToolError) {
      const errMsg = callToolError instanceof Error ? callToolError.message : "";
      console.warn(`[McpClient] callToolSafe "${toolName}" error:`, errMsg);

      if (
        errMsg.includes("validation") ||
        errMsg.includes("parse") ||
        errMsg.includes("schema") ||
        errMsg.includes("safeParse")
      ) {
        return await this.client.request(
          { method: "tools/call", params: { name: toolName, arguments: args ?? {} } },
          z.any(),
          { timeout: timeoutMs }
        );
      }

      throw callToolError;
    }
  }

  async loginToMoocs(): Promise<unknown> {
    return this.callToolSafe("loginToIniadMoocsWithIniadAccount", undefined, LOGIN_TOOL_TIMEOUT_MS);
  }

  async fetchCourses(): Promise<CourseSummary[]> {
    const result = await this.callToolSafe("listCourses");
    return this.parseToolResult<CourseSummary>(result);
  }

  async navigateTo(url: string): Promise<void> {
    await this.callToolSafe("browser_navigate", { url });
  }

  async fetchLectureLinks(): Promise<LectureLink[]> {
    const result = await this.callToolSafe("listLectureLinks");
    return this.parseToolResult<LectureLink>(result);
  }

  async fetchSlideLinks(): Promise<SlideLink[]> {
    const result = await this.callToolSafe("listSlideLinks");
    return this.parseToolResult<SlideLink>(result);
  }

  /**
   * 現在のページのアクセシビリティスナップショット（テキスト）を取得する
   */
  async loginToGoogle(): Promise<void> {
    await this.callToolSafe("loginToGoogleWithIniadAccount", undefined, GOOGLE_LOGIN_TIMEOUT_MS);
  }

  async expandSlideTab(): Promise<void> {
    await this.callToolSafe("expandSlideTab");
  }

  async extractGoogleSlideText(): Promise<unknown> {
    return this.callToolSafe("extractGoogleSlideText", undefined, 90_000);
  }

  async getPageSnapshot(): Promise<string | null> {
    const result = await this.callToolSafe("browser_snapshot");
    const typedResult = result as { content?: Array<{ type: string; text?: string }> } | undefined;
    if (!typedResult?.content) return null;
    for (const item of typedResult.content) {
      if (item.type === "text" && item.text) {
        return item.text;
      }
    }
    return null;
  }

  parseToolResult<T>(result: unknown): T[] {
    if (!result || typeof result !== "object") return [];

    const typedResult = result as {
      content?: Array<{ type: string; text?: string }>;
    };

    if (!typedResult.content || !Array.isArray(typedResult.content)) return [];

    for (const item of typedResult.content) {
      if (item.type === "text" && item.text) {
        try {
          const parsed = JSON.parse(item.text);

          if (Array.isArray(parsed)) return parsed as T[];

          if (parsed && typeof parsed === "object") {
            for (const value of Object.values(parsed)) {
              if (Array.isArray(value)) return value as T[];
            }
          }
        } catch {
          continue;
        }
      }
    }

    return [];
  }

  // ── エラー分類 ──────────────────────────────────

  private classifyError(error: unknown): AppError {
    if (error instanceof AppError) return error;

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("timed out") || message.includes("ETIMEDOUT")) {
      return new AppError("MCP_TIMEOUT", `MCP connection timed out: ${message}`);
    }
    if (
      message.includes("ENOENT") ||
      message.includes("spawn") ||
      message.includes("module not found")
    ) {
      return new AppError("MCP_CONNECTION_FAILED", `MCP server failed to start: ${message}`);
    }

    return new AppError("MCP_CONNECTION_FAILED", `MCP connection failed: ${message}`);
  }

  // ── クリーンアップ ──────────────────────────────

  private async cleanupResources(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // クリーンアップエラーは無視
    }
    try {
      this.transport?.close?.();
    } catch {
      // クリーンアップエラーは無視
    }
    this.client = null;
    this.transport = null;
  }
}
