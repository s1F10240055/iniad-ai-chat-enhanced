export type { MoocsPageKind } from "./moocs-page-kind";
export { getMoocsPageKind, isGoogleSlidePage } from "./moocs-page-kind";

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

/** 初回・講義資料など、特定講義を指すクエリか */
export function impliesLectureContent(query: string): boolean {
  return /(初回|第\d+回|\d+回目|講義資料|スライド|まとめ)/.test(query);
}
