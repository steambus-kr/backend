import { RecommendFilter } from "@/types";
import { db } from "@/db";
import { Prisma } from "@prisma/client";

export class RecommendService {
  filter: Partial<RecommendFilter>;
  where: Prisma.GameWhereInput;

  constructor(filter: Partial<RecommendFilter>) {
    this.filter = filter;
    this.where = this.buildFilter();
  }

  updateFilter(filter: Partial<RecommendFilter>) {
    this.filter = {
      ...this.filter,
      ...filter,
    };
    this.where = this.buildFilter();
  }

  buildFilter(): Prisma.GameWhereInput {
    const filterObj: Prisma.GameWhereInput = {};
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

    return filterObj;
  }
}
