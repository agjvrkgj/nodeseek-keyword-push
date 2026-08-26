import type { Env, RssPost } from "./types";

const TG_API = "https://api.telegram.org";

export async function tgRequest(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function sendMessage(
  env: Env,
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const res = await tgRequest(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
    parse_mode: "HTML",
    ...extra,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Telegram sendMessage failed:", res.status, err);
    return false;
  }
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatMatchMessage(post: RssPost, keyword: string): string {
  const snippet = post.description
    ? escapeHtml(post.description.slice(0, 280)) + (post.description.length > 280 ? "…" : "")
    : "";

  const lines = [
    `🔔 <b>关键词命中</b>：<code>${escapeHtml(keyword)}</code>`,
    "",
    `<b>${escapeHtml(post.title)}</b>`,
    `${escapeHtml(post.category || "unknown")} · ${escapeHtml(post.author || "anonymous")}`,
    `<a href="${escapeHtml(post.link)}">${escapeHtml(post.link)}</a>`,
  ];

  if (snippet) {
    lines.push("", snippet);
  }

  return lines.join("\n");
}

export async function setWebhook(env: Env, workerUrl: string): Promise<{ ok: boolean; detail: string }> {
  const url = `${workerUrl.replace(/\/$/, "")}/telegram`;
  const res = await tgRequest(env.TELEGRAM_BOT_TOKEN, "setWebhook", {
    url,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  return { ok: data.ok, detail: data.description || JSON.stringify(data) };
}

export async function setBotCommands(env: Env): Promise<void> {
  await tgRequest(env.TELEGRAM_BOT_TOKEN, "setMyCommands", {
    commands: [
      { command: "start", description: "绑定当前聊天并查看帮助" },
      { command: "help", description: "查看命令帮助" },
      { command: "list", description: "列出关键词" },
      { command: "add", description: "添加关键词：/add 关键词" },
      { command: "del", description: "删除关键词：/del 关键词或ID" },
      { command: "on", description: "启用关键词：/on 关键词或ID" },
      { command: "off", description: "停用关键词：/off 关键词或ID" },
      { command: "pause", description: "暂停推送" },
      { command: "resume", description: "恢复推送" },
      { command: "check", description: "立即检查一次 RSS" },
      { command: "status", description: "查看运行状态" },
    ],
  });
}
