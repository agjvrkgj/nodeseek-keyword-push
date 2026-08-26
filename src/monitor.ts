import {
  cleanupOldSeen,
  getMeta,
  isSeen,
  listKeywords,
  markSeen,
  markSeenBatch,
  setMeta,
} from "./db";
import { findMatchedKeyword } from "./match";
import { fetchRss } from "./rss";
import { formatMatchMessage, sendMessage } from "./telegram";
import type { Env } from "./types";

export interface MonitorResult {
  fetched: number;
  newPosts: number;
  matched: number;
  notified: number;
  bootstrapped: boolean;
  paused: boolean;
  error?: string;
}

export async function runMonitor(env: Env): Promise<MonitorResult> {
  const result: MonitorResult = {
    fetched: 0,
    newPosts: 0,
    matched: 0,
    notified: 0,
    bootstrapped: false,
    paused: false,
  };

  try {
    const posts = await fetchRss(env.RSS_URL || "https://rss.nodeseek.com/");
    result.fetched = posts.length;

    const bootstrapped = (await getMeta(env.DB, "bootstrapped")) === "1";
    if (!bootstrapped) {
      await markSeenBatch(env.DB, posts);
      await setMeta(env.DB, "bootstrapped", "1");
      result.bootstrapped = true;
      result.newPosts = posts.length;
      return result;
    }

    const paused = (await getMeta(env.DB, "paused")) === "1";
    result.paused = paused;

    const chatId = await getMeta(env.DB, "chat_id");
    const keywords = await listKeywords(env.DB, true);

    // Process oldest-first so notifications stay chronological
    const ordered = [...posts].reverse();

    for (const post of ordered) {
      if (await isSeen(env.DB, post.id)) continue;
      result.newPosts += 1;

      const matched = findMatchedKeyword(post, keywords);
      if (!matched) {
        await markSeen(env.DB, post, null, false);
        continue;
      }

      result.matched += 1;

      let notified = false;
      if (!paused && chatId && keywords.length > 0) {
        notified = await sendMessage(env, chatId, formatMatchMessage(post, matched));
        if (notified) result.notified += 1;
      }

      await markSeen(env.DB, post, matched, notified);
    }

    await cleanupOldSeen(env.DB, 14);
    await setMeta(env.DB, "last_check_at", new Date().toISOString());
    await setMeta(
      env.DB,
      "last_check_summary",
      JSON.stringify({
        fetched: result.fetched,
        newPosts: result.newPosts,
        matched: result.matched,
        notified: result.notified,
        at: new Date().toISOString(),
      }),
    );

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("Monitor error:", result.error);
    return result;
  }
}
