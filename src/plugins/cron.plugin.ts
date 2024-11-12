import { Elysia, t } from "elysia";
import { cron as cronPlugin } from "@elysiajs/cron";
import {
  FetchGameInfoService,
  LoggerZipperService,
  PlayerCountService,
} from "@/services/cron.service";
import { logger } from "@/logger";
import { formatMs } from "@/utils";

const formatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "medium",
});

export const cron = new Elysia({ prefix: "/cron" })
  .use(logger.into())
  .use(
    cronPlugin({
      name: "fetchGameInfo",
      pattern: "0 0 * * * *",
      timezone: "Asia/Seoul",
      run: async () => {
        const startTime = new Date();
        logger.info(
          `Starting fetchGameInfo cron on ${formatter.format(startTime)}`,
        );
        const service = new FetchGameInfoService();
        await service.init();
        await service.start();
        logger.info(
          {
            total: service.totalApp,
            success: service.successApp,
            failure: service.failureApp,
          },
          `fetchGameInfo cron started at ${formatter.format(startTime)} ended at ${formatter.format(new Date())}, took ${formatMs(service.elapsedTime)}.`,
        );
      },
    }),
  )
  .use(
    cronPlugin({
      name: "fetchPlayerCount",
      pattern: "0 */30 * * * *",
      timezone: "Asia/Seoul",
      run: async () => {
        const startTime = new Date();
        logger.info(
          `Starting fetchPlayerCount cron on ${formatter.format(startTime)}`,
        );
        const service = new PlayerCountService();
        await service.start();
        logger.info(
          {
            total: service.totalApps,
            success: service.successApps,
            failure: service.failureApps,
          },
          `fetchPlayerCount cron started at ${formatter.format(startTime)} ended at ${formatter.format(new Date())}, took ${formatMs(service.elapsedTime)}.`,
        );
      },
    }),
  )
  .get("/health/fgi", async ({ error }) => {
    const { ok } = await FetchGameInfoService.healthCheck();
    if (!ok) return error(512);
    return { healthof: "/api/cron/health/fgi", ok: true };
  })
  .get("/health/pc", async ({ error }) => {
    const { ok } = await PlayerCountService.healthCheck();
    if (!ok) return error(512);
    return { healthof: "/api/cron/health/pc", ok: true };
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
      return error(400);
    }
    const service = new FetchGameInfoService();
    await service.init();
    await service.start();
  })
  .put("/fetchPlayerCount", async ({ error, headers }) => {
    if (
      process.env.NODE_ENV !== "development" ||
      !headers["X-ADMIN-KEY"] ||
      headers["X-ADMIN-KEY"] !== process.env.ADMIN_KEY
    ) {
      return error(400);
    }

    const service = new PlayerCountService();
    await service.start();
  });
/*
  disabling it since this endpoint features can interrupt log file compression
  should manually insert data into database
*/
/*
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
  })
  .put("/fetchPlayerCount/:id", async ({ error, params: { id }, headers }) => {
    if (
      process.env.NODE_ENV !== "development" ||
      !headers["X-ADMIN-KEY"] ||
      headers["X-ADMIN-KEY"] !== process.env.ADMIN_KEY
    ) {
      error(400);
    }
    const service = new PlayerCountService();
    const data = await service.getPlayerCount(id);
    if (!data.ok) {
      error(400);
      return;
    }
    await service.saveSingleCount(data);
  });
*/
