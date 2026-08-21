
const ANILIST_QUERY = `
  query($search: String, $page: Int = 1, $perPage: Int = 20, $genre: String, $year: Int, $format: String, $status: String, $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: ANIME, genre: $genre, startDate_like: $year ? "#{$year}%" : undefined, format: $format, status: $status, sort: $sort || TRENDING_DESC) {
        id
        title { romaji english native }
        coverImage { large extraLarge color }
        bannerImage
        format
        episodes
        duration
        status
        season
        seasonYear
        averageScore
        meanScore
        popularity
        favourites
        genres
        tags { name rank }
        studios(isMain: true) { nodes { name } }
        startDate { year month day }
        endDate { year month day }
        description(asHtml: false)
        trailer { id site }
        nextAiringEpisode { episode airingAt timeUntilAiring }
        relationships { edges { node { id title { romaji english } format type relationType } } }
        recommendations { nodes { media { id title { romaji english } coverImage { large } format averageScore } } }
        characters { edges { role node { id name { full native } image { large } } } }
        externalLinks { url site formatted }
        rankings { rank place type season year }
      }
    }
  }
`;

const GENRE_QUERY = `
  query { MediaGenreCollection }
`;

const TAG_QUERY = `
  query { MediaTagCollection }
`;

interface AnilistMedia {
  id: number;
  title: { romaji: string; english: string; native: string };
  coverImage: { large: string; extraLarge: string; color?: string };
  bannerImage?: string;
  format?: string;
  episodes?: number | null;
  duration?: number;
  status?: string;
  season?: string;
  seasonYear?: number;
  averageScore?: number;
  meanScore?: number;
  popularity?: number;
  favourites?: number;
  genres?: string[];
  tags?: { name: string; rank: number }[];
  studios?: { nodes: { name: string }[] };
  startDate?: { year?: number; month?: number; day?: number };
  endDate?: { year?: number; month?: number; day?: number };
  description?: string;
  trailer?: { id: string; site: string };
  nextAiringEpisode?: { episode: number; airingAt: number; timeUntilAiring: number };
  relationships?: { edges: { node: { id: number; title: { romaji: string; english: string }; format?: string; type?: string; relationType?: string } }[] };
  recommendations?: { nodes: { media: { id: number; title: { romaji: string; english: string }; coverImage: { large: string }; format?: string; averageScore?: number } }[] };
  characters?: { edges: { role?: string; node: { id: number; name: { full: string; native: string }; image: { large: string } } }[] };
  externalLinks?: { url: string; site: string; formatted: string }[];
  rankings?: { rank: number; place: string; type: string; season?: number; year?: number }[];
}

interface AnilistPage<T> {
  page: number;
  perPage: number;
  totalPages: number;
  hasNextPage: boolean;
  total: number;
  media: T[];
}

export interface AnimeResult {
  id: number;
  malId?: number;
  title: string;
  titleRomaji: string;
  titleEnglish?: string;
  titleNative?: string;
  image: string;
  bannerImage?: string;
  format?: string;
  episodes?: number | null;
  duration?: number;
  status?: string;
  season?: string;
  seasonYear?: number;
  score?: number;
  popularity?: number;
  genres?: string[];
  tags?: { name: string; rank: number }[];
  studios?: string[];
  startDate?: string;
  endDate?: string;
  description?: string;
  trailerId?: string;
  nextAiringEpisode?: { episode: number; airingAt: number };
  relationships?: { id: number; title: string; format?: string; relationType?: string }[];
  recommendations?: { id: number; title: string; image?: string; format?: string; score?: number }[];
  characters?: { id: number; name: string; image?: string; role?: string }[];
  externalLinks?: { url: string; site: string }[];
}

const ANILIST_URL = 'https://graphql.anilist.co';

async function anilistFetch<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`AniList API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.errors && data.errors.length > 0) {
    throw new Error(data.errors[0].message);
  }

  return data.data;
}

export function mapMedia(media: AnilistMedia): AnimeResult {
  return {
    id: media.id,
    title: media.title.english || media.title.romaji || media.title.native,
    titleRomaji: media.title.romaji,
    titleEnglish: media.title.english,
    titleNative: media.title.native,
    image: media.coverImage?.extraLarge || media.coverImage?.large || '',
    bannerImage: media.bannerImage,
    format: media.format,
    episodes: media.episodes,
    duration: media.duration,
    status: media.status,
    season: media.season,
    seasonYear: media.seasonYear,
    score: media.averageScore,
    popularity: media.popularity,
    genres: media.genres,
    tags: media.tags,
    studios: media.studios?.nodes?.map((s) => s.name),
    startDate: media.startDate
      ? `${media.startDate.year}-${String(media.startDate.month || 1).padStart(2, '0')}-${String(media.startDate.day || 1).padStart(2, '0')}`
      : undefined,
    endDate: media.endDate
      ? `${media.endDate.year}-${String(media.endDate.month || 1).padStart(2, '0')}-${String(media.endDate.day || 1).padStart(2, '0')}`
      : undefined,
    description: media.description
      ? media.description.replace(/<[^>]*>/g, '').substring(0, 500)
      : undefined,
    trailerId: media.trailer?.id,
    nextAiringEpisode: media.nextAiringEpisode
      ? { episode: media.nextAiringEpisode.episode, airingAt: media.nextAiringEpisode.airingAt }
      : undefined,
    relationships: media.relationships?.edges?.map((e) => ({
      id: e.node.id,
      title: e.node.title.english || e.node.title.romaji,
      format: e.node.format,
      relationType: e.node.relationType,
    })),
    recommendations: media.recommendations?.nodes
      ?.map((r) => r.media)
      .filter(Boolean)
      .map((m) => ({
        id: m.id,
        title: m.title.english || m.title.romaji,
        image: m.coverImage?.large,
        format: m.format,
        score: m.averageScore,
      })),
    characters: media.characters?.edges
      ?.map((c) => ({
        id: c.node.id,
        name: c.node.name.full,
        image: c.node.image?.large,
        role: c.role,
      }))
      .filter(Boolean),
    externalLinks: media.externalLinks?.map((l) => ({ url: l.url, site: l.site })),
  };
}

export const anilistService = {
  async search(query: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { search: query, page, perPage, sort: 'SEARCH_MATCH' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getTrending(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, sort: 'TRENDING_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getPopular(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, sort: 'POPULARITY_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getTopRated(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, sort: 'SCORE_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getSeasonal(year: number, season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, {
      page,
      perPage,
      season,
      seasonYear: year,
      sort: 'TRENDING_DESC',
    });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getById(id: number): Promise<AnimeResult | null> {
    const data = await anilistFetch<{ media: AnilistMedia }>(ANILIST_QUERY, { id });
    return data.media ? mapMedia(data.media) : null;
  },

  async getGenres(): Promise<string[]> {
    const data = await anilistFetch<{ MediaGenreCollection: string[] }>(GENRE_QUERY);
    return data.MediaGenreCollection || [];
  },

  async getByGenre(genre: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { genre, page, perPage, sort: 'TRENDING_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getRandom(): Promise<AnimeResult | null> {
    const data = await anilistFetch<{ media: AnilistMedia }>(ANILIST_QUERY, { page: Math.floor(Math.random() * 500) + 1, perPage: 1 });
    return data.media ? mapMedia(data.media) : null;
  },

  async getSuggestions(query: string, limit = 8): Promise<AnimeResult[]> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { search: query, page: 1, perPage: limit });
    return (data.media || []).map(mapMedia);
  },

  async getSchedule(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, sort: 'AIRING_TIME_DESC', status: 'RELEASING' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getSpotlight(page = 1): Promise<AnimeResult | null> {
    const data = await anilistFetch<{ media: AnilistMedia }>(ANILIST_QUERY, { page, perPage: 1, sort: 'POPULARITY_DESC' });
    return data.media ? mapMedia(data.media) : null;
  },

  async getByYear(year: number, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, year: String(year), sort: 'TRENDING_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getByFormat(format: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, format, sort: 'TRENDING_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async getByStatus(status: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, { page, perPage, status, sort: 'TRENDING_DESC' });
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },

  async searchMulti(params: {
    query?: string;
    genre?: string;
    year?: number;
    season?: string;
    format?: string;
    status?: string;
    sort?: string;
    page?: number;
    perPage?: number;
  }): Promise<AnilistPage<AnimeResult>> {
    const { query, genre, year, season, format, status, sort = 'TRENDING_DESC', page = 1, perPage = 20 } = params;
    const variables: any = { page, perPage, sort };
    if (query) variables.search = query;
    if (genre) variables.genre = genre;
    if (year) variables.year = String(year);
    if (season) variables.season = season;
    if (format) variables.format = format;
    if (status) variables.status = status;
    const data = await anilistFetch<{ media: AnilistMedia[] }>(ANILIST_QUERY, variables);
    const media = (data.media || []).map(mapMedia);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: media.length, media };
  },
};

export const fetchGenres = async (): Promise<string[]> => {
  return anilistService.getGenres();
};
