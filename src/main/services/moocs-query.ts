import type { LectureLink, SlideLink } from "../../shared/types/search";

export type MoocsPageKind =
  | "slide"
  | "exercise"
  | "review"
  | "attendance"
  | "lecture"
  | "course"
  | "other";

/** MOOCs URL のページ種別（Google スライドがあるのは slide のみ） */
export function getMoocsPageKind(url: string): MoocsPageKind {
  const path = url.replace(/\/$/, "");
  if (/\/atnd$/.test(path)) return "attendance";
  if (/\/exercise$/.test(path)) return "exercise";
  if (/\/review$/.test(path)) return "review";
  if (/\/courses\/\d{4}\/[A-Z0-9]+\/\d{2}\/\d{2}$/.test(path)) return "slide";
  if (/\/courses\/\d{4}\/[A-Z0-9]+\/\d{2}$/.test(path)) return "lecture";
  if (/\/courses\/\d{4}\/[A-Z0-9]+$/.test(path)) return "course";
  return "other";
}

export function isGoogleSlidePage(url: string): boolean {
  return getMoocsPageKind(url) === "slide";
}

export function impliesAssignmentQuery(query: string): boolean {
  return /(課題解説|演習課題|課題|提出|レビュー)/.test(query);
}

/** list_slides 結果から課題系ページを優先選択 */
export function pickAssignmentSlides(
  slides: SlideLink[],
  query: string
): SlideLink[] {
  const q = query.toLowerCase();
  if (/課題解説/.test(q)) {
    return slides.filter((s) => /課題解説/.test(s.title ?? "") || /\/review$/.test(s.url ?? ""));
  }
  if (/演習課題|課題/.test(q)) {
    return slides.filter((s) => /演習課題/.test(s.title ?? "") || /\/exercise$/.test(s.url ?? ""));
  }
  return [];
}

/** クエリから講義回番号（01, 02, ...）を推定する */
export function parseLectureOrdinal(query: string): string | null {
  const q = query.toLowerCase();

  if (/(初回|第1回|1回目|第一回)/.test(q)) return "01";
  if (/(第2回|2回目|第二回)/.test(q)) return "02";
  if (/(第3回|3回目|第三回)/.test(q)) return "03";

  const daiMatch = q.match(/第(\d{1,2})回/);
  if (daiMatch) return daiMatch[1].padStart(2, "0");

  const numMatch = q.match(/(\d{1,2})回目/);
  if (numMatch) return numMatch[1].padStart(2, "0");

  return null;
}

/** 講義リンクのタイトル先頭 "01:" から回番号を取得 */
export function lectureNumFromTitle(title: string): string | null {
  const m = title.trim().match(/^(\d{2}):/);
  return m ? m[1] : null;
}

/** 初回・講義資料など、特定講義を指すクエリか */
export function impliesLectureContent(query: string): boolean {
  return /(初回|第\d+回|\d+回目|講義資料|スライド|まとめ)/.test(query);
}

export function pickLectures(
  lectures: LectureLink[],
  normalizedQuery: string,
  titleMatcher: (title: string, query: string) => boolean
): LectureLink[] {
  const byTitle = lectures.filter((l) => l.title && titleMatcher(l.title, normalizedQuery));
  if (byTitle.length > 0) return byTitle;

  const ordinal = parseLectureOrdinal(normalizedQuery);
  if (ordinal) {
    const byOrdinal = lectures.filter((l) => lectureNumFromTitle(l.title ?? "") === ordinal);
    if (byOrdinal.length > 0) return byOrdinal;
  }

  if (impliesLectureContent(normalizedQuery)) {
    const numbered = lectures
      .filter((l) => lectureNumFromTitle(l.title ?? "") !== null)
      .sort((a, b) => (lectureNumFromTitle(a.title!) ?? "").localeCompare(lectureNumFromTitle(b.title!) ?? ""));
    const first = numbered.find((l) => lectureNumFromTitle(l.title!) !== "00");
    if (first) return [first];
  }

  return [];
}

/** 出席確認・非リンクなど、教材本文ではないスライドを除外 */
export function isContentSlide(slide: SlideLink): boolean {
  if (!slide.url || slide.url === "#" || slide.url.endsWith("#")) return false;
  const title = slide.title ?? "";
  if (/出席確認/.test(title)) return false;
  if (/演習課題|課題解説/.test(title) && !/^\d+\./.test(title)) return false;
  return true;
}

export function pickSlides(
  slides: SlideLink[],
  normalizedQuery: string,
  titleMatcher: (title: string, query: string) => boolean
): SlideLink[] {
  const content = slides.filter(isContentSlide);
  const byTitle = content.filter((s) => s.title && titleMatcher(s.title, normalizedQuery));
  if (byTitle.length > 0) return byTitle;

  if (impliesLectureContent(normalizedQuery)) {
    return content;
  }

  return [];
}
