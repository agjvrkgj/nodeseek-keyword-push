import { Hono } from "hono";
import { handleTelegramUpdate } from "./bot";
import { runMonitor } from "./monitor";
import { setBotCommands, setWebhook } from "./telegram";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.json({
    name: "nodeseek-keyword-push",
    status: "ok",
    hint: "POST /telegram · GET /check?secret=... · GET /setup-webhook?secret=...",
  }),
);

app.get("/setup-webhook", async (c) => {
  const secret = c.req.query("secret");
  if (!secret || secret !== c.env.ADMIN_SECRET) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  const url = new URL(c.req.url);
  const workerUrl = `${url.protocol}//${url.host}`;
  const webhook = await setWebhook(c.env, workerUrl);
  await setBotCommands(c.env);

  return c.json({ ok: webhook.ok, workerUrl, webhook: webhook.detail });
});

app.get("/check", async (c) => {
  const secret = c.req.query("secret");
  if (!secret || secret !== c.env.ADMIN_SECRET) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  const result = await runMonitor(c.env);
  return c.json({ ok: !result.error, ...result });
});

app.post("/telegram", async (c) => {
  try {
    const update = await c.req.json();
    await handleTelegramUpdate(c.env, update);
  } catch (err) {
    console.error("Telegram webhook error:", err);
  }
  // Always 200 so Telegram does not retry endlessly
  return c.json({ ok: true });
});

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runMonitor(env).then((result) => {
        console.log("cron monitor:", JSON.stringify(result));
      }),
    );
  },
};
