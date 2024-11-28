import { Elysia, t } from "elysia";
import { cron as cronPlugin } from "@elysiajs/cron";
import {
  FetchGameInfoService,
  PlayerCountService,
  ZipperService,
} from "@/services/cron.service";
import { logger } from "@/logger";
import { formatMs } from "@/utils";

const formatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "medium",
});

let fetchGameInfoService: FetchGameInfoService | null = null;
let playerCountService: PlayerCountService | null = null;

interface IEachCronStatus {
  skipCount: number;
  lastSkip: boolean;
}
type CronNames = "fetchGameInfo" | "fetchPlayerCount";
const cronStatus: Record<CronNames, IEachCronStatus> = {
  fetchGameInfo: {
    skipCount: 0,
    lastSkip: false,
  },
  fetchPlayerCount: {
    skipCount: 0,
    lastSkip: false,
  },
};

export const cron = new Elysia({ prefix: "/cron" })
  .use(logger.into())
  .use(
    cronPlugin({
      name: "fetchGameInfo",
      pattern: "0 15 0 * * 5", // fetchPlayerCount와의 동시 실행으로 인한 rate limit을 피하기 위해 살짝 비틈
      timezone: "Asia/Seoul",
      run: async () => {
        if (
          process.env.DISABLE_FETCH_GAME_INFO &&
          process.env.DISABLE_FETCH_GAME_INFO !== "false"
        ) {
          return;
        }
        if (fetchGameInfoService !== null) {
          logger.warn(
            `Failed to start fetchGameInfo because of existing instance.`,
          );
          cronStatus.fetchGameInfo.lastSkip = true;
          cronStatus.fetchGameInfo.skipCount++;
          return;
        }
        cronStatus.fetchGameInfo.lastSkip = false;
        const startTime = new Date();
        logger.info(
          `Starting fetchGameInfo cron on ${formatter.format(startTime)}`,
        );
        try {
          fetchGameInfoService = new FetchGameInfoService();
          await fetchGameInfoService.init();
        } catch (e) {
          logger.fatal(`Error while initializing FetchGameInfoService: ${e}`);
          fetchGameInfoService = null;
          return;
        }
        const zipper = new ZipperService();
        let fileWillBeZipped: string[];
        try {
          const result = await fetchGameInfoService.start();
          fileWillBeZipped = [...result.logShouldBeZipped];
          logger.info(
            {
              total: fetchGameInfoService.totalApp,
              success: fetchGameInfoService.successApp,
              failure: fetchGameInfoService.failureApp,
            },
            `fetchGameInfo cron started at ${formatter.format(startTime)} ended at ${formatter.format(new Date())}, took ${formatMs(fetchGameInfoService.elapsedTime)}.`,
          );
        } catch (e) {
          logger.error(
            `Unexpected error while running FetchGameinfoService: ${e}`,
          );
          fileWillBeZipped = [...fetchGameInfoService.loggerPaths];
        } finally {
          fetchGameInfoService = null;
        }
        await Promise.all(
          fileWillBeZipped.map(async (filePath) => {
            const r = await zipper.zipFile(filePath);
            if (!r.ok) {
              logger.warn(
                `file not zipped due to unexpected error: ${filePath}`,
              );
            }
            return r;
          }),
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
        if (
          process.env.DISABLE_FETCH_PLAYER_COUNT &&
          process.env.DISABLE_FETCH_PLAYER_COUNT !== "false"
        ) {
          return;
        }
        if (playerCountService !== null) {
          logger.warn(
            `Failed to start playerCountService because of existing instance.`,
          );
          cronStatus.fetchPlayerCount.lastSkip = true;
          cronStatus.fetchPlayerCount.skipCount++;
          return;
        }
        cronStatus.fetchPlayerCount.lastSkip = false;
        const startTime = new Date();
        logger.info(
          `Starting fetchPlayerCount cron on ${formatter.format(startTime)}`,
        );
        try {
          playerCountService = new PlayerCountService();
        } catch (e) {
          logger.fatal(`Error while initializing PlayerCountService: ${e}`);
          playerCountService = null;
          return;
        }
        const zipper = new ZipperService();
        let fileWillBeZipped: string[] = [];
        try {
          const result = await playerCountService.start();
          fileWillBeZipped = [...result.logShouldBeZipped];
          logger.info(
            {
              total: playerCountService.totalApps,
              success: playerCountService.successApps,
              failure: playerCountService.failureApps,
            },
            `fetchPlayerCount cron started at ${formatter.format(startTime)} ended at ${formatter.format(new Date())}, took ${formatMs(playerCountService.elapsedTime)}.`,
          );
        } catch (e) {
          logger.error(
            `Unexpected error while running PlayerCountService: ${e}`,
          );
          fileWillBeZipped = [...playerCountService.loggerPaths];
        } finally {
          playerCountService = null;
        }
        await Promise.all(
          fileWillBeZipped.map(async (filePath) => {
            const r = await zipper.zipFile(filePath);
            if (!r.ok) {
              logger.warn(
                `file not zipped due to unexpected error: ${filePath}`,
              );
            }
            return r;
          }),
        );
      },
    }),
  )
  .get("/status", async () => {
    return cronStatus;
  })
  .get("/health/fgi", async ({ error }) => {
    const { ok } = await FetchGameInfoService.healthCheck();
    if (!ok) return error(512);
    return {
      ok: true,
      running:
        fetchGameInfoService === null
          ? false
          : await fetchGameInfoService.getSummary(),
    };
  })
  .get("/health/pc", async ({ error }) => {
    const { ok } = await PlayerCountService.healthCheck();
    if (!ok) return error(512);
    return {
      ok: true,
      running:
        playerCountService === null
          ? false
          : await playerCountService.getSummary(),
    };
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
