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

export type IAppDetailsBody = Record<
  number,
  {
    success: boolean;
    data: {
      name: string;
      short_description: string;
      genres?: string[];
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
