import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { createRequire } from "module";
import path from "path";
import { z } from "zod";
import { AppError } from "../../shared/types/errors";
import { randomUUID } from "crypto";
import type {
  CourseSummary,
  LectureLink,
  SearchResult,
  SlideLink,
} from "../../shared/types/search";
import type { McpStatus } from "../../shared/types/settings";

const TOOL_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export class McpClient {
  private status: McpStatus = "disconnected";
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private currentSessionId: string | null = null;
  private cache = new Map<string, Map<string, { data: SearchResult[]; expiresAt: number }>>();
  private loggedIn = false;

  getStatus(): McpStatus {
    return this.status;
  }

  async connect(username: string, password: string): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      await this.disconnect();
    }

    this.status = "connecting";

    try {
      this.currentSessionId = randomUUID();

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
    if (this.currentSessionId) {
      this.cache.delete(this.currentSessionId);
    }

    await this.cleanupResources();
    this.status = "disconnected";
    this.currentSessionId = null;
    this.loggedIn = false;
  }

  // ── MOOCs 検索 ────────────────────────────────

  async searchMoocs(
    query: string
  ): Promise<{ success: boolean; results: SearchResult[]; error?: string; debug?: string }> {
    if (this.status !== "connected" || !this.client) {
      return { success: false, results: [], error: "MCP client is not connected" };
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { success: true, results: [] };
    }

    const cacheKey = query.toLowerCase().trim();
    let sessionCache = this.currentSessionId ? this.cache.get(this.currentSessionId) : undefined;
    const cached = sessionCache?.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { success: true, results: cached.data };
    }

    try {
      // 初回検索時にログイン（MCPサーバーのPlaywrightでINIADにログイン）
      let courses: CourseSummary[] = [];
      if (!this.loggedIn) {
        const loginResult = await this.callToolSafe("loginToIniadMoocsWithIniadAccount");
        const parsed = loginResult as { isError?: boolean } | undefined;
        if (parsed?.isError) {
          return { success: false, results: [], error: "INIAD MOOCsへのログインに失敗しました" };
        }
        courses = this.parseToolResult<CourseSummary>(loginResult, "login");
        this.loggedIn = true;
        console.log(`[McpClient] Login successful, found ${courses.length} courses`);
      } else {
        courses = await this.fetchCourses();
      }

      const [lectures, slides] = await Promise.all([
        this.fetchLectureLinks(),
        this.fetchSlideLinks(),
      ]);

      const normalizedQuery = trimmedQuery.toLowerCase();
      const results: SearchResult[] = [];

      for (const course of courses) {
        if (!course.title) continue;
        if (this.matchesQuery(course.title, normalizedQuery)) {
          results.push({
            title: course.title,
            url: course.url ?? "",
            snippet: course.description ?? `INIAD MOOCs コース: ${course.title}`,
            source: "moocs",
            relevanceScore: this.computeRelevance(course.title, normalizedQuery),
          });
        }
      }

      for (const lecture of lectures) {
        if (!lecture.title) continue;
        if (this.matchesQuery(lecture.title, normalizedQuery)) {
          results.push({
            title: lecture.title,
            url: lecture.url ?? "",
            snippet: `INIAD MOOCs 講義: ${lecture.title}`,
            source: "moocs",
            relevanceScore: this.computeRelevance(lecture.title, normalizedQuery),
          });
        }
      }

      for (const slide of slides) {
        if (!slide.title) continue;
        if (this.matchesQuery(slide.title, normalizedQuery)) {
          results.push({
            title: slide.title,
            url: slide.url ?? "",
            snippet: `INIAD MOOCs スライド: ${slide.title}`,
            source: "moocs",
            relevanceScore: this.computeRelevance(slide.title, normalizedQuery),
          });
        }
      }

      results.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

      if (!sessionCache) {
        sessionCache = new Map();
        this.cache.set(this.currentSessionId!, sessionCache);
      }
      sessionCache.set(cacheKey, {
        data: results,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      const tokens = this.tokenizeQuery(normalizedQuery);
      const courseTitles = courses.map((c) => c.title).filter(Boolean);
      console.log(
        `[McpClient] searchMoocs: query="${trimmedQuery}", tokens=${JSON.stringify(tokens)}, ` +
          `courses=${courses.length}(${JSON.stringify(courseTitles.slice(0, 5))}), ` +
          `lectures=${lectures.length}, slides=${slides.length}, matched=${results.length}`
      );

      return {
        success: true,
        results,
        debug: `courses=${courses.length}[${courseTitles.slice(0, 3).join(", ")}], lectures=${lectures.length}, slides=${slides.length}, tokens=${tokens.join("|")}, matched=${results.length}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("timed out") || message.includes("ETIMEDOUT")) {
        return { success: false, results: [], error: `MCP tool call timed out: ${message}` };
      }

      return { success: false, results: [], error: `MOOCs search failed: ${message}` };
    }
  }

  // ── ツール呼び出しヘルパー ──────────────────────

  private async callToolSafe(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
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

  private async fetchCourses(): Promise<CourseSummary[]> {
    if (this.currentSessionId && !this.cache.has(this.currentSessionId)) {
      this.cache.set(this.currentSessionId, new Map());
    }
    const result = await this.callToolSafe("listCourses");
    return this.parseToolResult<CourseSummary>(result, "listCourses");
  }

  private async fetchLectureLinks(): Promise<LectureLink[]> {
    const result = await this.callToolSafe("listLectureLinks");
    return this.parseToolResult<LectureLink>(result, "listLectureLinks");
  }

  private async fetchSlideLinks(): Promise<SlideLink[]> {
    const result = await this.callToolSafe("listSlideLinks");
    return this.parseToolResult<SlideLink>(result, "listSlideLinks");
  }

  private parseToolResult<T>(result: unknown, _toolName: string): T[] {
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

  // ── テキストマッチング ──────────────────────────

  private tokenizeQuery(query: string): string[] {
    return query
      .toLowerCase()
      .split(
        /(?:から|まで|について|また|やで|もの)|[のはがをにでともへや、。！？・\s\-_.：:；;（）()「」『』【】[\]]+/
      )
      .filter((t) => t.length >= 2);
  }

  private matchesQuery(title: string, normalizedQuery: string): boolean {
    const normalizedTitle = title.toLowerCase();
    const tokens = this.tokenizeQuery(normalizedQuery);
    if (tokens.length === 0) return false;
    return tokens.some((token) => normalizedTitle.includes(token));
  }

  private computeRelevance(title: string, normalizedQuery: string): number {
    const lower = title.toLowerCase();
    const tokens = this.tokenizeQuery(normalizedQuery);
    if (tokens.length === 0) return 0;

    let matched = 0;
    for (const token of tokens) {
      if (lower.includes(token)) matched++;
    }

    const bonus = tokens.every((t) => lower.includes(t)) ? 0.1 : 0;
    return Math.min(1, matched / tokens.length + bonus);
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

  cleanupCache(): void {
    const now = Date.now();
    for (const [sessionId, sessionCache] of this.cache) {
      for (const [key, entry] of sessionCache) {
        if (entry.expiresAt <= now) sessionCache.delete(key);
      }
      if (sessionCache.size === 0) this.cache.delete(sessionId);
    }
  }
}
