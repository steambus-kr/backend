import { Elysia, t } from "elysia";
import { cron as cronPlugin } from "@elysiajs/cron";
import { db } from "@/db";
import { fetchGameInfoLooper, saveGameInfo } from "@/services/cron.service";

export const cron = new Elysia({ prefix: "/cron" })
  .use(
    cronPlugin({
      name: "fetchGameInfo",
      pattern: "0 0 * * * *",
      timezone: "Asia/Seoul",
      run: fetchGameInfoLooper,
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
  .put("/fetchGameInfo", ({ error, headers }) => {
    if (
      process.env.NODE_ENV !== "development" ||
      !headers["X-ADMIN-KEY"] ||
      headers["X-ADMIN-KEY"] !== process.env.ADMIN_KEY
    ) {
      error(400);
    }
    fetchGameInfoLooper();
  })
  .guard({
    params: t.Object({
      id: t.Number(),
    }),
  })
  .put("/fetchGameInfo/:id", ({ error, params: { id }, headers }) => {
    if (
      process.env.NODE_ENV !== "development" ||
      !headers["X-ADMIN-KEY"] ||
      headers["X-ADMIN-KEY"] !== process.env.ADMIN_KEY
    ) {
      error(400);
    }
    saveGameInfo(id);
  });
