import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cron } from "./plugins/cron.plugin";
import { config } from "dotenv";

config();

const app = new Elysia()
  .use(swagger)
  .use(cron)
  .listen(process.env.PORT ?? 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
