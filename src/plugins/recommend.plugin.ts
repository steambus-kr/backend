import { Elysia, t } from "elysia";
import { logger } from "@/logger";
import { GameService, RecommendService } from "@/services/recommend.service";
import { RecommendFilterValidation } from "@/types";

export const recommend = new Elysia({ prefix: "/game" })
  .use(logger.into())
  .post(
    "/recommend",
    async ({ body, error, log }) => {
      let recommendService;
      try {
        recommendService = new RecommendService(body.filter);
      } catch (e) {
        log.fatal(`Error while initializing RecommendService: ${e}`);
        return error(500);
      }
      let appIds;
      try {
        appIds = await recommendService.getAppList();
      } catch (e) {
        log.fatal(`Error while getting app list: ${e}`);
        return error(500);
      }
      if (appIds.length === 0) {
        log.warn("No app found");
        return error(404);
      }
      let selectedAppId;
      try {
        selectedAppId = await recommendService.selectRandom(
          appIds,
          body.exclude,
        );
      } catch (e) {
        log.fatal(`Error while selecting random app: ${e}`);
        return error(500);
      }
      if (!selectedAppId) {
        log.warn("No app found");
        return error(404);
      }
      let gameService;
      try {
        gameService = new GameService(selectedAppId);
      } catch (e) {
        log.fatal(`Error while initializing GameService: ${e}`);
        return error(500);
      }
      try {
        const gameInfo = await gameService.getGameInfo();
        if (!gameInfo) {
          log.warn("No game info found");
          return error(500);
        }
        return gameInfo;
      } catch (e) {
        log.fatal(`Error while getting game info: ${e}`);
        return error(500);
      }
    },
    {
      body: t.Object({
        exclude: t.Array(t.Number()),
        filter: RecommendFilterValidation,
      }),
    },
  );
