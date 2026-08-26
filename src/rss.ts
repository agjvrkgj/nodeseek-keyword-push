import type { RssPost } from "./types";

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();
}

function stripTags(text: string): string {
  return decodeXml(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tagValue(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : "";
}

function tagAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*/?>`, "i");
  const m = block.match(re);
  return m ? m[1] : "";
}

export function parseRss(xml: string): RssPost[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  const posts: RssPost[] = [];

  for (const item of items) {
    const guid = tagValue(item, "guid") || tagAttr(item, "guid", "isPermaLink");
    const link = tagValue(item, "link");
    const id =
      guid ||
      link.match(/post-(\d+)/)?.[1] ||
      link;

    if (!id) continue;

    posts.push({
      id: String(id).trim(),
      title: stripTags(tagValue(item, "title")),
      description: stripTags(tagValue(item, "description")),
      link: link.trim(),
      category: stripTags(tagValue(item, "category")),
      author: stripTags(tagValue(item, "dc:creator") || tagValue(item, "author")),
      pubDate: tagValue(item, "pubDate"),
    });
  }

  return posts;
}

export async function fetchRss(url: string): Promise<RssPost[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "nodeseek-keyword-push/1.0 (+cloudflare-workers)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });

  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  return parseRss(xml);
}
