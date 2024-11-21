import { RecommendFilter } from "@/types";
import { db } from "@/db";
import { Prisma } from "@prisma/client";
import { calculateRatio } from "@/utils";

export class RecommendService {
  filter: Partial<RecommendFilter>;
  where: {
    query: Prisma.GameWhereInput;
    // filter: ((o: NonNullable<Awaited<ReturnType<typeof GameService.prototype.getGameInfo>>>) => boolean)[],
    // refine: (<R extends NonNullable<Awaited<ReturnType<typeof GameService.prototype.getGameInfo>>>, T extends keyof R>(o: R) => [T, R[T]])[]
  };

  constructor(filter: Partial<RecommendFilter>) {
    this.filter = filter;
    this.where = this.buildFilter();
  }

  async updateFilter(filter: Partial<RecommendFilter>) {
    this.filter = {
      ...this.filter,
      ...filter,
    };
    this.where = this.buildFilter();
  }

  buildFilter(): typeof RecommendService.prototype.where {
    const filterObj: Prisma.GameWhereInput = {};
    // const refineFunctions: typeof RecommendService.prototype.where["refine"] = [];
    // const filterFunctions: typeof RecommendService.prototype.where["filter"] = [];
    if (this.filter.player_min || this.filter.player_max) {
      filterObj.player_count = {
        some: {
          date: {
            gte: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
          },
          count: {
            gte: this.filter.player_min,
            lte: this.filter.player_max,
          },
        },
      };
    }
    if (this.filter.owner_min) {
      filterObj.owner_count = {
        gte: this.filter.owner_min,
      };
    }
    if (this.filter.positive_review_min || this.filter.positive_review_max) {
      filterObj.review_positive = {
        gte: this.filter.positive_review_min,
        lte: this.filter.positive_review_max,
      };
    }
    if (this.filter.review_ratio_min || this.filter.review_ratio_max) {
      filterObj.review_ratio = {
        gte: this.filter.review_ratio_min,
        lte: this.filter.review_ratio_max,
      };
    }
    if (this.filter.genre) {
      filterObj.genres = {
        some: {
          genre_name: this.filter.genre,
        },
      };
    }

    return {
      query: filterObj /* refine: refineFunctions, filter: filterFunctions */,
    };
  }

  async getAppList() {
    return db.game
      .findMany({
        where: this.where.query,
        select: {
          app_id: true,
        },
      })
      .then((r) => r.map((v) => v.app_id));
  }

  async selectRandom(appids: number[], exclude: number[]) {
    const filteredAppIds = appids.filter((appid) => !exclude.includes(appid));

    if (filteredAppIds.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * filteredAppIds.length);
    return filteredAppIds[randomIndex];
  }
}

interface IRefinedGameInfo {
  app_id: number;
  title: string;
  description: string;
  owner_min: number;
  release_date: string;
  player_count: {
    latest: {
      count: number;
      date: number;
    } | null;
    peak: {
      count: number;
      date: number;
    } | null;
  };
  thumbnail_src: string;
  review: {
    positive: number;
    negative: number;
    ratio: number;
  };
  genres: string[];
}

// TS 씨발련 ㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗㅗ
// 마소 개새끼들아 일좀해
// 아오 씨발 걍
type RequiredWithoutUndefined<T> = {
  [K in keyof T]-?: T[K] extends infer R | undefined ? R : never;
};

class GameService {
  constructor(private readonly gameId: number) {}

  async getGameInfo(): Promise<IRefinedGameInfo | null> {
    const game = await db.game.findUnique({
      where: {
        app_id: this.gameId,
      },
      include: {
        genres: true,
        player_count: true,
      },
    });

    if (!game) {
      return null;
    }

    const obj_player_count = game.player_count.reduce(
      (p, c) => {
        if (!p.latest || !p.peak) return { latest: undefined, peak: undefined };
        // TS 씨발련 ㅋㅋ
        const n = { ...(p as RequiredWithoutUndefined<typeof p>) };
        if (c.date.getTime() > n.latest.date.getTime()) {
          n.latest = c;
        }
        if (c.count > n.peak.count) {
          n.peak = c;
        }
        return n;
      },
      {
        latest: game.player_count.at(0),
        peak: game.player_count.at(0),
      },
    );

    return {
      app_id: game.app_id,
      title: game.title,
      description: game.description,
      review: {
        positive: game.review_positive,
        negative: game.review_negative,
        ratio:
          game.review_ratio ??
          calculateRatio(game.review_positive, game.review_negative),
      },
      release_date: game.release_date,
      thumbnail_src: game.thumbnail_src,
      owner_min: game.owner_count,
      player_count: {
        latest: obj_player_count.latest
          ? {
              count: obj_player_count.latest.count,
              date: obj_player_count.latest.date.getTime(),
            }
          : null,
        peak: obj_player_count.peak
          ? {
              count: obj_player_count.peak.count,
              date: obj_player_count.peak.date.getTime(),
            }
          : null,
      },
      genres: game.genres.map(({ genre_name }) => genre_name),
    };
  }
}
