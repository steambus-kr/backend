import { fgiLoggerBuilder } from "@/logger";
import { db } from "@/db";
import { JSDOM } from "jsdom";
import {
  IAppDetailsBody,
  IGetAppListBody,
  ISteamCMDBody,
  ISteamSpy,
} from "@/types";
import { formatMs, timeout } from "@/utils";

const APP_CHUNK_SIZE = 100;
const APPDETAIL_TMR_DELAY = 180000; // 3min
const CHUNK_DELAY = 5000;

const fetchHeader = {
  "Accepted-Language": "ko-KR,en-US;q=0.9,en;q=0.8",
};

type FailureReason =
  | "region_lock"
  | "web_description_parse"
  | "web_header_image_parse"
  | "steamcmd_json"
  | "steamspy_json"
  | "base_info_build"
  | "upsert"
  | "retry_failed";
export class FetchGameInfoService {
  /* debug purpose */
  totalApp: number;
  failureApp: Record<FailureReason, number>;
  successApp: number;
  logger: ReturnType<typeof fgiLoggerBuilder>;

  /* loop variables */
  modifiedSince: number | null;
  retryAppids: number[];
  haveMoreResults: boolean;
  lastAppid: number | null;
  iteration: number;

  constructor() {
    this.totalApp = 0;
    this.failureApp = {
      region_lock: 0,
      base_info_build: 0,
      steamcmd_json: 0,
      steamspy_json: 0,
      upsert: 0,
      web_description_parse: 0,
      web_header_image_parse: 0,
      retry_failed: 0,
    };
    this.successApp = 0;
    this.logger = fgiLoggerBuilder();
    this.modifiedSince = null;
    this.retryAppids = [];
    this.haveMoreResults = true;
    this.lastAppid = null;
    this.iteration = 0;
  }

  static async healthCheck() {
    const state = await db.state.findUnique({
      where: {
        id: parseInt(process.env.APP_STATE_ID!),
      },
    });
    if (!state) {
      return { ok: false };
    }

    if (
      !state.last_fetched_info ||
      state.last_fetched_info.getTime() <
        new Date().getTime() - 1000 * 60 * 60 * 24
    ) {
      return { ok: false };
    }

    return { ok: true };
  }

  async init() {
    if (!process.env.APP_STATE_ID) {
      this.logger.error("APP_STATE_ID not set");
      throw new Error();
    }
    if (!process.env.STEAM_KEY) {
      this.logger.error("STEAM_KEY not set");
    }

    const db_modified_since = (
      await db.state.findUnique({
        where: { id: parseInt(process.env.APP_STATE_ID) },
        select: { last_fetched_info: true },
      })
    )?.last_fetched_info;
    this.modifiedSince = (
      db_modified_since ?? { getTime: () => null }
    ).getTime();
  }

  async parseOwnerCount(owners: string): Promise<number> {
    // parse minimum ({owner}~)
    return parseInt(owners.split(" .. ")[0].split(",").join(""));
  }

  async markAsRetry(appid: number) {
    if (!this.retryAppids.includes(appid)) {
      this.retryAppids.push(appid);
    }
  }

  async parseWeb(
    appid: number,
  ): Promise<
    | { ok: true; data: Omit<IAppDetailsBody[number]["data"], "release_date"> }
    | { ok: false; willBeRetried: boolean }
  > {
    const response = await fetch(
      `https://store.steampowered.com/app/${appid}`,
      {
        headers: {
          ...fetchHeader,
          Cookie:
            "wants_mature_content=1; birthtime=946652401; lastagecheckage=1-January-2000",
        },
      },
    );
    if (
      !response.ok ||
      response.headers.get("Content-Type") !== "text/html; charset=UTF-8"
    ) {
      this.logger.warn(
        `Steam Store (${appid}) request failed: ${response.status} ${response.statusText}`,
      );
      if (response.status === 403) {
        this.logger.warn(
          `Rate Limited Steam Store (${appid}) request, will be tried again later`,
        );
        await this.markAsRetry(appid);
        return { ok: false, willBeRetried: true };
      }
    }
    const { document } = new JSDOM(await response.text()).window;
    const name =
      document.querySelector<HTMLDivElement>(`div#appHubAppName`)?.textContent;
    const short_description = document.querySelector<HTMLMetaElement>(
      `meta[name="Description"]`,
    );
    const header_image = document.querySelector<HTMLMetaElement>(
      `meta[property="og:image"]`,
    );
    const genre_anchors = Array.from(
      document
        .querySelectorAll<HTMLAnchorElement>(
          `div#genresAndManufacturer > span > a[href^="https://store.steampowered.com/genre"]`,
        )
        .values(),
    );
    if (!name) {
      this.logger.warn(
        `Steam Store (${appid}) request failed: name not found (maybe region lock?)`,
      );
      this.failureApp["region_lock"]++;
      return { ok: false, willBeRetried: false };
    }
    if (!short_description) {
      this.logger.warn(
        `Steam Store (${appid}) request failed: short_description not found`,
      );
      this.failureApp["web_description_parse"]++;
      return { ok: false, willBeRetried: false };
    }
    if (!header_image) {
      this.logger.warn(
        `Steam Store (${appid}) request failed: header_image not found`,
      );
      this.failureApp["web_header_image_parse"]++;
      return { ok: false, willBeRetried: false };
    }
    if (genre_anchors.length === 0) {
      this.logger.debug(
        `Steam Store (${appid}) genre parse failed: no genre found`,
      );
    }

    return {
      ok: true,
      data: {
        name,
        short_description: short_description.content,
        header_image: header_image.content,
        genres: genre_anchors.reduce<string[]>(
          (p, a) => (a.textContent ? [...p, a.textContent] : p),
          [],
        ),
      },
    };
  }

  async saveGameInfo(
    appid: number,
  ): Promise<{ ok: boolean; willBeRetried: boolean }> {
    const appDetails_data = await this.parseWeb(appid);
    if (!appDetails_data.ok) {
      return { ok: false, willBeRetried: appDetails_data.willBeRetried };
    }
    const SteamCMD = await fetch(`https://api.steamcmd.net/v1/info/${appid}`);
    if (!SteamCMD.ok) {
      this.logger.warn(
        `HTTP error while fetching game ${appid} SteamCMD: ${SteamCMD.status} ${SteamCMD.statusText} (will be retried)`,
      );
      await this.markAsRetry(appid);
      return { ok: false, willBeRetried: true };
    }
    let SteamCMD_data: ISteamCMDBody;
    let SteamCMD_releaseDate: `${number}` | undefined;
    try {
      SteamCMD_data = (await SteamCMD.json()) as ISteamCMDBody;
      SteamCMD_releaseDate =
        SteamCMD_data?.data?.[appid]?.common?.steam_release_date;
    } catch (e) {
      this.logger.warn(`Error while parsing json from SteamCMD: ${e}`);
      this.failureApp.steamcmd_json++;
      return { ok: false, willBeRetried: false };
    }

    const SteamSpy = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
    );
    if (!SteamSpy.ok) {
      this.logger.warn(
        `HTTP error while fetching game ${appid} SteamSpy: ${SteamSpy.status} ${SteamSpy.statusText} (will be retried)`,
      );
      await this.markAsRetry(appid);
      return { ok: false, willBeRetried: true };
    }
    let SteamSpy_data: ISteamSpy;
    try {
      SteamSpy_data = (await SteamSpy.json()) as ISteamSpy;
    } catch (e) {
      this.logger.warn(`Error while parsing json from SteamSpy: ${e}`);
      this.failureApp.steamspy_json++;
      return { ok: false, willBeRetried: false };
    }

    let baseInfo;
    try {
      baseInfo = {
        title: appDetails_data.data.name,
        description: appDetails_data.data.short_description,
        release_date: SteamCMD_releaseDate
          ? new Intl.DateTimeFormat("ko", { dateStyle: "medium" }).format(
              new Date(parseInt(SteamCMD_releaseDate) * 1000),
            )
          : "-",
        thumbnail_src: appDetails_data.data.header_image,
        review_negative: SteamSpy_data.negative,
        review_positive: SteamSpy_data.positive,
        // review_ratio exception case
        // 1. 0 / 0 (positive=0, negative=0) should be 0, result to NaN
        review_ratio:
          SteamSpy_data.positive === 0
            ? 0
            : Math.min(
                1,
                SteamSpy_data.positive /
                  (SteamSpy_data.positive + SteamSpy_data.negative),
              ),
        owner_count: await this.parseOwnerCount(SteamSpy_data.owners),
        genres: appDetails_data.data.genres
          ? {
              connectOrCreate: appDetails_data.data.genres.map(
                (genre_name) => ({
                  where: { genre_name },
                  create: { genre_name },
                }),
              ),
            }
          : undefined,
      };
    } catch (e) {
      this.logger.error(
        `Failed to build base information of app ${appid}: ${e}`,
      );
      this.failureApp.base_info_build++;
      return { ok: false, willBeRetried: false };
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
        },
        update: {
          ...baseInfo,
        },
      });
    } catch (e) {
      this.logger.error(`App ${appid} data upserting failed: ${e}`);
      this.failureApp.upsert++;
      return { ok: false, willBeRetried: false };
    }

    this.logger.info(upserted, `Successfully saved app ${appid}`);
    this.successApp++;
    return { ok: true, willBeRetried: false };
  }

  async fetchGameInfo(continue_with: number | null) {
    this.logger.info(
      `Fetching game information${this.modifiedSince ? ` since ${this.modifiedSince}` : ""}, ${continue_with ? `continue from id ${continue_with}` : "starting from first"}`,
    );

    const GetAppList_SearchParams = new URLSearchParams([
      ["key", process.env.STEAM_KEY!],
      ["include_games", "true"],
      ["include_dlc", "false"],
      ["include_software", "false"],
      ["include_videos", "false"],
      ["include_hardware", "false"],
    ]);
    if (this.modifiedSince !== null)
      GetAppList_SearchParams.append(
        "if_modified_since",
        (this.modifiedSince / 1000).toString(),
      );
    if (continue_with)
      GetAppList_SearchParams.append("last_appid", continue_with.toString());
    const GetAppList = await fetch(
      `https://api.steampowered.com/IStoreService/GetAppList/v1?${GetAppList_SearchParams.toString()}`,
    );
    if (!GetAppList.ok) {
      this.logger.error(
        `HTTP error while fetching game list: ${GetAppList.status} ${GetAppList.statusText}`,
      );
      return;
    }
    let GetAppList_data: IGetAppListBody["response"];
    try {
      GetAppList_data = ((await GetAppList.json()) as IGetAppListBody).response;
    } catch (e) {
      this.logger.error(`Error while parsing json from GetAppList: ${e}`);
      return null;
    }
    this.logger.info(
      `Got GetAppList response: ${GetAppList_data.apps.length} games, have_more_results=${GetAppList_data.have_more_results}, last_appid=${GetAppList_data.last_appid}`,
    );
    this.totalApp += GetAppList_data.apps.length;
    this.haveMoreResults = GetAppList_data.have_more_results;
    this.lastAppid = GetAppList_data.last_appid;
    const appListChunk: number[][] = [];
    for (const [idx, { appid }] of Object.entries(GetAppList_data.apps)) {
      const chunkIdx = Math.floor(parseInt(idx) / APP_CHUNK_SIZE);
      if (!Array.isArray(appListChunk[chunkIdx])) {
        appListChunk[chunkIdx] = [];
      }
      appListChunk[chunkIdx].push(appid);
    }
    this.logger.info(
      `Built appListChunk: ${APP_CHUNK_SIZE} apps per chunk, ${appListChunk.length} chunk count`,
    );

    for (const [idx, chunk] of Object.entries(appListChunk)) {
      this.logger.info(`Requesting chunk ${idx}`);
      try {
        const response = await Promise.all(
          chunk.map((appid) => {
            return this.saveGameInfo(appid);
          }),
        );
        const willBeRetrieds = response.filter(
          ({ ok, willBeRetried }) => !ok && willBeRetried,
        );
        if (willBeRetrieds.length > 0) {
          this.logger.warn(
            `Delaying ${Math.round(APPDETAIL_TMR_DELAY / 1000)}s after chunk ${idx} due to ${Math.round(willBeRetrieds.length / APP_CHUNK_SIZE) * 100}% (${willBeRetrieds.length} / ${APP_CHUNK_SIZE}) failed requests, will be continued at ${new Intl.DateTimeFormat(["ko"], { timeStyle: "medium", hour12: false }).format(new Date(new Date().getTime() + APPDETAIL_TMR_DELAY))}.`,
          );
          await timeout(APPDETAIL_TMR_DELAY);
        } else {
          await timeout(CHUNK_DELAY);
        }
      } catch (e) {
        this.logger.error(`Unexpected error on chunk ${idx}: ${e}`);
      }
    }
  }

  async start() {
    const startTime = performance.now();

    while (this.haveMoreResults) {
      this.iteration++;
      this.logger.info(`Calling fetchGameInfo iteration ${this.iteration}`);
      const fetchResult = await this.fetchGameInfo(this.lastAppid);
      if (!fetchResult) {
        this.logger.info(`Breaking fetchGameInfo iteration`);
        break;
      }
      /* now handled in fetchGameInfo
      last_appid = fetchResult.last_appid;
      have_more_results = fetchResult.have_more_results;
      failed_appids = [...failed_appids, ...fetchResult.failed_appids];
      */
    }

    // retry step
    if (this.retryAppids.length > 0) {
      this.logger.info(`Starting retry for ${this.retryAppids.length} apps`);
      let retryIteration = 0;
      const maxRetry = 20;
      const retryDelay = 180; // in second
      // ideally maximum 1800s (30min)
      while (this.retryAppids.length > 0) {
        if (retryIteration >= maxRetry) {
          this.logger.error(
            `Breaking, reached maximum retry(${retryIteration}/${maxRetry}). ${this.retryAppids.length} items not saved.`,
          );
          this.failureApp.retry_failed = this.retryAppids.length;
          break;
        }
        retryIteration++;
        this.logger.info(`Retry iteration ${retryIteration}`);
        let successApps: number[] = [];
        for (const appid of this.retryAppids) {
          const { ok } = await this.saveGameInfo(appid);
          if (ok) successApps.push(appid);
        }
        this.retryAppids = this.retryAppids.filter(
          (id) => !successApps.includes(id),
        );
        await timeout(retryDelay * 1000);
      }
    } else {
      this.logger.info(`Skipping retry since no app marked as retryable`);
    }

    try {
      // skipping check of APP_STATE_ID, it will be checked in init
      await db.state.upsert({
        where: {
          id: parseInt(process.env.APP_STATE_ID!),
        },
        create: {
          id: parseInt(process.env.APP_STATE_ID!),
          last_fetched_info: new Date(),
        },
        update: {
          last_fetched_info: new Date(),
        },
      });
    } catch (e) {
      this.logger.error(
        `Unexpected error while saving last_fetched_info into DB: ${e}`,
      );
    }

    const elapsedTime = performance.now() - startTime;
    this.logger.info(
      {
        total: this.totalApp,
        success: this.successApp,
        failure: this.failureApp,
      },
      `fetchGameInfo completed (took ${formatMs(elapsedTime)})`,
    );
  }
}
