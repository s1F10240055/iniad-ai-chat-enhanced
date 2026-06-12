/** Google ログイン壁が検出されたスナップショットのマーカー */
export const GOOGLE_LOGIN_MARKERS = [
  "Google アカウントにログイン",
  "このコンテンツにアクセスするにはログインする必要があります",
  "Google ロゴ",
] as const;

/** 出席確認・非公開など、講義教材として使えないページ */
export const USELESS_PAGE_MARKERS = [
  "現在この問題は非公開です",
  "出席確認 Bookmark",
] as const;

export type SnapshotKind = "course" | "lecture" | "slide";

export interface CachedSnapshot {
  url: string;
  title: string;
  data: string;
  kind: SnapshotKind;
}

/** RAG に注入すべきでないスナップショット（Google ログイン壁・出席確認ページ等） */
export function isBlockedSnapshot(data: string, cacheKey?: string): boolean {
  if (USELESS_PAGE_MARKERS.some((m) => data.includes(m))) {
    return true;
  }

  if (cacheKey?.startsWith("course:")) {
    return false;
  }

  return GOOGLE_LOGIN_MARKERS.some((m) => data.includes(m));
}

export function snapshotKindFromCacheKey(cacheKey: string): SnapshotKind {
  if (cacheKey.startsWith("course:")) return "course";
  if (cacheKey.startsWith("lecture:")) return "lecture";
  return "slide";
}

const KIND_PRIORITY: Record<SnapshotKind, number> = {
  course: 0,
  lecture: 1,
  slide: 2,
};

/** コース概要 → 講義概要 → スライドの順にソート */
export function sortSnapshotsByPriority(snapshots: CachedSnapshot[]): CachedSnapshot[] {
  return [...snapshots].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}

/** RAG 注入対象: コース概要と教材スライド（講義URLは /atnd になりがちなので除外） */
export function filterSnapshotsForRag(snapshots: CachedSnapshot[]): CachedSnapshot[] {
  return sortSnapshotsByPriority(snapshots)
    .filter((s) => s.kind !== "lecture")
    .filter((s) => !isBlockedSnapshot(s.data, s.url));
}
