import type { Citation } from "../../shared/types/chat";

export function isCourseListUrl(url: string): boolean {
  return /^https:\/\/moocs\.iniad\.org\/courses\/\d{4}\/[A-Z0-9]+\/?$/.test(url);
}

export function collectCitationsFromText(text: string, citations: Citation[]): void {
  const urlRegex = /https:\/\/moocs\.iniad\.org\/[^\s"'<>]+/g;
  const urls = text.match(urlRegex) ?? [];
  for (const url of urls) {
    if (isCourseListUrl(url)) continue;
    if (!citations.some((c) => c.url === url)) {
      citations.push({ title: "MOOCs", url, snippet: undefined });
    }
  }
}
