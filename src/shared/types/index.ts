/**
 * 共通型定義の barrel export
 * すべての型を1箇所から import 可能にする
 */
export type {
  ChatTurn,
  Citation,
  ChatResponse,
  ChatCompletionResponse,
} from "./chat";

export type {
  AppSettings,
  PartialAppSettings,
  AppStatus,
  McpStatus,
  ConnectionTestResult,
} from "./settings";

export { DEFAULT_SETTINGS } from "./settings";

export type {
  SearchResult,
  CourseSummary,
  LectureLink,
  SlideLink,
  CacheEntry,
} from "./search";

export type { ErrorCode, SerializableError } from "./errors";
export { AppError, toSerializableError } from "./errors";
