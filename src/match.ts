import type { KeywordRow, RssPost } from "./types";

export function findMatchedKeyword(
  post: RssPost,
  keywords: KeywordRow[],
): string | null {
  const haystack = `${post.title}\n${post.description}`.toLowerCase();
  for (const row of keywords) {
    const needle = row.keyword.trim().toLowerCase();
    if (!needle) continue;
    if (haystack.includes(needle)) return row.keyword;
  }
  return null;
}
