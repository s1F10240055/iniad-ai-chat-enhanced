import type { McpClient } from "./mcp-client";
import type { SlidesIndexService } from "./slides-index";
import type { Citation } from "../../shared/types/chat";
import type { MaterialContextInput } from "./in-memory-store";
import {
  parseGoogleSlideExtract,
  formatSlideTextForLlm,
  isReadableSlideText,
} from "../../shared/utils/google-slide-text";
import {
  getMoocsPageKind,
  inferMoocsLocation,
  isGoogleSlidePage,
  pageCitationTitle,
  type MoocsPageKind,
} from "./moocs-page-kind";
import { mcpResultToText, truncate, type ToolExecutionResult } from "./mcp-result";

const MAX_SNAPSHOT_CHARS = 3_000;

export interface MaterialToolExecutionResult extends ToolExecutionResult {
  /** Main 内の資料コンテキストへ保存してよい、実本文を伴う資料だけを格納する。 */
  materials?: MaterialContextInput[];
}

export class MoocsPageReader {
  constructor(
    private mcpClient: McpClient,
    private slidesIndex?: SlidesIndexService,
    private slideReadCache?: Map<string, string>,
    private signal?: AbortSignal
  ) {}

  async readPage(url?: string): Promise<MaterialToolExecutionResult> {
    return this.readSlideContent(url);
  }

  async tryExtractSlideText(citations: Citation[]): Promise<MaterialToolExecutionResult | null> {
    try {
      const result = await withAbort(
        this.mcpClient.extractGoogleSlideText(this.signal),
        this.signal
      );
      const rawText = mcpResultToText(result);
      const parsed = parseGoogleSlideExtract(rawText);
      if (parsed?.text && isReadableSlideText(parsed.text)) {
        const moocsUrl = parsed.moocsUrl;
        if (moocsUrl) citations.push(this.buildCitation(moocsUrl, "MOOCs スライド"));
        return this.withMaterials(truncate(formatSlideTextForLlm(parsed, moocsUrl)), citations);
      }
    } catch (error) {
      if (this.signal?.aborted) throw error;
      // fall through to accessibility snapshot
    }
    return null;
  }

  private async readSlideContent(slideUrl?: string): Promise<MaterialToolExecutionResult> {
    throwIfAborted(this.signal);
    const moocsUrl = slideUrl;
    const citations: Citation[] = [];

    if (moocsUrl && this.slideReadCache?.has(moocsUrl)) {
      const cached = this.slideReadCache.get(moocsUrl)!;
      citations.push(this.buildCitation(moocsUrl, "MOOCs スライド"));
      return this.withMaterials(cached, citations);
    }

    if (moocsUrl) {
      await withAbort(this.mcpClient.navigateTo(moocsUrl, this.signal), this.signal);
      citations.push(this.buildCitation(moocsUrl, pageCitationTitle(moocsUrl)));
    }

    const pageKind = moocsUrl ? getMoocsPageKind(moocsUrl) : "other";
    if (moocsUrl && !isGoogleSlidePage(moocsUrl)) {
      return this.readHtmlMoocsPage(moocsUrl, pageKind, citations);
    }

    if (moocsUrl && this.slidesIndex?.isLoaded()) {
      const indexedEntry = this.slidesIndex.getEntryByMoocsUrl(moocsUrl);
      if (indexedEntry?.text) {
        const content = truncate(
          `MOOCs URL: ${moocsUrl}\nSource: slides-index\n\n${indexedEntry.text}`
        );
        this.slideReadCache?.set(moocsUrl, content);
        return this.withMaterials(content, citations);
      }
    }

    await withAbort(this.mcpClient.expandSlideTab(this.signal), this.signal);
    const extractResult = await withAbort(
      this.mcpClient.extractGoogleSlideText(this.signal),
      this.signal
    );
    const rawText = mcpResultToText(extractResult);
    const parsed = parseGoogleSlideExtract(rawText);
    const resolvedUrl = moocsUrl ?? parsed?.moocsUrl;

    // L61 で moocsUrl の citation は積み済み。抽出で新たに URL が判明した場合のみ追加（重複回避）
    if (resolvedUrl && resolvedUrl !== moocsUrl) {
      citations.push(this.buildCitation(resolvedUrl, "MOOCs スライド"));
    }

    if (parsed?.error === "no_google_slides_iframe") {
      return this.readHtmlMoocsPage(moocsUrl ?? "", pageKind, citations);
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
      if (resolvedUrl) this.slideReadCache?.set(resolvedUrl, content);
      return this.withMaterials(content, citations);
    }

    if (resolvedUrl && this.slidesIndex?.isLoaded()) {
      const indexedEntry = this.slidesIndex.getEntryByMoocsUrl(resolvedUrl);
      if (indexedEntry?.text) {
        const content = truncate(
          `MOOCs URL: ${resolvedUrl}\nSource: slides-index (fallback)\n\n${indexedEntry.text}`
        );
        this.slideReadCache?.set(resolvedUrl, content);
        return this.withMaterials(content, citations);
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

  private async readHtmlMoocsPage(
    moocsUrl: string,
    pageKind: MoocsPageKind,
    citations: Citation[]
  ): Promise<MaterialToolExecutionResult> {
    const snapshot = await withAbort(this.mcpClient.getPageSnapshot(this.signal), this.signal);
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
    this.slideReadCache?.set(moocsUrl, content);
    return this.withMaterials(content, citations, !isPrivate);
  }

  private buildCitation(url: string, fallbackTitle: string): Citation {
    const indexed = this.slidesIndex?.getEntryByMoocsUrl(url);
    if (indexed) {
      return {
        title: `${indexed.courseName}: ${indexed.slideTitle}`,
        url,
        location: `第${formatIndexNumber(indexed.lectureNum)}回 / 資料${formatIndexNumber(indexed.slideNum)}`,
        sourceType: "moocs",
      };
    }

    return {
      title: fallbackTitle,
      url,
      location: inferMoocsLocation(url),
      sourceType: "moocs",
    };
  }

  private withMaterials(
    content: string,
    citations: Citation[],
    recordable = true
  ): MaterialToolExecutionResult {
    if (!recordable || !isRecordableMaterial(content)) return { content, citations };
    // A read operation returns one page body. When navigation and extraction
    // produce multiple citations, the last citation is the resolved page that
    // actually owns that body; duplicating it across every citation would retain
    // incorrect material↔content associations.
    const primaryCitation = citations.at(-1);
    if (!primaryCitation) return { content, citations };
    return {
      content,
      citations,
      materials: [
        {
          title: primaryCitation.title,
          url: primaryCitation.url,
          location: primaryCitation.location,
          sourceType: primaryCitation.sourceType,
          content,
        },
      ],
    };
  }
}

function formatIndexNumber(value: string): string {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? String(parsed) : value;
}

function isRecordableMaterial(content: string): boolean {
  return (
    content.trim().length > 0 &&
    !/^(?:Error:|Tool error:|Navigated to)/i.test(content.trim()) &&
    !/^Status:\s*非公開/im.test(content)
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("リクエストがキャンセルされました");
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("リクエストがキャンセルされました"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
