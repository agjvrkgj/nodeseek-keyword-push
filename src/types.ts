export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /** Shared secret for /setup-webhook and /check */
  ADMIN_SECRET: string;
  RSS_URL: string;
  /** Comma-separated Telegram user IDs; empty = allow all */
  ALLOWED_USER_IDS: string;
  /** NodeSeek login cookie. Store as a Cloudflare secret. Empty = disable check-in. */
  NODESEEK_COOKIE?: string;
  /** Browser User-Agent associated with the NodeSeek cookie. */
  NODESEEK_USER_AGENT?: string;
  /** true = random reward, false = fixed reward */
  NODESEEK_CHECKIN_RANDOM?: string;
  /** First automatic attempt hour in UTC+8, defaults to 9. */
  NODESEEK_CHECKIN_HOUR?: string;
}

export interface RssPost {
  id: string;
  title: string;
  description: string;
  link: string;
  category: string;
  author: string;
  pubDate: string;
}

export interface KeywordRow {
  id: number;
  keyword: string;
  enabled: number;
  created_at: string;
}
