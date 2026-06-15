import type { SearchResult } from "../../shared/types/search";

export interface IWebSearchProvider {
  search(query: string): Promise<{ success: boolean; results: SearchResult[]; error?: string }>;
}
