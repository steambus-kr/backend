import { t } from "elysia";

export interface IGetAppListBody {
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

export type IAppDetailsBody<G = string> = Record<
  number,
  {
    success: boolean;
    data: {
      name: string;
      short_description: string;
      genres?: G[];
      header_image: string;
      release_date: {
        coming_soom: boolean;
        date: string;
      };
    };
  }
>;

export type ISteamCMDBody = {
  success: boolean;
  data: Record<number, { common: { steam_release_date?: `${number}` } }>;
};

export interface ISteamSpy {
  appid: number;
  name: string;
  positive: number;
  negative: number;
  owners: string;
}

export interface ISteamUserStats {
  response:
    | {
        result: 1; // 1 if success, else 0
        player_count: number;
      }
    | {
        result: 0;
      };
}

export interface RecommendFilter {
  owner_min: number;
  player_min: number;
  player_max: number;
  positive_review_min: number;
  positive_review_max: number;
  review_ratio_min: number;
  review_ratio_max: number;
  genre: string;
}

export const RecommendFilterValidation = t.Object({
  owner_min: t.Optional(t.Number()),
  player_min: t.Optional(t.Number()),
  player_max: t.Optional(t.Number()),
  positive_review_min: t.Optional(t.Number()),
  positive_review_max: t.Optional(t.Number()),
  review_ratio_min: t.Optional(t.Number()),
  review_ratio_max: t.Optional(t.Number()),
  genre: t.Optional(t.String()),
});
