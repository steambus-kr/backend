import { Elysia, t } from "elysia";
import { cron as cronPlugin } from "@elysiajs/cron";
import { db } from "@/db";
import { FetchGameInfoService } from "@/services/cron.service";

export const cron = new Elysia({ prefix: "/cron" })
  .use(
    cronPlugin({
      name: "fetchGameInfo",
      pattern: "0 0 * * * *",
      timezone: "Asia/Seoul",
      run: async () => {
        const service = new FetchGameInfoService();
        await service.init();
        await service.start();
      },
    }),
  )
  .get("/health", async ({ error }) => {
    if (!process.env.APP_STATE_ID) {
      error(500);
      return;
    }
    const state = await db.state.findUnique({
      where: {
        id: parseInt(process.env.APP_STATE_ID),
      },
    });
    if (!state) {
      error(500);
      return;
    }

    if (
      !state.last_fetched_info ||
      state.last_fetched_info.getTime() <
        new Date().getTime() - 1000 * 60 * 60 * 24
    ) {
      error(512);
      return;
    }

    return { ok: true };
  })
  .guard({
    headers: t.Object({
      "X-ADMIN-KEY": t.Optional(t.String()),
    }),
  })
  .put("/fetchGameInfo", async ({ error, headers }) => {
    if (
      process.env.NODE_ENV !== "development" ||
      !headers["X-ADMIN-KEY"] ||
      headers["X-ADMIN-KEY"] !== process.env.ADMIN_KEY
    ) {
      error(400);
    }
    const service = new FetchGameInfoService();
    await service.init();
    await service.start();
  })
  .guard({
    params: t.Object({
      id: t.Number(),
    }),
  })
  .put("/fetchGameInfo/:id", async ({ error, params: { id }, headers }) => {
    if (
      process.env.NODE_ENV !== "development" ||
      !headers["X-ADMIN-KEY"] ||
      headers["X-ADMIN-KEY"] !== process.env.ADMIN_KEY
    ) {
      error(400);
    }
    const service = new FetchGameInfoService();
    await service.init();
    return await service.saveGameInfo(id);
  });
