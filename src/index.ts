import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cron } from "./plugins/cron.plugin";
import { config } from "dotenv";
import { logger } from "./logger";
import { recommend } from "@/plugins/recommend.plugin";

config();

const app = new Elysia({ prefix: "/api" })
  .use(swagger)
  .use(cron)
  .use(recommend)
  .use(logger.into())
  .get("/health", async () => {
    return { healthof: "/api/health", ok: true };
  })
  .listen(process.env.PORT ?? 3000);

logger.info(`Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
