export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /** Shared secret for /setup-webhook and /check */
  ADMIN_SECRET: string;
  RSS_URL: string;
  /** Comma-separated Telegram user IDs; empty = allow all */
  ALLOWED_USER_IDS: string;
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
