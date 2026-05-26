/**
 * シラバスインデックス関連の型定義
 * シラバススクレイピング → LLM抽出 → ランタイムマッチング で使用
 */

export interface ScheduleEntry {
  week: number;
  topic: string;
}

export interface CourseEntry {
  courseName: string;
  subtitle?: string;
  instructor?: string;
  courseCode?: string;
  description?: string;
  objectives?: string;
  schedule: ScheduleEntry[];
  prerequisites: string[];
  keywords: string[];
  syllabusUrl?: string;
  status: "ok" | "partial" | "error";
}

export interface SyllabusIndex {
  academicYear: number;
  faculty: string;
  generatedAt: string;
  courses: CourseEntry[];
}

export interface CourseMatch {
  courseName: string;
  confidence: number;
  matchedScheduleEntries?: ScheduleEntry[];
}
