import type { McpClient } from "./mcp-client";
import type { SlidesIndexService } from "./slides-index";
import type { Citation } from "../../shared/types/chat";
import {
  parseGoogleSlideExtract,
  formatSlideTextForLlm,
  isReadableSlideText,
} from "../../shared/utils/google-slide-text";
import {
  getMoocsPageKind,
  isGoogleSlidePage,
  pageCitationTitle,
  type MoocsPageKind,
} from "./moocs-page-kind";
import { mcpResultToText, truncate, type ToolExecutionResult } from "./mcp-result";

const MAX_SNAPSHOT_CHARS = 3_000;

export class MoocsPageReader {
  constructor(
    private mcpClient: McpClient,
    private slidesIndex?: SlidesIndexService,
    private slideReadCache?: Map<string, string>
  ) {}

  async readPage(url?: string): Promise<ToolExecutionResult> {
    return this.readSlideContent(url);
  }

  async tryExtractSlideText(citations: Citation[]): Promise<ToolExecutionResult | null> {
    try {
      const result = await this.mcpClient.extractGoogleSlideText();
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

  private async readSlideContent(slideUrl?: string): Promise<ToolExecutionResult> {
    const moocsUrl = slideUrl;
    const citations: Citation[] = [];

    if (moocsUrl && this.slideReadCache?.has(moocsUrl)) {
      const cached = this.slideReadCache.get(moocsUrl)!;
      citations.push({ title: "MOOCs スライド", url: moocsUrl });
      return { content: cached, citations };
    }

    if (moocsUrl) {
      await this.mcpClient.navigateTo(moocsUrl);
      citations.push({ title: pageCitationTitle(moocsUrl), url: moocsUrl });
    }

    const pageKind = moocsUrl ? getMoocsPageKind(moocsUrl) : "other";
    if (moocsUrl && !isGoogleSlidePage(moocsUrl)) {
      return this.readHtmlMoocsPage(moocsUrl, pageKind, citations);
    }

    if (moocsUrl && this.slidesIndex?.isLoaded()) {
      const indexed = this.slidesIndex.getTextByMoocsUrl(moocsUrl);
      if (indexed) {
        const content = truncate(
          `MOOCs URL: ${moocsUrl}\nSource: slides-index\n\n${indexed}`
        );
        this.slideReadCache?.set(moocsUrl, content);
        return { content, citations };
      }
    }

    await this.mcpClient.expandSlideTab();
    const extractResult = await this.mcpClient.extractGoogleSlideText();
    const rawText = mcpResultToText(extractResult);
    const parsed = parseGoogleSlideExtract(rawText);
    const resolvedUrl = moocsUrl ?? parsed?.moocsUrl;

    // L61 で moocsUrl の citation は積み済み。抽出で新たに URL が判明した場合のみ追加（重複回避）
    if (resolvedUrl && resolvedUrl !== moocsUrl) {
      citations.push({ title: "MOOCs スライド", url: resolvedUrl });
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
      return { content, citations };
    }

    if (resolvedUrl && this.slidesIndex?.isLoaded()) {
      const indexed = this.slidesIndex.getTextByMoocsUrl(resolvedUrl);
      if (indexed) {
        const content = truncate(
          `MOOCs URL: ${resolvedUrl}\nSource: slides-index (fallback)\n\n${indexed}`
        );
        this.slideReadCache?.set(resolvedUrl, content);
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

  private async readHtmlMoocsPage(
    moocsUrl: string,
    pageKind: MoocsPageKind,
    citations: Citation[]
  ): Promise<ToolExecutionResult> {
    const snapshot = await this.mcpClient.getPageSnapshot();
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
    return { content, citations };
  }
}
