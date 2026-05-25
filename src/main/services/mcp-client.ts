import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { createRequire } from "module";
import path from "path";
import { z } from "zod";
import { AppError } from "../../shared/types/errors";
import type { CourseSummary, LectureLink, SlideLink } from "../../shared/types/search";
import type { McpStatus } from "../../shared/types/settings";

const TOOL_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;

export class McpClient {
  private status: McpStatus = "disconnected";
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  getStatus(): McpStatus {
    return this.status;
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

      this.transport = new StdioClientTransport({
        command: "node",
        args: [cliPath],
        env: {
          ...process.env,
          INIAD_USERNAME: username,
          INIAD_PASSWORD: password,
        },
      });

      this.client = new Client({ name: "iniad-ai-chat", version: "1.0.0" }, { capabilities: {} });

      await Promise.race([
        this.client.connect(this.transport),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)),
            CONNECT_TIMEOUT_MS
          )
        ),
      ]);

      this.status = "connected";
    } catch (error) {
      this.status = "disconnected";
      await this.cleanupResources();
      throw this.classifyError(error);
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanupResources();
    this.status = "disconnected";
  }

  // ── ツール呼び出し ──────────────────────────────

  async callToolSafe(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error("MCP client is not initialized");
    }

    try {
      return await this.client.callTool({ name: toolName, arguments: args }, undefined, {
        timeout: TOOL_TIMEOUT_MS,
      });
    } catch (callToolError) {
      const errMsg = callToolError instanceof Error ? callToolError.message : "";

      if (
        errMsg.includes("validation") ||
        errMsg.includes("parse") ||
        errMsg.includes("schema") ||
        errMsg.includes("safeParse")
      ) {
        return await this.client.request(
          { method: "tools/call", params: { name: toolName, arguments: args ?? {} } },
          z.any(),
          { timeout: TOOL_TIMEOUT_MS }
        );
      }

      throw callToolError;
    }
  }

  async fetchCourses(): Promise<CourseSummary[]> {
    const result = await this.callToolSafe("listCourses");
    return this.parseToolResult<CourseSummary>(result);
  }

  async fetchLectureLinks(): Promise<LectureLink[]> {
    const result = await this.callToolSafe("listLectureLinks");
    return this.parseToolResult<LectureLink>(result);
  }

  async fetchSlideLinks(): Promise<SlideLink[]> {
    const result = await this.callToolSafe("listSlideLinks");
    return this.parseToolResult<SlideLink>(result);
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
