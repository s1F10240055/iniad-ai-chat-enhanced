/**
 * 検索関連の共通型定義
 * MCP Client / Search Client の検索結果の型
 */

/** MOOCs コース概要（MCP ツール loginToIniadMoocsWithIniadAccount / listCourses の戻り値） */
export interface CourseSummary {
  /** コース名 */
  title: string;
  /** コースのURL */
  url: string;
  /** コースの説明 */
  description?: string;
}

/** MOOCs 講義リンク（listLectureLinks の戻り値） */
export interface LectureLink {
  /** 講義回のタイトル */
  title: string;
  /** 講義ページのURL */
  url: string;
}

/** MOOCs スライドリンク（listSlideLinks の戻り値） */
export interface SlideLink {
  /** スライドのタイトル */
  title: string;
  /** スライドのURL */
  url: string;
}

/** 検索結果の統一型（RetrievalOrchestrator が各ソースから統合して返す） */
export interface SearchResult {
  /** 検索結果のタイトル */
  title: string;
  /** 検索結果のURL */
  url: string;
  /** 関連部分のスニペット */
  snippet: string;
  /** 検索ソースの種別 */
  source: "moocs" | "web";
  /** 関連度スコア（0〜1、高いほど関連あり） */
  relevanceScore?: number;
}

/** 検索クライアントのキャッシュエントリ */
export interface CacheEntry<T> {
  /** キャッシュされたデータ */
  data: T;
  /** キャッシュの有効期限（タイムスタンプ） */
  expiresAt: number;
}
