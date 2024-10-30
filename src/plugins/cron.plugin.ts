import { Elysia } from "elysia";
import { cron as cronPlugin } from "@elysiajs/cron";
import { db } from "@/db";
import { logger } from "@/logger";

const APP_CHUNK_SIZE = 50;
const APPDETAIL_TMR_DELAY = 180000; // 3min

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
      genres?: { id: `${number}`; description: string }[];
      header_image: string;
      release_date: {
        coming_soom: boolean;
        date: string;
      };
    };
  }
>;

interface ISteamSpy {
  appid: number;
  name: string;
  positive: number;
  negative: number;
  owners: string;
}

const fgiLogger = logger.child({ fetchGameInfo: true });

const fetchHeader = {
  "Accepted-Language": "ko-KR,en-US;q=0.9,en;q=0.8",
};

async function parseOwnerCount(owners: string): Promise<number> {
  // parse minimum ({owner}~)
  return parseInt(owners.split(" .. ")[0].split(",").join(""));
}

async function saveGameInfo(
  appid: number,
): Promise<{ retryable: boolean; appid: number }> {
  const appDetails = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}`,
  );
  if (!appDetails.ok) {
    if (appDetails.status === 429 || appDetails.status === 403) {
      fgiLogger.debug(
        {
          body: appDetails.text,
          header: Object.fromEntries(appDetails.headers.entries()),
        },
        `Rate limited data of app ${appid}`,
      );
      fgiLogger.warn(
        `Rate limited while fetching game ${appid} info: marked it as retryable app, will be retried`,
      );
      return { retryable: true, appid };
    } else {
      fgiLogger.warn(
        `HTTP error while fetching game ${appid} info: ${appDetails.status} ${appDetails.statusText}`,
      );
    }
    return { retryable: false, appid };
  }
  let appDetails_data: IAppDetailsBody<typeof appid>[typeof appid];
  try {
    appDetails_data = (
      (await appDetails.json()) as IAppDetailsBody<typeof appid>
    )[appid];
  } catch (e) {
    fgiLogger.warn(`Error while parsing json from appDetails: ${e}`);
    return { retryable: false, appid };
  }
  if (!appDetails_data.success) {
    fgiLogger.warn(
      `HTTP error while fetching game ${appid} info: success fail`,
    );
    return { retryable: false, appid };
  }

  const SteamSpy = await fetch(
    `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
  );
  if (!SteamSpy.ok) {
    fgiLogger.warn(
      `HTTP error while fetching game ${appid} SteamSpy: ${appDetails.status} ${appDetails.statusText} (will be retried)`,
    );
    return { retryable: true, appid };
  }
  let SteamSpy_data: ISteamSpy;
  try {
    SteamSpy_data = (await SteamSpy.json()) as ISteamSpy;
  } catch (e) {
    fgiLogger.warn(`Error while parsing json from SteamSpy: ${e}`);
    return { retryable: false, appid };
  }

  try {
    if (appDetails_data.data.genres) {
      await Promise.all(
        appDetails_data.data.genres.map(({ id, description }) => {
          const genre_id = parseInt(id);
          fgiLogger.debug(
            `Upserting genre "${description}" ${id} (parseInt -> ${genre_id})`,
          );
          return db.genre.upsert({
            where: {
              genre_id,
            },
            create: {
              genre_id,
              genre_name: description,
            },
            update: {
              genre_name: description,
            },
          });
        }),
      );
    }
  } catch (e) {
    fgiLogger.error(`Genre upserting failed for app ${appid}: ${e}`);
    return { retryable: false, appid };
  }
  let baseInfo;
  try {
    baseInfo = {
      title: appDetails_data.data.name,
      description: appDetails_data.data.short_description,
      release_date: appDetails_data.data.release_date.date,
      thumbnail_src: appDetails_data.data.header_image,
      review_negative: SteamSpy_data.negative,
      review_positive: SteamSpy_data.positive,
      owner_count: await parseOwnerCount(SteamSpy_data.owners),
    };
  } catch (e) {
    fgiLogger.error(`Failed to build base information of app ${appid}: ${e}`);
    return { retryable: false, appid };
  }
  let upserted; // too complicated to write type
  try {
    upserted = await db.game.upsert({
      where: {
        app_id: appid,
      },
      create: {
        app_id: appid,
        ...baseInfo,
        genre: {
          create: appDetails_data.data.genres
            ? appDetails_data.data.genres.map(({ id, description }) => {
                const genre_id = parseInt(id);
                return {
                  genre_id,
                  genre_name: description,
                };
              })
            : undefined,
        },
      },
      update: {
        ...baseInfo,
        genre: appDetails_data.data.genres
          ? {
              connectOrCreate: appDetails_data.data.genres.map(
                ({ id, description }) => {
                  const genre_id = parseInt(id);
                  return {
                    where: { genre_id },
                    create: { genre_id, genre_name: description },
                  };
                },
              ),
            }
          : undefined,
      },
    });
  } catch (e) {
    fgiLogger.error(`App ${appid} data upserting failed: ${e}`);
    return { retryable: false, appid };
  }

  fgiLogger.info(`Successfully saved app ${appid}`);
  fgiLogger.debug(upserted, `Upserted app ${appid}`);

  return { retryable: false, appid };
}

async function fetchGameInfo(continue_with?: number): Promise<{
  failed_appids: number[];
  last_appid: number;
  have_more_results: boolean;
} | null> {
  if (!process.env.APP_STATE_ID) {
    fgiLogger.error("APP_STATE_ID not set");
    return null;
  }
  if (!process.env.STEAM_KEY) {
    fgiLogger.error("STEAM_KEY not set");
    return null;
  }

  const db_modified_since = (
    await db.state.findUnique({
      where: { id: parseInt(process.env.APP_STATE_ID) },
      select: { last_fetched_info: true },
    })
  )?.last_fetched_info;
  const modified_since = (
    db_modified_since ?? { getTime: () => null }
  ).getTime();
  fgiLogger.info(
    `Fetching game information since ${modified_since}, ${continue_with ? `continue from id ${continue_with}` : "starting from first"}`,
  );

  const GetAppList_SearchParams = new URLSearchParams([
    ["key", process.env.STEAM_KEY],
    ["include_games", "true"],
    ["include_dlc", "false"],
    ["include_software", "false"],
    ["include_videos", "false"],
    ["include_hardware", "false"],
  ]);
  if (modified_since !== null)
    GetAppList_SearchParams.append(
      "if_modified_since",
      (modified_since / 1000).toString(),
    );
  if (continue_with)
    GetAppList_SearchParams.append("last_appid", continue_with.toString());
  const GetAppList = await fetch(
    `https://api.steampowered.com/IStoreService/GetAppList/v1?${GetAppList_SearchParams.toString()}`,
  );
  if (!GetAppList.ok) {
    fgiLogger.error(
      `HTTP error while fetching game list: ${GetAppList.status} ${GetAppList.statusText}`,
    );
    return null;
  }
  let GetAppList_data: IGetAppListBody["response"];
  try {
    GetAppList_data = ((await GetAppList.json()) as IGetAppListBody).response;
  } catch (e) {
    fgiLogger.error(`Error while parsing json from GetAppList: ${e}`);
    return null;
  }
  fgiLogger.info(
    `Got GetAppList response: ${GetAppList_data.apps.length} games, have_more_results=${GetAppList_data.have_more_results}, last_appid=${GetAppList_data.last_appid}`,
  );
  const appListChunk: number[][] = [];
  for (const [idx, { appid }] of Object.entries(GetAppList_data.apps)) {
    const chunkIdx = Math.floor(parseInt(idx) / APP_CHUNK_SIZE);
    if (!Array.isArray(appListChunk[chunkIdx])) {
      appListChunk[chunkIdx] = [];
    }
    appListChunk[chunkIdx].push(appid);
  }
  fgiLogger.info(
    `Built appListChunk: ${APP_CHUNK_SIZE} apps per chunk, ${appListChunk.length} chunk count`,
  );

  let failed_appids: number[] = [];
  for (const [idx, chunk] of Object.entries(appListChunk)) {
    fgiLogger.info(`Requesting chunk ${idx}`);
    try {
      const response = await Promise.all(
        chunk.map((appid) => {
          return saveGameInfo(appid);
        }),
      );
      const chunkFailedAppIds = response
        .filter(({ retryable }) => !!retryable)
        .map(({ appid }) => appid);
      if (chunkFailedAppIds.length > 0) {
        failed_appids = [...failed_appids, ...chunkFailedAppIds];
        fgiLogger.warn(
          `Delaying ${Math.round(APPDETAIL_TMR_DELAY / 1000)}s after chunk ${idx} due to failed requests, will be continued at ${new Intl.DateTimeFormat(["ko"], { timeStyle: "medium", hour12: false }).format(new Date(new Date().getTime() + APPDETAIL_TMR_DELAY))}`,
        );
        await timeout(APPDETAIL_TMR_DELAY);
      }
    } catch (e) {
      fgiLogger.error(`Unexpected error on chunk ${idx}: ${e}`);
    }
  }

  return {
    failed_appids: failed_appids,
    have_more_results: GetAppList_data.have_more_results,
    last_appid: GetAppList_data.last_appid,
  };
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    fgiLogger.debug(`Waiting for ${ms}ms`);
    const r = () => {
      fgiLogger.debug(`Waited for ${ms}ms`);
    };
    setTimeout(resolve, ms);
  });
}

async function fetchGameInfoLooper() {
  let failed_appids: number[] = [];
  let have_more_results = true;
  let last_appid = undefined;
  let iteration = 0;

  const startTime = performance.now();

  while (have_more_results) {
    iteration++;
    fgiLogger.info(`Calling fetchGameInfo iteration ${iteration}`);
    const fetchResult = await fetchGameInfo(last_appid);
    if (!fetchResult) {
      fgiLogger.info(`Breaking fetchGameInfo iteration`);
      break;
    }
    last_appid = fetchResult.last_appid;
    have_more_results = fetchResult.have_more_results;
    failed_appids = [...failed_appids, ...fetchResult.failed_appids];
  }

  // retry step
  fgiLogger.info(`Starting retry`);
  let retryIteration = 0;
  const maxRetry = 10;
  const retryDelay = 180; // in second
  // ideally maximum 1800s (30min)
  while (failed_appids.length > 0) {
    if (retryIteration >= maxRetry) {
      fgiLogger.error(
        `Breaking, reached maximum retry(${retryIteration}/${maxRetry}). ${failed_appids.length} items not saved.`,
      );
      break;
    }
    retryIteration++;
    fgiLogger.info(`Retry iteration ${retryIteration}`);
    let nonRetryables: number[] = [];
    for (const appid of failed_appids) {
      const { retryable } = await saveGameInfo(appid);
      if (!retryable) nonRetryables.push(appid);
    }
    failed_appids = failed_appids.filter((id) => !nonRetryables.includes(id));
    await timeout(retryDelay * 1000);
  }

  try {
    if (process.env.APP_STATE_ID) {
      await db.state.update({
        where: {
          id: parseInt(process.env.APP_STATE_ID),
        },
        data: {
          last_fetched_info: new Date(),
        },
      });
    }
  } catch (e) {
    fgiLogger.info(
      `Unexpected error while saving last_fetched_info into DB: ${e}`,
    );
  }

  const elapsedTime = performance.now() - startTime;
  if (failed_appids.length > 0) {
    fgiLogger.info(
      `fetchGameInfo completed (took ${formatMs(elapsedTime)}), some games are not saved due to error.`,
    );
  } else {
    fgiLogger.info(
      `fetchGameInfo completed, all games are successfully saved.`,
    );
  }
}

function formatMs(ms: number): string {
  const str = [];
  const second = 1000;
  const minute = second * 60;
  const hour = minute * 60;
  const day = hour * 24;
  const asDay = ms / day;
  const asHour = (ms % day) / hour;
  const asMinute = (ms % hour) / minute;
  const asSecond = (ms % minute) / second;
  if (asDay >= 1) {
    str.push(`${Math.floor(asDay)}d`);
  }
  if (asHour >= 1) {
    str.push(`${Math.floor(asHour)}h`);
  }
  if (asMinute >= 1) {
    str.push(`${Math.floor(asMinute)}m`);
  }
  str.push(`${asSecond}s`);
  return str.join(" ");
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
    fetchGameInfoLooper();
  });
