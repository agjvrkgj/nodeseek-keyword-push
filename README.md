# NodeSeek 关键词监控（Cloudflare Workers + D1 + Telegram）

每分钟拉取 [NodeSeek RSS](https://rss.nodeseek.com/)，当帖子**标题或摘要**命中自定义关键词时，通过 Telegram Bot 推送。关键词可用 Bot 命令增删。

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
| `/status` | 运行状态 |
| `/help` | 帮助 |

## HTTP 接口

| 路径 | 说明 |
|------|------|
| `GET /` | 健康检查 |
| `GET /setup-webhook?secret=` | 设置 TG Webhook + 命令菜单 |
| `GET /check?secret=` | 手动跑一轮监控 |
| `POST /telegram` | Telegram Webhook |

## 说明

1. RSS 摘要不一定是全文；正文级匹配需要额外抓帖子页，本项目未做。  
2. Cloudflare 免费版 Cron 最短间隔约 1 分钟。  
3. `ALLOWED_USER_IDS` 建议填上你的 TG 用户 ID（可问 [@userinfobot](https://t.me/userinfobot)）。  
4. `wrangler.toml` 里的 `database_id` 必须改成真实 D1 UUID 后才能部署成功。  
