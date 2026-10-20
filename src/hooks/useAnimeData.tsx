import { useQuery } from '@tanstack/react-query';
import {
  browseCategory,
  filterAnime,
  getAnimeInfo,
  getHome,
  searchAnime,
  suggestAnime,
  type AnimeDetail,
  type AnimeSummary,
} from '../services/animeApiService';
import { cachedSlug, looksLikeSlug, rememberSlug } from '../lib/animeIds';

/** Shape the components consume. `id` is the numeric id used in routes. */
export interface AnimeData {
  id: string;
  slug: string;
  title: string;
  image: string;
  category: string;
  rating: string;
  year: string;
  episodes?: number;
  synopsis?: string;
  type?: string;
  status?: string;
  title_english?: string;
  duration?: string;
  airing?: boolean;
  airingEpisodes?: number;
  similarAnime?: AnimeData[];
}

function toAnimeData(summary: AnimeSummary): AnimeData {
  rememberSlug(summary.dataId, summary.id);
  return {
    id: summary.dataId,
    slug: summary.id,
    title: summary.title,
    image: summary.poster ?? '',
    category: summary.showType ?? 'Anime',
    rating: summary.rating ?? 'N/A',
    year: 'N/A',
    episodes: summary.eps,
    type: summary.showType,
  };
}

function toAnimeDataFromDetail(detail: AnimeDetail): AnimeData {
  rememberSlug(detail.dataId, detail.id);
  const year = detail.premiered?.match(/\d{4}/)?.[0] ?? 'N/A';
  return {
    id: detail.dataId,
    slug: detail.id,
    title: detail.title,
    image: detail.poster ?? '',
    category: detail.genres?.join(', ') || detail.showType || 'Anime',
    rating: detail.score ?? 'N/A',
    year,
    episodes: detail.totalEpisodes,
    synopsis: detail.description,
    type: detail.type ?? detail.showType,
    status: detail.status,
    title_english: detail.title,
    duration: detail.duration,
    airing: detail.status?.toLowerCase() === 'currently airing',
    similarAnime: detail.recommendations?.map(toAnimeData),
  };
}

function dedupe(items: AnimeData[]): AnimeData[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

/**
 * The home payload is fetched once and shared, because trending, popular and
 * the hero slideshow all read from it. One request instead of four.
 */
export const useHomeData = () =>
  useQuery({
    queryKey: ['home'],
    queryFn: () => getHome(),
    staleTime: 5 * 60 * 1000,
  });

export const useTrendingAnime = () => {
  const query = useHomeData();
  const data = [...(query.data?.trending ?? []), ...(query.data?.topAiring ?? [])].map(toAnimeData);
  return { ...query, data: dedupe(data) };
};

export const usePopularAnime = () => {
  const query = useHomeData();
  const data = [...(query.data?.mostPopular ?? []), ...(query.data?.mostFavorite ?? [])].map(toAnimeData);
  return { ...query, data: dedupe(data) };
};

export const useSeasonalAnime = () => {
  const query = useQuery({
    queryKey: ['recentlyUpdated'],
    queryFn: () => browseCategory('recently-updated'),
    staleTime: 5 * 60 * 1000,
  });
  return { ...query, data: (query.data?.items ?? []).map(toAnimeData) };
};

/** Search, genre browsing and year/status filtering all go through `/api/filter`. */
export const useAnimeSearch = (
  query?: string,
  genre?: string,
  year?: string,
  status?: string,
  page: number = 1,
) => {
  return useQuery({
    queryKey: ['animeSearch', query, genre, year, status, page],
    queryFn: async () => {
      const result = await filterAnime({
        keyword: query || undefined,
        genre: genre || undefined,
        year: year || undefined,
        status: status || undefined,
        page,
      });
      return {
        anime: result.items.map(toAnimeData),
        pagination: { hasNextPage: result.hasNextPage, totalPages: result.totalPages },
      };
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!(query || genre || year || status),
  });
};

/**
 * Resolve a route id to the catalogue slug. A slug is used as-is; a numeric id
 * is looked up in the local cache first, and only falls back to a request when
 * the slug has never been seen.
 */
export async function resolveSlug(routeId: string): Promise<string | null> {
  if (!routeId) return null;
  if (looksLikeSlug(routeId)) return routeId;
  const cached = cachedSlug(routeId);
  if (cached) return cached;

  const byKeyword = await searchAnime(routeId).catch(() => []);
  const match = byKeyword.find((item) => item.dataId === routeId) ?? byKeyword[0];
  if (match) {
    rememberSlug(match.dataId, match.id);
    return match.id;
  }
  return null;
}

/**
 * Non-hook variant of `useAnimeById`, for callers that need metadata for a
 * list of ids (watch history, watchlist) and cannot call a hook per item.
 */
export async function fetchAnimeByRouteId(routeId: string): Promise<AnimeData | null> {
  const slug = await resolveSlug(routeId);
  if (!slug) return null;
  const detail = await getAnimeInfo(slug);
  return detail ? toAnimeDataFromDetail(detail) : null;
}

export const useAnimeById = (routeId: string) => {
  return useQuery({
    queryKey: ['anime', routeId],
    queryFn: async (): Promise<AnimeData | null> => {
      const slug = await resolveSlug(routeId);
      if (!slug) return null;
      const detail = await getAnimeInfo(slug);
      return detail ? toAnimeDataFromDetail(detail) : null;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!routeId,
  });
};

/** Full detail record, for pages that need genres, studios and relations. */
export const useAnimeDetail = (routeId: string) => {
  return useQuery({
    queryKey: ['animeDetail', routeId],
    queryFn: async (): Promise<AnimeDetail | null> => {
      const slug = await resolveSlug(routeId);
      if (!slug) return null;
      return getAnimeInfo(slug);
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!routeId,
  });
};

export const useSimilarAnime = (routeId: string) => {
  return useQuery({
    queryKey: ['similarAnime', routeId],
    queryFn: async (): Promise<AnimeData[]> => {
      const slug = await resolveSlug(routeId);
      if (!slug) return [];
      const detail = await getAnimeInfo(slug);
      return [...(detail?.recommendations ?? []), ...(detail?.related ?? [])].map(toAnimeData);
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!routeId,
  });
};

/** Quick-search suggestions for the header search box. */
export const useAnimeSuggestions = (query: string, limit = 8) => {
  return useQuery({
    queryKey: ['suggestions', query, limit],
    queryFn: async () => {
      const results = await suggestAnime(query);
      return dedupe(results.map(toAnimeData)).slice(0, limit);
    },
    staleTime: 5 * 60 * 1000,
    enabled: query.trim().length >= 2,
  });
};

/** Genre names for the filter panel, taken from the home payload. */
export const useGenres = () => {
  const query = useHomeData();
  return { ...query, data: query.data?.genres ?? [] };
};

export const fetchGenres = async (): Promise<string[]> => {
  const home = await getHome();
  return home.genres;
};

export const useAnimeData = () => {
  const { data: trendingAnime = [], isLoading: trendingLoading } = useTrendingAnime();
  const { data: popularAnime = [], isLoading: popularLoading } = usePopularAnime();
  const { data: seasonalAnime = [], isLoading: seasonalLoading } = useSeasonalAnime();

  return {
    trendingAnime,
    popularAnime,
    seasonalAnime,
    allAnime: [...trendingAnime, ...popularAnime, ...seasonalAnime],
    isLoading: trendingLoading || popularLoading || seasonalLoading,
    getAnimeById: (id: string) =>
      [...trendingAnime, ...popularAnime, ...seasonalAnime].find((anime) => anime.id === id) ?? null,
  };
};
