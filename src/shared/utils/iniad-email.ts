/** INIAD 学籍番号を Google Workspace メールアドレスに変換する */
export function toIniadGoogleEmail(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return "";
  return trimmed.includes("@") ? trimmed : `${trimmed}@iniad.org`;
}
