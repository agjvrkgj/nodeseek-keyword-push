import { getMeta, setMeta } from "./db";
import { sendMessage } from "./telegram";
import type { Env } from "./types";

const NODESEEK_ATTENDANCE_URL = "https://www.nodeseek.com/api/attendance";
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const META_LAST_ATTEMPT_AT = "nodeseek_checkin:last_attempt_at";
const META_LAST_SUCCESS_DATE = "nodeseek_checkin:last_success_date";
const META_LAST_RESULT = "nodeseek_checkin:last_result";
const META_FAILURE_NOTICE_DATE = "nodeseek_checkin:failure_notice_date";

interface NodeSeekAttendanceResponse {
  success?: boolean;
  message?: unknown;
  gain?: unknown;
  current?: unknown;
  status?: unknown;
}

export interface CheckInResult {
  configured: boolean;
  attempted: boolean;
  ok: boolean;
  already: boolean;
  message: string;
  status?: number;
  gain?: string;
  current?: string;
  date: string;
}

export interface CheckInOptions {
  /** Ignore the daily schedule and retry cooldown. */
  force?: boolean;
  /** Send the result to the Telegram chat bound by /start. */
  notify?: boolean;
  now?: Date;
}

function chinaDateAndHour(now: Date): { date: string; hour: number } {
  const shifted = new Date(now.getTime() + CHINA_TIME_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
  };
}

function configuredHour(env: Env): number {
  const parsed = Number.parseInt(env.NODESEEK_CHECKIN_HOUR || "9", 10);
  if (!Number.isFinite(parsed)) return 9;
  return Math.min(23, Math.max(0, parsed));
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function safeResponseMessage(raw: string, data: NodeSeekAttendanceResponse | null): string {
  const message = textValue(data?.message);
  if (message) return message;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "NodeSeek 返回空响应";
  return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
}

function skippedResult(date: string, configured: boolean, message: string): CheckInResult {
  return {
    configured,
    attempted: false,
    ok: false,
    already: false,
    message,
    date,
  };
}

async function requestNodeSeek(env: Env, date: string): Promise<CheckInResult> {
  const random = (env.NODESEEK_CHECKIN_RANDOM || "true").toLowerCase() !== "false";
  const url = `${NODESEEK_ATTENDANCE_URL}?random=${random ? "true" : "false"}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Cookie: env.NODESEEK_COOKIE!.trim(),
        Origin: "https://www.nodeseek.com",
        Referer: "https://www.nodeseek.com/board",
        "User-Agent": env.NODESEEK_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    const raw = await response.text();
    let data: NodeSeekAttendanceResponse | null = null;
    try {
      data = JSON.parse(raw) as NodeSeekAttendanceResponse;
    } catch {
      // Keep the raw response below so Cloudflare/NodeSeek error pages remain diagnosable.
    }

    const message = safeResponseMessage(raw, data);
    const already = /已.*签到|已经.*签到|already\s+(checked|signed)/i.test(message);
    const ok = data?.success === true || already;

    return {
      configured: true,
      attempted: true,
      ok,
      already,
      message,
      status: response.status,
      gain: textValue(data?.gain),
      current: textValue(data?.current),
      date,
    };
  } catch (err) {
    return {
      configured: true,
      attempted: true,
      ok: false,
      already: false,
      message: err instanceof Error ? err.message : String(err),
      date,
    };
  }
}

export function formatCheckInResult(result: CheckInResult): string {
  if (!result.configured) return "NodeSeek 自动签到未启用：请先配置 NODESEEK_COOKIE。";
  if (!result.attempted) return result.message;

  const state = result.already ? "今日已签到" : result.ok ? "签到成功" : "签到失败";
  return [
    "NodeSeek 签到",
    `结果：${state}`,
    `消息：${result.message}`,
    result.gain ? `本次获得：${result.gain} 个鸡腿` : "",
    result.current ? `当前鸡腿：${result.current}` : "",
    result.status ? `HTTP：${result.status}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyResult(env: Env, result: CheckInResult): Promise<void> {
  if (!result.attempted) return;

  // A transient failure may be retried later, but only notify once per day to avoid spam.
  if (!result.ok) {
    const notifiedDate = await getMeta(env.DB, META_FAILURE_NOTICE_DATE);
    if (notifiedDate === result.date) return;
    await setMeta(env.DB, META_FAILURE_NOTICE_DATE, result.date);
  }

  const chatId = await getMeta(env.DB, "chat_id");
  if (!chatId) return;
  await sendMessage(env, chatId, formatCheckInResult(result), {
    disable_web_page_preview: true,
    parse_mode: undefined,
  });
}

/**
 * Run at most once after 09:00 China time. Failed attempts may retry every six
 * hours; successful/already-signed-in responses suppress all later attempts that day.
 */
export async function runDailyCheckIn(
  env: Env,
  options: CheckInOptions = {},
): Promise<CheckInResult> {
  const now = options.now || new Date();
  const { date, hour } = chinaDateAndHour(now);

  if (!env.NODESEEK_COOKIE?.trim()) {
    return skippedResult(date, false, "未配置 NODESEEK_COOKIE，已跳过签到。");
  }

  if (!options.force) {
    const lastSuccessDate = await getMeta(env.DB, META_LAST_SUCCESS_DATE);
    if (lastSuccessDate === date) {
      return skippedResult(date, true, "今天已经签到成功，已跳过。");
    }

    if (hour < configuredHour(env)) {
      return skippedResult(date, true, "尚未到每日签到时间，已跳过。");
    }

    const lastAttemptAt = await getMeta(env.DB, META_LAST_ATTEMPT_AT);
    if (lastAttemptAt) {
      const elapsed = now.getTime() - Date.parse(lastAttemptAt);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < RETRY_INTERVAL_MS) {
        return skippedResult(date, true, "距上次签到尝试不足 6 小时，已跳过。");
      }
    }
  }

  // Write before making the request so overlapping minute-level Cron events do not double sign in.
  await setMeta(env.DB, META_LAST_ATTEMPT_AT, now.toISOString());
  const result = await requestNodeSeek(env, date);

  if (result.ok) await setMeta(env.DB, META_LAST_SUCCESS_DATE, date);
  await setMeta(env.DB, META_LAST_RESULT, JSON.stringify({ ...result, at: now.toISOString() }));

  if (options.notify) await notifyResult(env, result);
  return result;
}

export async function getLastCheckInResult(db: D1Database): Promise<string | null> {
  const raw = await getMeta(db, META_LAST_RESULT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CheckInResult;
    return formatCheckInResult(parsed).replace(/\n/g, "；");
  } catch {
    return raw;
  }
}
