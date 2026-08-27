import {
  addKeyword,
  deleteKeyword,
  getMeta,
  listKeywords,
  parseAllowedUserIds,
  setKeywordEnabled,
  setMeta,
} from "./db";
import { formatCheckInResult, getLastCheckInResult, runDailyCheckIn } from "./checkin";
import { runMonitor } from "./monitor";
import { sendMessage } from "./telegram";
import type { Env } from "./types";

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TgChat {
  id: number;
  type: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

const HELP = `NodeSeek 关键词监控

/start — 绑定当前聊天
/list — 查看关键词
/add 关键词 — 添加
/del 关键词或ID — 删除
/on 关键词或ID — 启用
/off 关键词或ID — 停用
/pause — 暂停推送
/resume — 恢复推送
/check — 立即检查 RSS
/signin — 立即签到 NodeSeek
/status — 运行状态
/help — 帮助

匹配范围：帖子标题 + RSS 摘要（大小写不敏感）。`;

function isAllowed(env: Env, userId: number | undefined): boolean {
  const allowed = parseAllowedUserIds(env);
  if (allowed.size === 0) return true;
  if (userId === undefined) return false;
  return allowed.has(String(userId));
}

async function reply(env: Env, chatId: number, text: string): Promise<void> {
  await sendMessage(env, chatId, text, { disable_web_page_preview: true, parse_mode: undefined });
}

type PendingAction = "add" | "del" | "on" | "off";

const PENDING_PROMPTS: Record<PendingAction, { text: string; placeholder: string }> = {
  add: { text: "请直接回复要添加的关键词。", placeholder: "输入关键词，例如 VPS" },
  del: { text: "请直接回复要删除的关键词或 ID。", placeholder: "输入关键词或 ID" },
  on: { text: "请直接回复要启用的关键词或 ID。", placeholder: "输入关键词或 ID" },
  off: { text: "请直接回复要停用的关键词或 ID。", placeholder: "输入关键词或 ID" },
};

function pendingActionKey(chatId: number, userId: number | undefined): string {
  return `pending_action:${chatId}:${userId ?? "anonymous"}`;
}

function parsePendingAction(value: string | null): PendingAction | null {
  if (value === "add" || value === "del" || value === "on" || value === "off") return value;
  return null;
}

async function applyPendingAction(
  env: Env,
  action: PendingAction,
  arg: string,
): Promise<{ ok: boolean; message: string }> {
  switch (action) {
    case "add":
      return addKeyword(env.DB, arg);
    case "del":
      return deleteKeyword(env.DB, arg);
    case "on":
      return setKeywordEnabled(env.DB, arg, true);
    case "off":
      return setKeywordEnabled(env.DB, arg, false);
  }
}

async function promptForArg(env: Env, chatId: number, action: PendingAction): Promise<void> {
  const prompt = PENDING_PROMPTS[action];
  await sendMessage(env, chatId, prompt.text, {
    disable_web_page_preview: true,
    parse_mode: undefined,
    reply_markup: {
      force_reply: true,
      input_field_placeholder: prompt.placeholder,
    },
  });
}

export async function handleTelegramUpdate(env: Env, update: TgUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text.trim();
  const pendingKey = pendingActionKey(chatId, userId);

  if (!isAllowed(env, userId)) {
    await reply(env, chatId, "无权操作。请在 ALLOWED_USER_IDS 中加入你的 Telegram 用户 ID。");
    return;
  }

  if (!text.startsWith("/")) {
    const pending = parsePendingAction(await getMeta(env.DB, pendingKey));
    if (pending) {
      await setMeta(env.DB, pendingKey, "");
      const result = await applyPendingAction(env, pending, text);
      await reply(env, chatId, result.message);
      return;
    }
  }

  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();
  await setMeta(env.DB, pendingKey, "");

  switch (cmd) {
    case "/start": {
      await setMeta(env.DB, "chat_id", String(chatId));
      if (userId) await setMeta(env.DB, "owner_user_id", String(userId));
      await reply(env, chatId, `已绑定聊天 ${chatId}\n\n${HELP}`);
      return;
    }
    case "/help": {
      await reply(env, chatId, HELP);
      return;
    }
    case "/list": {
      const rows = await listKeywords(env.DB);
      if (rows.length === 0) {
        await reply(env, chatId, "暂无关键词。用 /add 关键词 添加。");
        return;
      }
      const lines = rows.map(
        (r) => `${r.id}. ${r.keyword} ${r.enabled ? "✅" : "⏸"}`,
      );
      await reply(env, chatId, `关键词列表：\n${lines.join("\n")}`);
      return;
    }
    case "/add": {
      if (!arg) {
        await setMeta(env.DB, pendingKey, "add");
        await promptForArg(env, chatId, "add");
        return;
      }
      const result = await addKeyword(env.DB, arg);
      await reply(env, chatId, result.message);
      return;
    }
    case "/del":
    case "/delete":
    case "/rm": {
      if (!arg) {
        await setMeta(env.DB, pendingKey, "del");
        await promptForArg(env, chatId, "del");
        return;
      }
      const result = await deleteKeyword(env.DB, arg);
      await reply(env, chatId, result.message);
      return;
    }
    case "/on": {
      if (!arg) {
        await setMeta(env.DB, pendingKey, "on");
        await promptForArg(env, chatId, "on");
        return;
      }
      const result = await setKeywordEnabled(env.DB, arg, true);
      await reply(env, chatId, result.message);
      return;
    }
    case "/off": {
      if (!arg) {
        await setMeta(env.DB, pendingKey, "off");
        await promptForArg(env, chatId, "off");
        return;
      }
      const result = await setKeywordEnabled(env.DB, arg, false);
      await reply(env, chatId, result.message);
      return;
    }
    case "/pause": {
      await setMeta(env.DB, "paused", "1");
      await reply(env, chatId, "已暂停推送。");
      return;
    }
    case "/resume": {
      await setMeta(env.DB, "paused", "0");
      await reply(env, chatId, "已恢复推送。");
      return;
    }
    case "/check": {
      await reply(env, chatId, "正在检查 RSS…");
      const result = await runMonitor(env);
      if (result.error) {
        await reply(env, chatId, `检查失败：${result.error}`);
        return;
      }
      await reply(
        env,
        chatId,
        [
          "检查完成",
          `抓取：${result.fetched}`,
          `新帖：${result.newPosts}`,
          `命中：${result.matched}`,
          `推送：${result.notified}`,
          result.bootstrapped ? "（首次启动：已静默标记现有帖子）" : "",
          result.paused ? "（当前已暂停推送）" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }
    case "/signin":
    case "/checkin": {
      await reply(env, chatId, "正在签到 NodeSeek…");
      const result = await runDailyCheckIn(env, { force: true, notify: false });
      await reply(env, chatId, formatCheckInResult(result));
      return;
    }
    case "/status": {
      const chat = await getMeta(env.DB, "chat_id");
      const paused = (await getMeta(env.DB, "paused")) === "1";
      const bootstrapped = (await getMeta(env.DB, "bootstrapped")) === "1";
      const last = await getMeta(env.DB, "last_check_at");
      const summary = await getMeta(env.DB, "last_check_summary");
      const checkIn = await getLastCheckInResult(env.DB);
      const keywords = await listKeywords(env.DB);
      const enabled = keywords.filter((k) => k.enabled).length;

      await reply(
        env,
        chatId,
        [
          "状态",
          `绑定聊天：${chat || "未绑定（请 /start）"}`,
          `推送：${paused ? "已暂停" : "运行中"}`,
          `初始化：${bootstrapped ? "完成" : "未完成"}`,
          `关键词：${enabled}/${keywords.length} 启用`,
          `上次检查：${last || "无"}`,
          summary ? `摘要：${summary}` : "",
          checkIn ? `签到：${checkIn}` : "签到：暂无记录",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }
    default: {
      if (cmd.startsWith("/")) {
        await reply(env, chatId, "未知命令。发送 /help 查看帮助。");
      }
    }
  }
}
