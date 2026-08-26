# NodeSeek关键词推送 部署教程（纯网页 / Git）

浏览器部署到 Cloudflare，**不必装 Node、不必本地启动**。

需要：Cloudflare 账号、Telegram、GitHub（或 GitLab）。

--- 

## 1. 准备

1. 注册 [Cloudflare](https://dash.cloudflare.com/sign-up)（不必绑域名）
2. Telegram 找 [@BotFather](https://t.me/BotFather) → `/newbot` → 保存 **Token**（勿提交到 Git）
3. （建议）[@userinfobot](https://t.me/userinfobot) 记下你的数字 ID，稍后填 `ALLOWED_USER_IDS`

## 2. 代码上 Git

Fork / 上传本项目到自己的仓库。保持 `wrangler.toml` 中 `name = "nodeseek-keyword-push"`。

## 3. 创建 D1 并改配置

1. Cloudflare → **D1** → Create → 名称 `nodeseek-keyword-push` → 复制 **Database ID**
2. 网页编辑仓库里的 `wrangler.toml`：

```toml
database_id = "粘贴 UUID"
ALLOWED_USER_IDS = "你的TG用户ID"   # 建议填写
```

3. Commit 到 `main`（Token / Secret **不要**写进仓库）

## 4. 连接 Git 部署

1. **Workers & Pages** → Create → 从 Git 导入本仓库
2. Worker 名称填 `nodeseek-keyword-push`（须与 `wrangler.toml` 一致）→ 部署
3. 记下 URL：`https://nodeseek-keyword-push.<子域>.workers.dev`，打开应见 `"status":"ok"`

失败时检查：名称是否一致、`database_id` 是否仍是占位符、仓库根目录是否有 `wrangler.toml`。

## 5. 配置 Secrets

Worker → **Settings** → **Variables and Secrets**，添加并 Deploy：

| 名称 | 类型 | 值 |
|------|------|-----|
| `TELEGRAM_BOT_TOKEN` | Secret | BotFather 的 Token |
| `ADMIN_SECRET` | Secret | 自设长随机串（记下来） |

## 6. 建表

D1 → `nodeseek-keyword-push` → **Console**，执行：

```sql
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL COLLATE NOCASE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(keyword)
);

CREATE TABLE IF NOT EXISTS seen_posts (
  post_id TEXT PRIMARY KEY,
  title TEXT,
  link TEXT,
  matched_keyword TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seen_posts_created_at ON seen_posts(created_at);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 7. Webhook + 开始用

1. 确认 Worker → **Triggers** 有 Cron `* * * * *`
2. 浏览器打开：

```text
https://nodeseek-keyword-push.<子域>.workers.dev/setup-webhook?secret=你的ADMIN_SECRET
```

应返回 `"ok": true`。

3. Telegram 私聊 Bot：

```text
/start
/add VPS
/list
/check
```

首次会静默标记旧帖，之后每分钟自动检查。

常用：`/del` `/pause` `/resume` `/status` `/help`

---

## 更新与排错

- 改代码 / `wrangler.toml` → Git push 自动部署  
- 改 Secret → 控制台改完 Deploy；Token 变了需重开 `/setup-webhook`  
- 手动检查：`/check?secret=...`；日志：Worker → **Logs**  
- Bot 不回：Webhook 是否成功、Secret 是否 Deploy、`ALLOWED_USER_IDS` 是否包含你  
- 勿泄露 Token、`ADMIN_SECRET`、带 `secret=` 的 URL  

更多说明见 [README.md](./README.md)。
