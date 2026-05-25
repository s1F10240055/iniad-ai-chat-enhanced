import type { McpClient } from "./mcp-client";
import type { CourseSummary, SearchResult } from "../../shared/types/search";

const CACHE_TTL_MS = 5 * 60 * 1000;

export class MoocsSearch {
  private cache = new Map<string, { data: SearchResult[]; expiresAt: number }>();
  private loggedIn = false;

  constructor(private mcpClient: McpClient) {}

  async searchMoocs(
    query: string
  ): Promise<{ success: boolean; results: SearchResult[]; error?: string; debug?: string }> {
    if (this.mcpClient.getStatus() !== "connected") {
      return { success: false, results: [], error: "MCP client is not connected" };
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { success: true, results: [] };
    }

    const cacheKey = query.toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { success: true, results: cached.data };
    }

    try {
      let courses: CourseSummary[] = [];
      if (!this.loggedIn) {
        const loginResult = await this.mcpClient.callToolSafe("loginToIniadMoocsWithIniadAccount");
        const parsed = loginResult as { isError?: boolean } | undefined;
        if (parsed?.isError) {
          return { success: false, results: [], error: "INIAD MOOCsへのログインに失敗しました" };
        }
        courses = this.mcpClient.parseToolResult<CourseSummary>(loginResult);
        this.loggedIn = true;
        console.log(`[MoocsSearch] Login successful, found ${courses.length} courses`);
      } else {
        courses = await this.mcpClient.fetchCourses();
      }

      const [lectures, slides] = await Promise.all([
        this.mcpClient.fetchLectureLinks(),
        this.mcpClient.fetchSlideLinks(),
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

      this.cache.set(cacheKey, {
        data: results,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      const tokens = this.tokenizeQuery(normalizedQuery);
      const courseTitles = courses.map((c) => c.title).filter(Boolean);
      console.log(
        `[MoocsSearch] searchMoocs: query="${trimmedQuery}", tokens=${JSON.stringify(tokens)}, ` +
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

  reset(): void {
    this.cache.clear();
    this.loggedIn = false;
  }

  cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
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
}
