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

export function pageCitationTitle(url: string): string {
  const kind = getMoocsPageKind(url);
  switch (kind) {
    case "review":
      return "課題解説";
    case "exercise":
      return "演習課題";
    case "attendance":
      return "出席確認";
    case "slide":
      return "MOOCs スライド";
    default:
      return "MOOCs";
  }
}
