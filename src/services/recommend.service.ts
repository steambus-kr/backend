import {RecommendFilter} from "@/types";
import {db} from "@/db";
import {Prisma} from "@prisma/client";

export class RecommendService {
  filter: Partial<RecommendFilter>;
  where: {
    query: Prisma.GameWhereInput,
    // filter: ((o: NonNullable<Awaited<ReturnType<typeof GameService.prototype.getGameInfo>>>) => boolean)[],
    // refine: (<R extends NonNullable<Awaited<ReturnType<typeof GameService.prototype.getGameInfo>>>, T extends keyof R>(o: R) => [T, R[T]])[]
  };

  constructor(filter: Partial<RecommendFilter>) {
    this.filter = filter;
    this.where = this.buildFilter()
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
          genre_name: this.filter.genre
        }
      }
    }

    return { query: filterObj, /* refine: refineFunctions, filter: filterFunctions */ };
  }

  async getAppList() {
    return db.game.findMany({
      where: this.where.query,
      select: {
        app_id: true,
      }
    }).then((r) => r.map((v) => v.app_id));
  }

  async selectRandom(appids: number[], exclude: number[]) {
    const filteredAppIds = appids.filter(appid => !exclude.includes(appid));

    if (filteredAppIds.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * filteredAppIds.length);
    return filteredAppIds[randomIndex];
  }
}

class GameService {
  refinedGameInfo?: {
    app_id: number;
    title: string;
    description: string;
    owner_min: number;
    release_date: string;
    player_count: {
      latest: number;
      peak: number;
    };
    thumbnail_src: string;
    review_positive: number;
    review_negative: number;
    review_ratio?: number;
    genres: string[];
  };

  constructor(private readonly gameId: number) {}

  async getGameInfo() {
    return db.game.findUnique({
      where: {
        app_id: this.gameId,
      },
      include: {
        genres: true,
        player_count: true
      }
    });
  }
}