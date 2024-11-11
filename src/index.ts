import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cron } from "./plugins/cron.plugin";
import { config } from "dotenv";
import { logger } from "./logger";

config();

const app = new Elysia({ prefix: "/api" })
  .use(swagger)
  .use(cron)
  .use(logger.into())
  .get("/health", async () => {
    return { ok: true };
  })
  .listen(process.env.PORT ?? 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
