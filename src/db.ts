import type { Env, KeywordRow, RssPost } from "./types";

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

export async function listKeywords(db: D1Database, enabledOnly = false): Promise<KeywordRow[]> {
  const sql = enabledOnly
    ? "SELECT * FROM keywords WHERE enabled = 1 ORDER BY id ASC"
    : "SELECT * FROM keywords ORDER BY id ASC";
  const { results } = await db.prepare(sql).all<KeywordRow>();
  return results ?? [];
}

export async function addKeyword(db: D1Database, keyword: string): Promise<{ ok: boolean; message: string }> {
  const normalized = keyword.trim();
  if (!normalized) return { ok: false, message: "关键词不能为空" };
  if (normalized.length > 64) return { ok: false, message: "关键词过长（最多 64 字）" };

  try {
    await db.prepare("INSERT INTO keywords (keyword) VALUES (?)").bind(normalized).run();
    return { ok: true, message: `已添加关键词：${normalized}` };
  } catch {
    return { ok: false, message: `关键词已存在：${normalized}` };
  }
}

export async function deleteKeyword(
  db: D1Database,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const byId = /^\d+$/.test(token);
  const result = byId
    ? await db.prepare("DELETE FROM keywords WHERE id = ?").bind(Number(token)).run()
    : await db.prepare("DELETE FROM keywords WHERE keyword = ? COLLATE NOCASE").bind(token).run();

  if ((result.meta.changes ?? 0) > 0) {
    return { ok: true, message: `已删除：${token}` };
  }
  return { ok: false, message: `未找到：${token}` };
}

export async function setKeywordEnabled(
  db: D1Database,
  token: string,
  enabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  const byId = /^\d+$/.test(token);
  const result = byId
    ? await db
        .prepare("UPDATE keywords SET enabled = ? WHERE id = ?")
        .bind(enabled ? 1 : 0, Number(token))
        .run()
    : await db
        .prepare("UPDATE keywords SET enabled = ? WHERE keyword = ? COLLATE NOCASE")
        .bind(enabled ? 1 : 0, token)
        .run();

  if ((result.meta.changes ?? 0) > 0) {
    return { ok: true, message: enabled ? `已启用：${token}` : `已停用：${token}` };
  }
  return { ok: false, message: `未找到：${token}` };
}

export async function isSeen(db: D1Database, postId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM seen_posts WHERE post_id = ?")
    .bind(postId)
    .first();
  return !!row;
}

export async function markSeen(
  db: D1Database,
  post: RssPost,
  matchedKeyword: string | null,
  notified: boolean,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO seen_posts (post_id, title, link, matched_keyword, notified)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(post_id) DO NOTHING`,
    )
    .bind(post.id, post.title, post.link, matchedKeyword, notified ? 1 : 0)
    .run();
}

export async function markSeenBatch(db: D1Database, posts: RssPost[]): Promise<void> {
  if (posts.length === 0) return;
  const stmts = posts.map((post) =>
    db
      .prepare(
        `INSERT INTO seen_posts (post_id, title, link, matched_keyword, notified)
         VALUES (?, ?, ?, NULL, 0)
         ON CONFLICT(post_id) DO NOTHING`,
      )
      .bind(post.id, post.title, post.link),
  );
  await db.batch(stmts);
}

export async function cleanupOldSeen(db: D1Database, keepDays = 14): Promise<void> {
  await db
    .prepare(`DELETE FROM seen_posts WHERE created_at < datetime('now', ?)`)
    .bind(`-${keepDays} days`)
    .run();
}

export function parseAllowedUserIds(env: Env): Set<string> {
  const raw = (env.ALLOWED_USER_IDS || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
