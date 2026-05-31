import { readFileSync, existsSync } from "fs";
import path from "path";
import type {
  SyllabusIndex,
  CourseEntry,
  ScheduleEntry,
  CourseMatch,
} from "../../shared/types/syllabus";

function resolveDefaultIndexPath(): string {
  const candidates = [
    path.join(process.resourcesPath ?? __dirname, "data", "syllabus-index.json"),
    path.resolve(__dirname, "..", "..", "..", "data", "syllabus-index.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const DEFAULT_INDEX_PATH = resolveDefaultIndexPath();
const MIN_TOKEN_LENGTH = 2;

const STOP_WORDS = /(?:から|まで|について|また|やで|もの|教えて|ください|です|ます|して|の|回答)/;
const SPLIT_CHARS = /[のはがをにでともへや、。！？・\s\-_.：:；;（）()「」『』【】[\]]+/;

export class SyllabusIndexService {
  private index: SyllabusIndex | null = null;

  async load(indexPath?: string): Promise<void> {
    const filePath = indexPath ?? DEFAULT_INDEX_PATH;

    try {
      const raw = readFileSync(filePath, "utf-8");
      this.index = JSON.parse(raw) as SyllabusIndex;
      console.log(`[SyllabusIndex] Loaded ${this.index.courses.length} courses from ${filePath}`);
    } catch (err) {
      console.warn(
        `[SyllabusIndex] Failed to load index: ${err instanceof Error ? err.message : err}`
      );
      this.index = null;
    }
  }

  isLoaded(): boolean {
    return this.index !== null;
  }

  matchCourses(query: string): CourseMatch[] {
    if (!this.index) return [];

    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const matches: CourseMatch[] = [];

    for (const course of this.index.courses) {
      if (course.status === "error") continue;

      const result = this.matchCourse(course, tokens);
      if (result) matches.push(result);
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    return matches.slice(0, 3);
  }

  private matchCourse(course: CourseEntry, tokens: string[]): CourseMatch | null {
    const courseName = course.courseName ?? "";
    const keywords = Array.isArray(course.keywords) ? course.keywords : [];
    const schedule = Array.isArray(course.schedule) ? course.schedule : [];
    const searchableFields = [
      courseName,
      course.description ?? "",
      course.objectives ?? "",
      ...keywords,
      ...schedule.map((s) => s?.topic ?? ""),
    ];

    const searchableText = searchableFields.join(" ").toLowerCase();

    let matched = 0;
    const matchedSchedule: ScheduleEntry[] = [];

    for (const token of tokens) {
      if (searchableText.includes(token)) {
        matched++;
      }

      for (const entry of schedule) {
        if (
          entry?.topic &&
          entry.topic.toLowerCase().includes(token) &&
          !matchedSchedule.includes(entry)
        ) {
          matchedSchedule.push(entry);
        }
      }
    }

    if (matched === 0) return null;

    const allMatched = tokens.every((t) => searchableText.includes(t));
    const confidence = Math.min(1, matched / tokens.length + (allMatched ? 0.1 : 0));

    return {
      courseName,
      confidence,
      matchedScheduleEntries: matchedSchedule.length > 0 ? matchedSchedule : undefined,
    };
  }

  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(new RegExp(`${STOP_WORDS.source}|${SPLIT_CHARS.source}`))
      .filter((t) => t.length >= MIN_TOKEN_LENGTH);
  }
}
