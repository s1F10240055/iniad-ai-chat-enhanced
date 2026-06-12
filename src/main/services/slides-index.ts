import { readFileSync, existsSync } from "fs";
import path from "path";
import type { SlidesIndex, SlideIndexEntry, SlideMatch } from "../../shared/types/slides";
import { parseLectureOrdinal, impliesLectureContent } from "./moocs-query";

function resolveDefaultIndexPath(): string {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const candidates = [
    path.join(projectRoot, "data", "slides-index.json"),
    path.join(process.resourcesPath ?? "", "data", "slides-index.json"),
    path.resolve(__dirname, "..", "..", "data", "slides-index.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const DEFAULT_INDEX_PATH = resolveDefaultIndexPath();
const MIN_TOKEN_LENGTH = 2;

const STOP_WORDS = /(?:から|まで|について|また|やで|もの|教えて|ください|です|ます|して|の|回答)/;
const SPLIT_CHARS = /[のはがをにでともへや、。！？・\s\-_.：:；;（）()「」『』【】[\]]+/;

export class SlidesIndexService {
  private index: SlidesIndex | null = null;

  load(indexPath?: string): void {
    const filePath = indexPath ?? DEFAULT_INDEX_PATH;

    try {
      const raw = readFileSync(filePath, "utf-8");
      this.index = JSON.parse(raw) as SlidesIndex;
      console.log(
        `[SlidesIndex] Loaded ${this.index.entries.length} slide entries from ${filePath}`
      );
    } catch (err) {
      console.warn(
        `[SlidesIndex] Failed to load index: ${err instanceof Error ? err.message : err}`
      );
      this.index = null;
    }
  }

  isLoaded(): boolean {
    return this.index !== null && (this.index.entries?.length ?? 0) > 0;
  }

  /** MOOCs スライド URL に一致するインデックス本文を返す（末尾スラッシュは無視） */
  getTextByMoocsUrl(moocsUrl: string): string | null {
    if (!this.index?.entries?.length) return null;
    const normalized = moocsUrl.replace(/\/$/, "");
    const entry = this.index.entries.find((e) => e.moocsUrl.replace(/\/$/, "") === normalized);
    return entry?.text ?? null;
  }

  matchSlides(query: string, courseCode?: string): SlideMatch[] {
    if (!this.index?.entries?.length) return [];

    const tokens = this.tokenize(query);
    const ordinal = parseLectureOrdinal(query);
    const matches: SlideMatch[] = [];
    const seen = new Set<string>();

    for (const entry of this.index.entries) {
      if (courseCode && entry.courseCode !== courseCode) continue;

      if (ordinal && entry.lectureNum === ordinal) {
        const key = entry.moocsUrl;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            courseCode: entry.courseCode,
            courseName: entry.courseName,
            slideTitle: `${entry.lectureNum}回: ${entry.slideTitle}`,
            moocsUrl: entry.moocsUrl,
            text: entry.text,
            confidence: 0.88,
          });
        }
        continue;
      }

      if (tokens.length === 0) continue;

      const result = this.matchEntry(entry, tokens);
      if (result && !seen.has(result.moocsUrl)) {
        seen.add(result.moocsUrl);
        matches.push(result);
      }
    }

    if (matches.length === 0 && impliesLectureContent(query) && !courseCode) {
      for (const entry of this.index.entries) {
        if (entry.lectureNum === "01" && !seen.has(entry.moocsUrl)) {
          seen.add(entry.moocsUrl);
          matches.push({
            courseCode: entry.courseCode,
            courseName: entry.courseName,
            slideTitle: entry.slideTitle,
            moocsUrl: entry.moocsUrl,
            text: entry.text,
            confidence: 0.75,
          });
        }
      }
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    return matches.slice(0, 5);
  }

  private matchEntry(entry: SlideIndexEntry, tokens: string[]): SlideMatch | null {
    const searchable = [
      entry.courseName,
      entry.slideTitle,
      entry.text,
      ...entry.keywords,
    ]
      .join(" ")
      .toLowerCase();

    let matched = 0;
    for (const token of tokens) {
      if (searchable.includes(token)) matched++;
    }
    if (matched === 0) return null;

    const allMatched = tokens.every((t) => searchable.includes(t));
    const confidence = Math.min(1, matched / tokens.length + (allMatched ? 0.1 : 0));

    return {
      courseCode: entry.courseCode,
      courseName: entry.courseName,
      slideTitle: entry.slideTitle,
      moocsUrl: entry.moocsUrl,
      text: entry.text,
      confidence,
    };
  }

  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(STOP_WORDS)
      .flatMap((part) => part.split(SPLIT_CHARS))
      .map((t) => t.trim())
      .filter((t) => t.length >= MIN_TOKEN_LENGTH);
  }
}
