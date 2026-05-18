/**
 * WebSearchClient - DuckDuckGo Instant Answer API を使用した Web 検索クライアント
 *
 * API キー不要で、DuckDuckGo のインスタントアンサー API から
 * 要約・関連トピックを取得して SearchResult[] に変換する。
 */

import type { SearchResult } from "../../shared/types/search";

const DDG_API_URL = "https://api.duckduckgo.com/";
const REQUEST_TIMEOUT_MS = 10_000;

interface DdgResponse {
  Abstract?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Heading?: string;
  RelatedTopics?: Array<
    | { Text?: string; FirstURL?: string; Result?: string }
    | { Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }
  >;
  Results?: Array<{ Text?: string; FirstURL?: string }>;
}

export class WebSearchClient {
  async search(
    query: string
  ): Promise<{ success: boolean; results: SearchResult[]; error?: string }> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { success: true, results: [] };
    }

    try {
      const url = new URL(DDG_API_URL);
      url.searchParams.set("q", trimmedQuery);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_html", "1");
      url.searchParams.set("skip_disambig", "1");

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          results: [],
          error: `DuckDuckGo API returned ${response.status}`,
        };
      }

      const data = (await response.json()) as DdgResponse;
      const results: SearchResult[] = [];

      if (data.Abstract && data.AbstractURL) {
        results.push({
          title: data.Heading || data.AbstractSource || "DuckDuckGo",
          url: data.AbstractURL,
          snippet: data.Abstract,
          source: "web",
          relevanceScore: 0.9,
        });
      }

      if (data.Results) {
        for (const result of data.Results) {
          if (result.Text && result.FirstURL) {
            results.push({
              title: result.Text.replace(/<[^>]*>/g, ""),
              url: result.FirstURL,
              snippet: result.Text,
              source: "web",
              relevanceScore: 0.85,
            });
          }
        }
      }

      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics) {
          if ("Topics" in topic && topic.Topics) {
            for (const sub of topic.Topics) {
              if (results.length >= 10) break;
              if (sub.Text && sub.FirstURL) {
                results.push({
                  title: sub.Text.slice(0, 80),
                  url: sub.FirstURL,
                  snippet: sub.Text,
                  source: "web",
                  relevanceScore: 0.7,
                });
              }
            }
          } else if ("Text" in topic && topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.slice(0, 80),
              url: topic.FirstURL,
              snippet: topic.Text,
              source: "web",
              relevanceScore: 0.75,
            });
          }

          if (results.length >= 10) break;
        }
      }

      return { success: true, results };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (
        message.includes("timed out") ||
        message.includes("ETIMEDOUT") ||
        message.includes("abort")
      ) {
        return {
          success: false,
          results: [],
          error: `Web search timed out: ${message}`,
        };
      }

      return {
        success: false,
        results: [],
        error: `Web search failed: ${message}`,
      };
    }
  }
}
