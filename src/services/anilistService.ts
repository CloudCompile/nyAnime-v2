
const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL = 'https://api.jikan.moe/v4';

const LIST_QUERY = `
  query($search: String, $page: Int = 1, $perPage: Int = 20, $genre: String, $year: Int, $season: MediaSeason, $format: MediaFormat, $status: MediaStatus, $sort: [MediaSort] = TRENDING_DESC) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: ANIME, genre: $genre, season: $season, seasonYear: $year,  format: $format, status: $status, sort: $sort) {
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
        
        recommendations { nodes { media { id title { romaji english } coverImage { large } format averageScore } } }
        characters { edges { role node { id name { full native } image { large } } } }
        
        
      }
    }
  }
`;

const SINGLE_QUERY = `
  query($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      idMal
      title { romaji english native }
      description(asHtml: false)
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
      trending
      genres
      tags { name rank }
      studios(isMain: true) { nodes { name } }
      startDate { year month day }
      endDate { year month day }
      trailer { id site }
      nextAiringEpisode { episode airingAt timeUntilAiring }
      
      recommendations { nodes { media { id title { romaji english } coverImage { large } format averageScore } } }
      characters { edges { role node { id name { full native } image { large } } } }
      
      
    }
  }
`;

const GENRE_QUERY = `
  query { GenreCollection }
`;

interface AnilistMedia {
  id: number;
  idMal?: number;
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
  relations?: { edges: { node: { id: number; title: { romaji: string; english: string }; format?: string; type?: string; relation?: string } }[] };
  recommendations?: { nodes: { media: { id: number; title: { romaji: string; english: string }; coverImage: { large: string }; format?: string; averageScore?: number } }[] };
  characters?: { edges: { role?: string; node: { id: number; name: { full: string; native: string }; image: { large: string } } }[] };
  
  
}

interface AnilistPage<T> {
  page: number;
  perPage: number;
  totalPages: number;
  hasNextPage: boolean;
  total: number;
  media: T[];
}

interface AnilistListResponse {
  Page: {
    media: AnilistMedia[];
  };
}

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english?: string | null;
  title_japanese?: string | null;
  images?: { jpg?: { large_image_url?: string; image_url?: string } };
  type?: string;
  episodes?: number | null;
  duration?: string | null;
  status?: string | null;
  year?: number | null;
  score?: number | null;
  popularity?: number | null;
  synopsis?: string | null;
  genres?: { name: string }[];
  studios?: { name: string }[];
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
  relations?: { id: number; title: string; format?: string; relation?: string }[];
  recommendations?: { id: number; title: string; image?: string; format?: string; score?: number }[];
  characters?: { id: number; name: string; image?: string; role?: string }[];
  externalLinks?: { url: string; site: string }[];
}

async function anilistFetch<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'NyAnime/1.0' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`AniList API error: ${response.status}`);
  const data = await response.json();
  if (data.errors?.[0]) throw new Error(data.errors[0].message);
  return data.data as T;
}

async function jikanFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${JIKAN_URL}${path}`);
  if (!response.ok) throw new Error(`Jikan API error: ${response.status}`);
  const result = await response.json();
  return result.data as T;
}

function mapJikanMedia(media: JikanAnime): AnimeResult {
  return {
    id: media.mal_id,
    malId: media.mal_id,
    title: media.title_english || media.title,
    titleRomaji: media.title,
    titleEnglish: media.title_english || undefined,
    titleNative: media.title_japanese || undefined,
    image: media.images?.jpg?.large_image_url || media.images?.jpg?.image_url || '',
    format: media.type,
    episodes: media.episodes,
    duration: media.duration ? parseInt(media.duration, 10) || undefined : undefined,
    status: media.status || undefined,
    seasonYear: media.year || undefined,
    score: media.score || undefined,
    popularity: media.popularity || undefined,
    genres: media.genres?.map((genre) => genre.name),
    studios: media.studios?.map((studio) => studio.name),
    description: media.synopsis || undefined,
  };
}

async function fallbackList(path: string, page: number, perPage: number): Promise<AnilistPage<AnimeResult>> {
  const media = await jikanFetch<JikanAnime[]>(path);
  const items = media.slice(0, perPage).map(mapJikanMedia);
  return { page, perPage, totalPages: 1, hasNextPage: false, total: items.length, media: items };
}

async function listWithFallback(
  request: () => Promise<AnilistPage<AnimeResult>>,
  fallback: () => Promise<AnilistPage<AnimeResult>>,
): Promise<AnilistPage<AnimeResult>> {
  try {
    return await request();
  } catch (error) {
    console.warn('AniList unavailable, using Jikan fallback:', error);
    return fallback();
  }
}

export function mapMedia(media: AnilistMedia): AnimeResult {
  return {
    id: media.id,
    malId: media.idMal,
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
    description: media.description?.replace(/<[^>]*>/g, '').substring(0, 500),
    trailerId: media.trailer?.id,
    nextAiringEpisode: media.nextAiringEpisode
      ? { episode: media.nextAiringEpisode.episode, airingAt: media.nextAiringEpisode.airingAt }
      : undefined,
    relations: media.relations?.edges?.map((e) => ({
      id: e.node.id,
      title: e.node.title.english || e.node.title.romaji,
      format: e.node.format,
      relation: e.node.relation,
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
    
  };
}

export const anilistService = {
  async search(query: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    return listWithFallback(
      async () => {
        const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { search: query, page, perPage, sort: 'SEARCH_MATCH' });
        return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
      },
      () => fallbackList(`/anime?q=${encodeURIComponent(query)}&page=${page}&limit=${perPage}`, page, perPage),
    );
  },

  async getTrending(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    return listWithFallback(
      async () => {
        const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage, sort: 'TRENDING_DESC' });
        return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
      },
      () => fallbackList(`/top/anime?page=${page}&limit=${perPage}`, page, perPage),
    );
  },

  async getPopular(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    return listWithFallback(
      async () => {
        const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage, sort: 'POPULARITY_DESC' });
        return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
      },
      () => fallbackList(`/top/anime?page=${page}&limit=${perPage}&filter=bypopularity`, page, perPage),
    );
  },

  async getTopRated(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage, sort: 'SCORE_DESC' });
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },

  async getSeasonal(year: number, season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL', page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    return listWithFallback(
      async () => {
        const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage, season, year, sort: 'TRENDING_DESC' });
        return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
      },
      () => fallbackList(`/seasons/${year}/${season.toLowerCase()}?page=${page}&limit=${perPage}`, page, perPage),
    );
  },

  async getById(id: number): Promise<AnimeResult | null> {
    const data = await anilistFetch<{ Media: AnilistMedia }>(SINGLE_QUERY, { id });
    return data.Media ? mapMedia(data.Media) : null;
  },

  async getGenres(): Promise<string[]> {
    const data = await anilistFetch<{ GenreCollection: string[] }>(GENRE_QUERY);
    return data.GenreCollection || [];
  },

  async getByGenre(genre: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { genre, page, perPage, sort: 'TRENDING_DESC' });
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },

  async getRandom(): Promise<AnimeResult | null> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page: Math.floor(Math.random() * 500) + 1, perPage: 1, sort: 'POPULARITY_DESC' });
    return data.Page.media?.[0] ? mapMedia(data.Page.media[0]) : null;
  },

  async getSuggestions(query: string, limit = 8): Promise<AnimeResult[]> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { search: query, page: 1, perPage: limit, sort: 'SEARCH_MATCH' });
    return (data.Page.media || []).map(mapMedia);
  },

  async getSchedule(page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage, sort: 'AIRING_TIME_DESC', status: 'RELEASING' });
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },

  async getSpotlight(page = 1): Promise<AnimeResult | null> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage: 1, sort: 'POPULARITY_DESC' });
    return data.Page.media?.[0] ? mapMedia(data.Page.media[0]) : null;
  },

  async getByYear(year: number, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { page, perPage, year, sort: 'TRENDING_DESC' });
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },

  async getByFormat(format: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { format, page, perPage, sort: 'TRENDING_DESC' });
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },

  async getByStatus(status: string, page = 1, perPage = 20): Promise<AnilistPage<AnimeResult>> {
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, { status, page, perPage, sort: 'TRENDING_DESC' });
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },

  async searchMulti(params: {
    query?: string; genre?: string; year?: number; season?: string;
    format?: string; status?: string; sort?: string; page?: number; perPage?: number;
  }): Promise<AnilistPage<AnimeResult>> {
    const { query, genre, year, season, format, status, sort = 'TRENDING_DESC', page = 1, perPage = 20 } = params;
    const variables: any = { page, perPage, sort };
    if (query) variables.search = query;
    if (genre) variables.genre = genre;
    if (year) variables.year = year;
    if (season) variables.season = season;
    if (format) variables.format = format;
    if (status) variables.status = status;
    const data = await anilistFetch<AnilistListResponse>(LIST_QUERY, variables);
    return { page, perPage, totalPages: 1, hasNextPage: false, total: data.Page.media.length, media: data.Page.media.map(mapMedia) };
  },
};

export const fetchGenres = async (): Promise<string[]> => {
  return anilistService.getGenres();
};
