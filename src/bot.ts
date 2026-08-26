import {
  addKeyword,
  deleteKeyword,
  getMeta,
  listKeywords,
  parseAllowedUserIds,
  setKeywordEnabled,
  setMeta,
} from "./db";
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

export async function handleTelegramUpdate(env: Env, update: TgUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text.trim();

  if (!isAllowed(env, userId)) {
    await reply(env, chatId, "无权操作。请在 ALLOWED_USER_IDS 中加入你的 Telegram 用户 ID。");
    return;
  }

  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();

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
        await reply(env, chatId, "用法：/add 关键词");
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
        await reply(env, chatId, "用法：/del 关键词或ID");
        return;
      }
      const result = await deleteKeyword(env.DB, arg);
      await reply(env, chatId, result.message);
      return;
    }
    case "/on": {
      if (!arg) {
        await reply(env, chatId, "用法：/on 关键词或ID");
        return;
      }
      const result = await setKeywordEnabled(env.DB, arg, true);
      await reply(env, chatId, result.message);
      return;
    }
    case "/off": {
      if (!arg) {
        await reply(env, chatId, "用法：/off 关键词或ID");
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
    case "/status": {
      const chat = await getMeta(env.DB, "chat_id");
      const paused = (await getMeta(env.DB, "paused")) === "1";
      const bootstrapped = (await getMeta(env.DB, "bootstrapped")) === "1";
      const last = await getMeta(env.DB, "last_check_at");
      const summary = await getMeta(env.DB, "last_check_summary");
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
