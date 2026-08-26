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

/** NodeSeek RSS category slug → 中文版块名 */
const CATEGORY_LABELS: Record<string, string> = {
  daily: "日常",
  tech: "技术",
  info: "情报",
  review: "测评",
  trade: "交易",
  carpool: "拼车",
  promote: "推广",
  life: "生活",
  dev: "Dev",
  "photo-share": "贴图",
  expose: "曝光",
  nonsense: "无意义",
  sandbox: "沙盒",
};

function categoryLabel(category: string | undefined): string {
  const key = (category || "").trim().toLowerCase();
  if (!key) return "未知";
  return CATEGORY_LABELS[key] || category || "未知";
}

function truncateText(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen).trimEnd() + "…";
}

export function formatMatchMessage(post: RssPost, keyword: string): string {
  const title = escapeHtml(post.title || "（无标题）");
  const category = escapeHtml(categoryLabel(post.category));
  const author = escapeHtml(post.author || "匿名");
  const snippet = truncateText(post.description, 120);
  const link = escapeHtml(post.link);

  const lines = [
    `🔔 <b>关键词命中</b>  <code>${escapeHtml(keyword)}</code>`,
    "",
    `<b>${title}</b>`,
    `${category} · ${author}`,
  ];

  if (snippet) {
    lines.push("", `<i>${escapeHtml(snippet)}</i>`);
  }

  lines.push("", `<a href="${link}">查看帖子</a>`);

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
      { command: "add", description: "添加关键词" },
      { command: "del", description: "删除关键词" },
      { command: "on", description: "启用关键词" },
      { command: "off", description: "停用关键词" },
      { command: "pause", description: "暂停推送" },
      { command: "resume", description: "恢复推送" },
      { command: "check", description: "立即检查一次 RSS" },
      { command: "status", description: "查看运行状态" },
    ],
  });
}
