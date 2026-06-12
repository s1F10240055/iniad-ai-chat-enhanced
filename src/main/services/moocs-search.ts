import type { McpClient } from "./mcp-client";
import type {
  CourseSummary,
  LectureLink,
  SlideLink,
  SearchResult,
} from "../../shared/types/search";
import {
  isBlockedSnapshot,
  snapshotKindFromCacheKey,
  sortSnapshotsByPriority,
  filterSnapshotsForRag,
  type CachedSnapshot,
} from "./moocs-snapshot";
import { pickLectures, pickSlides, isContentSlide } from "./moocs-query";
import {
  parseGoogleSlideExtract,
  formatSlideTextForLlm,
  isReadableSlideText,
} from "../../shared/utils/google-slide-text";

const CACHE_TTL_MS = 5 * 60 * 1000;

export class MoocsSearch {
  private cache = new Map<string, { data: SearchResult[]; expiresAt: number }>();
  private slideSnapshotCache = new Map<
    string,
    { data: string; title: string; expiresAt: number }
  >();
  private loggedIn = false;
  private googleLoggedIn = false;

  constructor(private mcpClient: McpClient) {}

  async searchMoocs(
    query: string
  ): Promise<{ success: boolean; results: SearchResult[]; error?: string; debug?: string }> {
    if (this.mcpClient.getStatus() !== "connected") {
      return {
        success: false,
        results: [],
        error: "MCP未接続です。設定画面でMOOCs認証情報を入力し、接続してください。",
      };
    }

    const healthy = await this.mcpClient.ping();
    if (!healthy) {
      this.reset();
      return {
        success: false,
        results: [],
        error: "MCP接続が切断されました。設定画面から再接続してください。",
      };
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
        console.log(`[MoocsSearch] Not logged in, calling login tool...`);
        const loginResult = await this.mcpClient.loginToMoocs();
        console.log(`[MoocsSearch] Login result:`, JSON.stringify(loginResult, null, 2));
        const parsed = loginResult as { isError?: boolean } | undefined;
        if (parsed?.isError) {
          const errorText = (
            loginResult as { content?: Array<{ type: string; text?: string }> }
          )?.content
            ?.map((c) => c.text)
            .join("\n");
          console.error(`[MoocsSearch] Login FAILED: ${errorText}`);
          return {
            success: false,
            results: [],
            error: "INIAD MOOCsへのログインに失敗しました",
            debug: errorText,
          };
        }
        courses = this.mcpClient.parseToolResult<CourseSummary>(loginResult);
        this.loggedIn = true;
        console.log(`[MoocsSearch] Login successful, found ${courses.length} courses`);

        await this.ensureGoogleLogin();
      } else {
        courses = await this.mcpClient.fetchCourses();
      }

      const normalizedQuery = trimmedQuery.toLowerCase();
      const results: SearchResult[] = [];

      console.log(
        `[MoocsSearch] Matching: query="${trimmedQuery}", tokens=${JSON.stringify(this.tokenizeQuery(normalizedQuery))}`
      );
      console.log(
        `[MoocsSearch] Available courses: ${courses
          .map((c) => c.title)
          .filter(Boolean)
          .join(", ")}`
      );

      const matchedCourses: CourseSummary[] = [];
      for (const course of courses) {
        if (!course.title) continue;
        if (this.matchesQuery(course.title, normalizedQuery)) {
          const score = this.computeRelevance(course.title, normalizedQuery);
          console.log(`[MoocsSearch] ✓ course matched: "${course.title}" score=${score}`);
          matchedCourses.push(course);
          results.push({
            title: course.title,
            url: course.url ?? "",
            snippet: course.description ?? `INIAD MOOCs コース: ${course.title}`,
            source: "moocs",
            relevanceScore: score,
          });
        }
      }

      let lectures: LectureLink[] = [];
      let slides: SlideLink[] = [];
      if (matchedCourses.length > 0) {
        const topCourse = matchedCourses[0];
        if (topCourse.url) {
          console.log(`[MoocsSearch] Navigating to course: ${topCourse.url}`);
          try {
            await this.mcpClient.navigateTo(topCourse.url);
            lectures = await this.mcpClient.fetchLectureLinks();
            console.log(`[MoocsSearch] Course page: lectures=${lectures.length}`);

            const courseSnapshot = await this.mcpClient.getPageSnapshot();
            if (courseSnapshot) {
              this.cacheSnapshot(`course:${topCourse.url}`, {
                data: courseSnapshot,
                title: `${topCourse.title}（コース概要）`,
              });
              console.log(
                `[MoocsSearch] ✓ course overview snapshot cached (${courseSnapshot.length} chars)`
              );
            }

            const matchedLectures = pickLectures(lectures, normalizedQuery, (title, q) =>
              this.matchesQuery(title, q)
            );
            if (matchedLectures.length > 0 && matchedLectures[0].url) {
              const targetLecture = matchedLectures[0];
              const lectureUrl = targetLecture.url!;
              console.log(
                `[MoocsSearch] Navigating to lecture: ${targetLecture.title} (${lectureUrl})`
              );
              await this.mcpClient.navigateTo(lectureUrl);
              slides = await this.mcpClient.fetchSlideLinks();
              console.log(
                `[MoocsSearch] Lecture page: slides=${slides.length}, content=${slides.filter(isContentSlide).length}`
              );

              const slidesToFetch = pickSlides(slides, normalizedQuery, (title, q) =>
                this.matchesQuery(title, q)
              ).slice(0, 5);

              for (const slide of slidesToFetch) {
                try {
                  console.log(`[MoocsSearch] Getting snapshot: ${slide.title} (${slide.url})`);
                  await this.mcpClient.navigateTo(slide.url);
                  await this.mcpClient.expandSlideTab();
                  const slideText = await this.fetchSlideText(slide.url);
                  console.log(
                    `[MoocsSearch] slide text: ${slideText ? `got ${slideText.length} chars` : "null"}`
                  );
                  if (slideText) {
                    this.cacheSnapshot(slide.url, {
                      data: slideText,
                      title: `${targetLecture.title} / ${slide.title}`,
                    });
                  }
                } catch (ssErr) {
                  console.warn(`[MoocsSearch] Snapshot failed for ${slide.title}:`, ssErr);
                }
              }
            }
          } catch (navErr) {
            console.warn(`[MoocsSearch] Navigation failed:`, navErr);
          }
        }
      }

      for (const lecture of lectures) {
        if (!lecture.title) continue;
        if (this.matchesQuery(lecture.title, normalizedQuery)) {
          const score = this.computeRelevance(lecture.title, normalizedQuery);
          console.log(`[MoocsSearch] ✓ lecture matched: "${lecture.title}" score=${score}`);
          results.push({
            title: lecture.title,
            url: lecture.url ?? "",
            snippet: `INIAD MOOCs 講義: ${lecture.title}`,
            source: "moocs",
            relevanceScore: score,
          });
        }
      }

      const resultSlides = pickSlides(slides, normalizedQuery, (title, q) =>
        this.matchesQuery(title, q)
      );
      for (const slide of resultSlides) {
        if (!slide.title) continue;
        const score = this.computeRelevance(slide.title, normalizedQuery);
        console.log(`[MoocsSearch] ✓ slide matched: "${slide.title}" score=${score}`);
        results.push({
          title: slide.title,
          url: slide.url ?? "",
          snippet: `INIAD MOOCs スライド: ${slide.title}`,
          source: "moocs",
          relevanceScore: score,
        });
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

      if (this.mcpClient.isConnectionError(error)) {
        this.reset();
        return {
          success: false,
          results: [],
          error: "MCP接続が切断されました。設定画面から再接続してください。",
        };
      }

      if (message.includes("timed out") || message.includes("ETIMEDOUT")) {
        return { success: false, results: [], error: `MCP tool call timed out: ${message}` };
      }

      return { success: false, results: [], error: `MOOCs search failed: ${message}` };
    }
  }

  reset(): void {
    this.cache.clear();
    this.slideSnapshotCache.clear();
    this.loggedIn = false;
    this.googleLoggedIn = false;
  }

  cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    for (const [key, entry] of this.slideSnapshotCache) {
      if (entry.expiresAt <= now) this.slideSnapshotCache.delete(key);
    }
  }

  /** RAG 注入用: コース概要・教材スライドを優先し、出席確認等は除外 */
  getSlideSnapshots(): CachedSnapshot[] {
    const now = Date.now();
    const results: CachedSnapshot[] = [];
    for (const [url, entry] of this.slideSnapshotCache) {
      if (entry.expiresAt > now) {
        results.push({
          url,
          title: entry.title,
          data: entry.data,
          kind: snapshotKindFromCacheKey(url),
        });
      }
    }
    return filterSnapshotsForRag(results);
  }

  /** 全キャッシュ（デバッグ・インデックス収集用） */
  getAllSnapshots(): CachedSnapshot[] {
    const now = Date.now();
    const results: CachedSnapshot[] = [];
    for (const [url, entry] of this.slideSnapshotCache) {
      if (entry.expiresAt > now) {
        results.push({
          url,
          title: entry.title,
          data: entry.data,
          kind: snapshotKindFromCacheKey(url),
        });
      }
    }
    return sortSnapshotsByPriority(results);
  }

  private cacheSnapshot(
    key: string,
    entry: { data: string; title: string }
  ): void {
    if (isBlockedSnapshot(entry.data, key)) {
      console.log(`[MoocsSearch] Skipping blocked snapshot: ${entry.title}`);
      return;
    }
    this.slideSnapshotCache.set(key, {
      ...entry,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    console.log(`[MoocsSearch] ✓ snapshot cached: ${entry.title}`);
  }

  private async fetchSlideText(moocsUrl: string): Promise<string | null> {
    try {
      const extractResult = await this.mcpClient.extractGoogleSlideText();
      const textBlock = (extractResult as { content?: Array<{ text?: string }> })?.content?.[0]
        ?.text;
      if (textBlock) {
        const parsed = parseGoogleSlideExtract(textBlock);
        if (parsed?.text && isReadableSlideText(parsed.text)) {
          return formatSlideTextForLlm(parsed, moocsUrl);
        }
      }
    } catch (err) {
      console.warn(`[MoocsSearch] extractGoogleSlideText failed:`, err);
    }

    return this.mcpClient.getPageSnapshot();
  }

  private async ensureGoogleLogin(): Promise<void> {
    if (this.googleLoggedIn) return;
    try {
      console.log(`[MoocsSearch] Logging in to Google (INIAD account)...`);
      await this.mcpClient.loginToGoogle();
      this.googleLoggedIn = true;
      console.log(`[MoocsSearch] Google login succeeded`);
    } catch (err) {
      console.warn(
        `[MoocsSearch] Google login failed (slide iframe may show login wall):`,
        err instanceof Error ? err.message : err
      );
    }
  }

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
    return tokens.some(
      (token) =>
        normalizedTitle.includes(token) ||
        (normalizedTitle.length >= 2 && token.includes(normalizedTitle))
    );
  }

  private computeRelevance(title: string, normalizedQuery: string): number {
    const lower = title.toLowerCase();
    const tokens = this.tokenizeQuery(normalizedQuery);
    if (tokens.length === 0) return 0;

    let matched = 0;
    for (const token of tokens) {
      if (lower.includes(token) || (lower.length >= 2 && token.includes(lower))) {
        matched++;
      }
    }

    const bonus = tokens.every((t) => lower.includes(t) || (lower.length >= 2 && t.includes(lower)))
      ? 0.1
      : 0;
    return Math.min(1, matched / tokens.length + bonus);
  }
}
