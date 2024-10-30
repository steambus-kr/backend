import { Elysia } from "elysia";
import { cron as cronPlugin } from "@elysiajs/cron";
import { db } from "@/db";
import { logger } from "@/logger";

interface IGetAppListBody {
  response: {
    apps: Array<{
      appid: number;
      name: string;
      last_modified: number;
      price_change_number: number;
    }>;
    have_more_results: boolean;
    last_appid: number;
  };
}

type IAppDetailsBody<AppId extends number> = Record<
  AppId,
  {
    success: boolean;
    data: {
      name: string;
      short_description: string;
      genres: { id: `${number}`; description: string }[];
      screenshots: {
        id: number;
        path_thumbnail: string;
        path_full: string;
      }[];
      release_date: {
        coming_soom: boolean;
        date: string;
      };
    };
  }
>;

async function fetchGameInfo(context?: { continue_with?: number }) {
  if (!process.env.APP_STATE_ID) {
    logger.error("APP_STATE_ID not set");
    return;
  }
  const db_modified_since = (
    await db.state.findUnique({
      where: { id: parseInt(process.env.APP_STATE_ID) },
      select: { last_fetched_info: true },
    })
  )?.last_fetched_info;
  const modified_since = (db_modified_since ?? new Date()).getTime();
  logger.info(
    `Fetching game information since ${modified_since}, ${context?.continue_with ? "starting from first" : `continue from id ${context?.continue_with}`}`,
  );
  const GetAppList = await fetch(
    `https://api.steampowered.com/IStoreService/GetAppList/v1?key=${process.env.STEAM_KEY}&include_games=true&include_dlc=false&include_software=false&include_videos=false&include_hardware=false`,
  );
  if (!GetAppList.ok) {
    logger.error(
      `HTTP error while fetching game list: ${GetAppList.status} ${GetAppList.statusText}`,
    );
    return;
  }
  const GetAppList_data = ((await GetAppList.json()) as IGetAppListBody)
    .response;
  logger.info(
    `Got GetAppList response: ${GetAppList_data.apps.length} games, have_more_results=${GetAppList_data.have_more_results}, last_appid=${GetAppList_data.last_appid}`,
  );
  for (const app of GetAppList_data.apps) {
    const appDetails = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${app.appid}`,
    );
    if (!appDetails.ok) {
      logger.error(
        `HTTP error while fetching game ${app.appid} info: ${appDetails.status} ${appDetails.statusText}`,
      );
      return;
    }
    const appDetails_data = (
      (await appDetails.json()) as IAppDetailsBody<typeof app.appid>
    )[app.appid];
    if (!appDetails_data.success) {
      logger.error(
        `HTTP error while fetching game ${app.appid} info: success fail`,
      );
      return;
    }
    // save data
  }
}

export const cron = new Elysia()
  .use(logger.into())
  .use(
    cronPlugin({
      name: "fetchGameInfo",
      pattern: "0 0 * * * *",
      timezone: "Asia/Seoul",
      run() {},
    }),
  )
  .get("/cron/fetchGameInfo", ({ error }) => {
    if (process.env.NODE_ENV !== "development") {
      error(400);
    }
    fetchGameInfo();
  });
