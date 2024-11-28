import { fgiLoggerBuilder, pcLoggerBuilder, moLoggerBuilder } from "@/logger";
import { db } from "@/db";
import { JSDOM } from "jsdom";
import {
  IAppDetailsBody,
  IGetAppListBody,
  ISteamCMDBody,
  ISteamSpy,
  ISteamUserStats,
} from "@/types";
import { calculateRatio, formatMs, timeout } from "@/utils";
import { gzip } from "node-gzip";
import { unlink } from "node:fs/promises";

const APP_CHUNK_SIZE = 100;
const PC_CHUNK_SIZE = 200;
const APPDETAIL_MAX_RETRY = 2;
const APPDETAIL_TMR_DELAY = 600000; // 10min
const PC_TMR_DELAY = 30000; // 30s
const CHUNK_DELAY = 5000;
const PC_MAX_RETRY = 2;

const fetchHeader = {
  "Accepted-Language": "ko-KR,en-US;q=0.9,en;q=0.8",
};

export class MarkOutdatedService {
  logger: ReturnType<typeof moLoggerBuilder>[0];
  loggerPaths: string[];

  constructor() {
    const loggerBuilt = moLoggerBuilder();
    this.logger = loggerBuilt[0];
    this.loggerPaths = loggerBuilt.slice(1) as [string, string];
  }

  async getAppList(since: number | null): Promise<number[]> {
    this.logger.info(`Getting outdated app list since ${since}`);
    let continue_with: number | null = null;
    let haveMoreResults: boolean = true;
    const appIds: number[] = [];
    while (haveMoreResults) {
      const GetAppList_SearchParams = new URLSearchParams([
        ["key", process.env.STEAM_KEY!],
        ["include_games", "true"],
        ["include_dlc", "false"],
        ["include_software", "false"],
        ["include_videos", "false"],
        ["include_hardware", "false"],
      ]);
      if (since !== null)
        GetAppList_SearchParams.append(
          "if_modified_since",
          (since / 1000).toString(),
        );
      if (continue_with !== null)
        GetAppList_SearchParams.append("last_appid", continue_with.toString());
      // 스팀 API 개발자 대가리 존나 쎄게 치고싶다
      const GetAppList = await fetch(
        `https://api.steampowered.com/IStoreService/GetAppList/v1?${GetAppList_SearchParams.toString()}`,
      );
      if (!GetAppList.ok) {
        this.logger.error(
          `HTTP error while fetching game list: ${GetAppList.status} ${GetAppList.statusText}`,
        );
        return [];
      }
      let GetAppList_data: IGetAppListBody["response"];
      try {
        GetAppList_data = ((await GetAppList.json()) as IGetAppListBody)
          .response;
      } catch (e) {
        this.logger.error(`Error while parsing json from GetAppList: ${e}`);
        return [];
      }
      this.logger.info(
        `Got GetAppList response: ${GetAppList_data.apps.length} games, have_more_results=${GetAppList_data.have_more_results}, last_appid=${GetAppList_data.last_appid}`,
      );
      haveMoreResults = GetAppList_data.have_more_results;
      continue_with = GetAppList_data.last_appid;
      GetAppList_data.apps.forEach(({ appid }) => {
        appIds.push(appid);
      });
    }
    this.logger.info(`Got ${appIds.length} apps`);
    return appIds;
  }

  async markAppAsOutdated(appId: number) {
    await db.outdatedGame.upsert({
      where: {
        app_id: appId,
      },
      create: {
        app_id: appId,
      },
      update: {
        app_id: appId,
      },
    });
  }

  async start() {
    if (!process.env.APP_STATE_ID) {
      this.logger.error("APP_STATE_ID not set");
      throw new Error("APP_STATE_ID not set");
    }
    if (!process.env.STEAM_KEY) {
      this.logger.error("STEAM_KEY not set");
      throw new Error("STEAM_KEY not set");
    }
    const db_modified_since = (
      await db.state.findUnique({
        where: { id: parseInt(process.env.APP_STATE_ID) },
        select: { last_fetched_info: true },
      })
    )?.last_fetched_info;
    const modifiedSince = (
      db_modified_since ?? { getTime: () => null }
    ).getTime();

    const appIds = await this.getAppList(modifiedSince);
    await Promise.all(
      appIds.map(async (appId) => {
        await this.markAppAsOutdated(appId);
      }),
    );
    this.logger.info(`Marked ${appIds.length} apps as outdated`);

    try {
      await db.state.upsert({
        where: {
          id: parseInt(process.env.APP_STATE_ID),
        },
        create: {
          id: parseInt(process.env.APP_STATE_ID),
          last_fetched_info: new Date(),
        },
        update: {
          last_fetched_info: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `Unexpected error while saving last_fetched_info into DB: ${e}`,
      );
    }

    return this.loggerPaths;
  }
}

type FailureReason =
  | "region_lock"
  | "web_description_parse"
  | "web_header_image_parse"
  | "steamcmd_json"
  | "steamspy_json"
  | "base_info_build"
  | "upsert"
  | "retry_failed"
  | "appdetail_http"
  | "appdetail_success"
  | "appdetail_json";
export class FetchGameInfoService {
  /* debug purpose */
  totalApp: number;
  failureApp: Record<FailureReason, number>;
  successApp: number;
  logger: ReturnType<typeof fgiLoggerBuilder>[0];
  loggerPaths: string[];
  startTime: number;
  elapsedTime: number;

  /* loop variables */
  modifiedSince: number | null;
  chunks: number[][];
  chunkStat: {
    waitingChunks: number;
    finishedChunks: number;
    currentChunkIdx: number;
  };
  locks: Record<string, Promise<void>>;

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
      appdetail_http: 0,
      appdetail_success: 0,
      appdetail_json: 0,
    };
    this.successApp = 0;
    const loggerBuilt = fgiLoggerBuilder();
    this.logger = loggerBuilt[0];
    this.loggerPaths = loggerBuilt.slice(1) as [string, string];
    this.startTime = 0;
    this.elapsedTime = 0;

    this.modifiedSince = null;
    this.chunks = [];
    this.chunkStat = {
      finishedChunks: 0,
      waitingChunks: 0,
      currentChunkIdx: 0,
    };
    this.locks = {};
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
        new Date().getTime() - 1000 * 60 * 60 * 36
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

  async pauseAppdetail() {
    if (!this.locks.appdetail)
      this.locks.appdetail = new Promise((r) =>
        setTimeout(r, APPDETAIL_TMR_DELAY),
      );
    await this.locks.appdetail;
  }

  /**
   * Steam Front IP 밴 가능성 있음, 쓰지 말 것
   *
   * @deprecated
   */
  async parseWeb(
    appid: number,
    retryCount: number = 0,
  ): Promise<
    | { ok: true; data: Omit<IAppDetailsBody[number]["data"], "release_date"> }
    | { ok: false }
  > {
    if (retryCount > APPDETAIL_MAX_RETRY) {
      this.logger.error(
        `Maximum retry (${retryCount}/${APPDETAIL_MAX_RETRY}) reached, breaking chain`,
      );
      this.failureApp["retry_failed"]++;
      return { ok: false };
    }
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
          `Rate Limited Steam Store (${appid}) request, will be tried again`,
        );
        await this.pauseAppdetail();
        return await this.parseWeb(appid, retryCount + 1);
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
      return { ok: false };
    }
    if (!short_description) {
      this.logger.warn(
        `Steam Store (${appid}) request failed: short_description not found`,
      );
      this.failureApp["web_description_parse"]++;
      return { ok: false };
    }
    if (!header_image) {
      this.logger.warn(
        `Steam Store (${appid}) request failed: header_image not found`,
      );
      this.failureApp["web_header_image_parse"]++;
      return { ok: false };
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

  async getAppDetails(
    appid: number,
    retryCount: number = 0,
  ): Promise<
    { ok: true; data: IAppDetailsBody[number]["data"] } | { ok: false }
  > {
    if (retryCount > APPDETAIL_MAX_RETRY) {
      this.logger.error(
        `Maximum retry (${retryCount}/${APPDETAIL_MAX_RETRY}) reached, breaking chain`,
      );
      this.failureApp["retry_failed"]++;
      return { ok: false };
    }
    const data = await fetch(
      `http://store.steampowered.com/api/appdetails?appids=${appid}`,
    );
    if (!data.ok) {
      switch (data.status) {
        case 429:
        case 403:
          this.logger.warn(
            `HTTP error while fetching game ${appid} appDetails: ${data.status} ${data.statusText} (will be retried)`,
          );
          await this.pauseAppdetail();
          return await this.getAppDetails(appid, retryCount + 1);
        default:
          this.logger.error(
            `Unexpected HTTP error while fetching game ${appid} appDetails: ${data.status} ${data.statusText}`,
          );
          this.failureApp["appdetail_http"]++;
          return { ok: false };
      }
    }

    try {
      const json: IAppDetailsBody<{ id: number; description: string }> =
        await data.json();
      if (!json[appid].success) {
        this.logger.error(`Success is not true on ${appid} appDetails json`);
        this.failureApp["appdetail_success"]++;
        return {
          ok: false,
        };
      }
      return {
        ok: true,
        data: {
          ...json[appid].data,
          genres: json[appid].data.genres?.map?.(
            ({ description }) => description,
          ),
        },
      };
    } catch (e) {
      this.logger.error(`Error while parsing ${appid} appDetails json: ${e}`);
      this.failureApp["appdetail_json"]++;
      return { ok: false };
    }
  }

  async saveGameInfo(appid: number): Promise<{ ok: boolean }> {
    const appDetails_data = await this.getAppDetails(appid);
    if (!appDetails_data.ok) {
      return { ok: false };
    }
    const SteamCMD = await fetch(`https://api.steamcmd.net/v1/info/${appid}`);
    if (!SteamCMD.ok) {
      this.logger.warn(
        `HTTP error while fetching game ${appid} SteamCMD: ${SteamCMD.status} ${SteamCMD.statusText}`,
      );
      return { ok: false };
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
      return { ok: false };
    }

    const SteamSpy = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
    );
    if (!SteamSpy.ok) {
      this.logger.warn(
        `HTTP error while fetching game ${appid} SteamSpy: ${SteamSpy.status} ${SteamSpy.statusText}`,
      );
      return { ok: false };
    }
    let SteamSpy_data: ISteamSpy;
    try {
      SteamSpy_data = (await SteamSpy.json()) as ISteamSpy;
    } catch (e) {
      this.logger.warn(`Error while parsing json from SteamSpy: ${e}`);
      this.failureApp.steamspy_json++;
      return { ok: false };
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
        review_ratio: calculateRatio(
          SteamSpy_data.positive,
          SteamSpy_data.negative,
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
      return { ok: false };
    }
    try {
      await db.game.upsert({
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
      return { ok: false };
    }

    this.logger.info(`Successfully saved app ${appid}`);
    try {
      await db.outdatedGame.delete({
        where: {
          app_id: appid,
        },
      });
    } catch (e) {
      this.logger.warn(`App ${appid} data outdated data deletion failed: ${e}`);
    }
    this.successApp++;
    return { ok: true };
  }

  /**
   * 원래 여러 청크를 받아왔으나, MarkOutdated 서비스를 도입함으로서 1시간에 1번 1청크씩 처리합니다.
   * 따라서 이 함수는 1청크만 빌드합니다.
   */
  async buildAppChunk() {
    this.logger.info(
      `Building app chunks from app list${this.modifiedSince ? ` changed since ${this.modifiedSince}` : ""}`,
    );

    const appIds = (
      await db.outdatedGame.findMany({
        take: APP_CHUNK_SIZE,
      })
    ).map(({ app_id }) => app_id);

    for (const [idx, appid] of Object.entries(appIds)) {
      const chunkIdx = Math.floor(parseInt(idx) / APP_CHUNK_SIZE);
      if (!Array.isArray(this.chunks[chunkIdx])) {
        this.chunks[chunkIdx] = [];
      }
      this.chunks[chunkIdx].push(appid);
    }
    this.logger.info(
      `Built appListChunk: ${APP_CHUNK_SIZE} apps per chunk, ${this.chunks.length} chunk count`,
    );
  }

  async getSummary() {
    const elapsed = performance.now() - this.startTime;

    return {
      elapsed,
      elapsedHuman: formatMs(elapsed),
      chunks: this.chunkStat,
      processed: {
        total: this.totalApp,
        success: this.successApp,
        failure: this.failureApp,
      },
    };
  }

  async start() {
    this.startTime = performance.now();
    this.logger.info(
      `FetchGameInfo starting on ${new Date().toLocaleTimeString()}`,
    );

    await this.buildAppChunk();
    this.chunkStat.waitingChunks = this.chunks.length;

    for (const [idx, chunk] of Object.entries(this.chunks)) {
      this.logger.info(`Requesting chunk ${idx}`);
      this.chunkStat.waitingChunks--;
      this.chunkStat.currentChunkIdx = parseInt(idx);
      try {
        await Promise.all(
          chunk.map((appid) => {
            return this.saveGameInfo(appid);
          }),
        );
        await timeout(CHUNK_DELAY);
      } catch (e) {
        this.logger.error(`Unexpected error on chunk ${idx}: ${e}`);
      }
      this.chunkStat.finishedChunks++;
    }

    this.elapsedTime = performance.now() - this.startTime;
    this.logger.info(
      {
        total: this.totalApp,
        success: this.successApp,
        failure: this.failureApp,
      },
      `fetchGameInfo completed on ${new Date().toLocaleTimeString()} (took ${formatMs(this.elapsedTime)})`,
    );

    return { logShouldBeZipped: this.loggerPaths };
  }
}

interface IPlayerCountFailure {
  ok: false;
}

interface IPlayerCountSuccess {
  ok: true;
  appId: number;
  count: number;
}

type IPlayerCountResponse = IPlayerCountSuccess | IPlayerCountFailure;

export class PlayerCountService {
  retryApps: number[];
  totalApps: number;
  successApps: number;
  failureApps: Record<number, number>;
  logger: ReturnType<typeof pcLoggerBuilder>[0];
  loggerPaths: string[];

  startTime: number;
  elapsedTime: number;

  chunkStat: {
    finishedChunks: number;
    waitingChunks: number;
    currentChunkIndex: number;
  };
  waitSignal: Promise<void> | null;

  constructor() {
    this.retryApps = [];
    this.totalApps = 0;
    this.successApps = 0;
    this.failureApps = {};

    const loggerBuilt = pcLoggerBuilder();
    this.logger = loggerBuilt[0];
    this.loggerPaths = loggerBuilt.slice(1) as [string, string];
    this.waitSignal = null;

    this.startTime = 0;
    this.elapsedTime = 0;

    if (!process.env.APP_STATE_ID) {
      this.logger.error("APP_STATE_ID not set");
      throw new Error();
    }
    if (!process.env.STEAM_KEY) {
      this.logger.error("STEAM_KEY not set");
    }

    this.chunkStat = {
      finishedChunks: 0,
      waitingChunks: 0,
      currentChunkIndex: 0,
    };
  }

  async reportChunk() {
    this.logger.info(this.chunkStat, `Chunk status report`);
  }

  static async healthCheck() {
    const state = await db.state.findUnique({
      where: {
        id: parseInt(process.env.APP_STATE_ID!),
      },
    });
    if (!state) return { ok: false };

    if (
      !state.last_fetched_pc ||
      state.last_fetched_pc.getTime() < new Date().getTime() - 1000 * 60 * 60
    ) {
      return { ok: false };
    }

    return { ok: true };
  }

  async waitForRateLimit() {
    this.waitSignal = new Promise((r) => setTimeout(r, PC_TMR_DELAY)).then(
      () => {
        this.waitSignal = null;
      },
    );
  }

  async markAsRetry(appid: number) {
    if (!this.retryApps.includes(appid)) {
      this.retryApps.push(appid);
    }
  }

  async addFailure(status: number) {
    if (!(status in this.failureApps)) {
      this.failureApps[status] = 0;
    }
    this.failureApps[status]++;
  }

  async getPlayerCount(
    appid: number,
    retryCount: number = 0,
    retryBy?: number,
  ): Promise<IPlayerCountResponse> {
    if (retryCount > PC_MAX_RETRY) {
      this.logger.error(
        `Maximum retry (${retryCount}/${PC_MAX_RETRY}) reached, breaking chain`,
      );
      await this.addFailure(retryBy ?? -1);
      return {
        ok: false,
      };
    }
    while (this.waitSignal !== null) {
      await this.waitSignal;
    }
    const response = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
    );
    if (!response.ok) {
      switch (response.status) {
        case 404:
          this.logger.info(
            `404 responsed on app ${appid}, returning 0 instead.`,
          );
          return {
            ok: true,
            appId: appid,
            count: 0,
          };
        case 429:
        case 403:
          this.logger.error(
            { appid, status: response.status },
            `rate limited while getting response of app ${appid} by ${response.status}, will be retried`,
          );
          await this.waitForRateLimit();
          return await this.getPlayerCount(
            appid,
            retryCount + 1,
            response.status,
          );
        default:
          await this.addFailure(response.status);
          this.logger.error(
            { appid, status: response.status },
            `${response.status} failure while getting response of app ${appid}`,
          );
          return { ok: false };
      }
    }

    let responseJson;
    try {
      responseJson = (await response.json()) as ISteamUserStats;
    } catch (e) {
      this.logger.error(`Error while parsing json from app ${appid}`);
      await this.addFailure(1);
      return {
        ok: false,
      };
    }

    if (responseJson.response.result !== 1) {
      this.logger.error(`app ${appid} response's body marked as fail`);
      await this.addFailure(0);
      return {
        ok: false,
      };
    }

    return {
      ok: true,
      appId: appid,
      count: responseJson.response.player_count,
    };
  }

  async saveSingleCount<
    T extends Awaited<ReturnType<typeof this.getPlayerCount>>,
  >(data: T extends { ok: true } ? T : never) {
    await db.playerCount.create({
      data: {
        date: new Date(),
        app_id: data.appId,
        count: data.count,
      },
    });
  }

  async getMaxChunkIdx(): Promise<number> {
    const r = await db.game.count();
    return Math.floor(r / PC_CHUNK_SIZE);
  }

  async getChunk(idx: number): Promise<number[]> {
    return (
      await db.game.findMany({
        orderBy: {
          app_id: "asc",
        },
        skip: idx * PC_CHUNK_SIZE,
        take: PC_CHUNK_SIZE,
        select: {
          app_id: true,
        },
      })
    ).map(({ app_id }) => app_id);
  }

  async getSummary() {
    const elapsed = performance.now() - this.startTime;

    return {
      elapsed,
      elapsedHuman: formatMs(elapsed),
      chunk: this.chunkStat,
      processed: {
        total: this.totalApps,
        success: this.successApps,
        failure: this.failureApps,
      },
    };
  }

  async start() {
    const startDate = new Date();
    this.startTime = performance.now();
    const maxIdx = await this.getMaxChunkIdx();
    this.logger.info(
      `Starting PlayerCount fetch on ${startDate.toLocaleTimeString()}, total ${maxIdx + 1} chunks`,
    );
    this.chunkStat.waitingChunks = maxIdx + 1;
    const chunkReporter = setInterval(() => {
      this.reportChunk();
    }, 10000);
    for (let i = 0; i <= maxIdx; i++) {
      this.chunkStat.waitingChunks--;
      this.chunkStat.currentChunkIndex = i;
      const chunkAppIds = await this.getChunk(i);
      this.totalApps += chunkAppIds.length;
      const result = (
        await Promise.all(
          chunkAppIds.map((appId) => this.getPlayerCount(appId)),
        ).then((r) => {
          this.chunkStat.finishedChunks++;
          return r;
        })
      ).filter<IPlayerCountSuccess>((r): r is IPlayerCountSuccess => r.ok);
      this.logger.info(`Saving chunk ${i} (${result.length} successful apps)`);
      try {
        await db.playerCount.createMany({
          data: result.map(({ appId, count }) => {
            return {
              app_id: appId,
              count,
              date: startDate,
            };
          }),
        });
        this.logger.info(`Successfully saved chunk ${i}`);
        this.successApps += result.length;
      } catch (e) {
        this.logger.info(`Error while saving chunk ${i}: ${e}`);
      }
    }
    clearInterval(chunkReporter);

    try {
      await db.state.upsert({
        where: {
          id: parseInt(process.env.APP_STATE_ID!),
        },
        create: {
          id: parseInt(process.env.APP_STATE_ID!),
          last_fetched_pc: new Date(),
        },
        update: {
          last_fetched_pc: new Date(),
        },
      });
    } catch (e) {
      this.logger.info(`Error while saving state: ${e}`);
    }

    this.elapsedTime = performance.now() - this.startTime;
    this.logger.info(
      {
        total: this.totalApps,
        success: this.successApps,
        failure: this.failureApps,
      },
      `All playercount fetched on ${new Date().toLocaleTimeString()} (took ${formatMs(this.elapsedTime)})`,
    );
    await this.removeOutdated();
    return { logShouldBeZipped: this.loggerPaths };
  }

  async removeOutdated() {
    try {
      const deleteBefore24Query = {
        where: {
          date: {
            lt: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
          },
        },
      };

      const deleteCount = await db.playerCount.count(deleteBefore24Query);
      await db.playerCount.deleteMany(deleteBefore24Query);
      this.logger.info(`Deleted ${deleteCount} old records`);
    } catch (e) {
      this.logger.error(
        `Error occurred while deleting old playercount records: ${e}`,
      );
    }
  }
}

export class ZipperService {
  async zipFile(filePath: string): Promise<{ ok: boolean }> {
    try {
      const compressed = await gzip(await Bun.file(filePath).arrayBuffer());
      await Bun.write(filePath + `.gz`, compressed.buffer);
      await unlink(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  }
}
