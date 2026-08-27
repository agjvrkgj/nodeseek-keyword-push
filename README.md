# NodeSeek 关键词监控（Cloudflare Workers + D1 + Telegram）

每分钟拉取 [NodeSeek RSS](https://rss.nodeseek.com/)，当帖子**标题或摘要**命中自定义关键词时，通过 Telegram Bot 推送。关键词可用 Bot 命令增删；配置 NodeSeek Cookie 后还会每日自动签到并通知结果。

## 架构

```
Cron (* * * * *) ──► Worker ──► RSS
                      │
                      ├─ D1: keywords / seen_posts / meta
                      └─ Telegram Bot API 推送
```

- **首次运行**：静默标记当前 RSS 中的帖子为已见，避免历史帖刷屏
- **去重**：`seen_posts` 表按 `post_id` 去重
- **关键词**：Telegram `/add` `/del` 管理，大小写不敏感子串匹配
- **自动签到**：默认每天 UTC+8 09:00 后执行；失败每 6 小时重试，通知每天最多一次

## 部署

**第一次部署请直接看：[DEPLOY.md](./DEPLOY.md)**（纯网页 / Git，无需本机安装 Node、无需本地启动）。

简要流程：

1. 创建 Telegram Bot，拿到 Token  
2. 代码放到 GitHub / GitLab，填好 `wrangler.toml` 里的 `database_id`  
3. Cloudflare 控制台连接仓库并部署  
4. 网页配置 Secrets，D1 Console 建表  
5. 浏览器打开 `/setup-webhook`，Telegram 里 `/start`  

前置：Cloudflare 账号、Telegram、GitHub（或 GitLab）。

## Bot 命令

| 命令 | 说明 |
|------|------|
| `/start` | 绑定当前聊天 |
| `/list` | 列出关键词 |
| `/add 关键词` | 添加 |
| `/del 关键词或ID` | 删除 |
| `/on` `/off` | 启用 / 停用单个关键词 |
| `/pause` `/resume` | 暂停 / 恢复推送 |
| `/check` | 立即检查 |
| `/signin` | 立即执行一次 NodeSeek 签到 |
| `/status` | 运行状态 |
| `/help` | 帮助 |

## HTTP 接口

| 路径 | 说明 |
|------|------|
| `GET /` | 健康检查 |
| `GET /setup-webhook?secret=` | 设置 TG Webhook + 命令菜单 |
| `GET /check?secret=` | 手动跑一轮监控 |
| `GET /checkin?secret=` | 手动执行签到并通知 |
| `POST /telegram` | Telegram Webhook |

## 说明

1. RSS 摘要不一定是全文；正文级匹配需要额外抓帖子页，本项目未做。  
2. Cloudflare 免费版 Cron 最短间隔约 1 分钟。  
3. `ALLOWED_USER_IDS` 建议填上你的 TG 用户 ID（可问 [@userinfobot](https://t.me/userinfobot)）。  
4. `wrangler.toml` 里的 `database_id` 必须改成真实 D1 UUID 后才能部署成功。  

## 自动签到配置

在 Cloudflare Worker 的 **Variables and Secrets** 中添加：

| 名称 | 类型 | 说明 |
|------|------|------|
| `NODESEEK_COOKIE` | Secret | 登录 NodeSeek 后请求头中的完整 Cookie；不配置则不启用签到 |
| `NODESEEK_USER_AGENT` | Variable | 建议填写获取 Cookie 时浏览器的 User-Agent |
| `NODESEEK_CHECKIN_HOUR` | Variable | UTC+8 的首次尝试小时，默认 `9` |
| `NODESEEK_CHECKIN_RANDOM` | Variable | `true` 试试手气，`false` 固定奖励 |

部署后可在 Telegram 发送 `/signin` 测试。Cookie 失效或 NodeSeek 拒绝 Cloudflare 出口请求时，Bot 会返回 HTTP 状态和错误信息；Cookie 和 User-Agent 必须成对更新。
