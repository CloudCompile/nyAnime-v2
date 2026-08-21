
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { anilistService, AnimeResult } from '../services/anilistService';

// Map AnimeResult to the AnimeData interface used by components
export interface AnimeData {
  id: number;
  title: string;
  image: string;
  category: string;
  rating: string;
  year: string;
  episodes?: number;
  similarAnime?: AnimeData[];
  synopsis?: string;
  trailerId?: string;
  type?: string;
  status?: string;
  title_english?: string;
  duration?: string;
  airing?: boolean;
  airingEpisodes?: number;
}

function mapToAnimeData(anime: AnimeResult): AnimeData {
  return {
    id: anime.id,
    title: anime.title,
    image: anime.image || '',
    category: (anime.genres?.join(', ') || 'Unknown'),
    rating: anime.score ? anime.score.toString() : 'N/A',
    year: anime.seasonYear?.toString() || anime.startDate?.substring(0, 4) || 'Unknown',
    episodes: anime.episodes,
    synopsis: anime.description,
    trailerId: anime.trailerId,
    type: anime.format || 'TV',
    status: anime.status,
    title_english: anime.titleEnglish,
    duration: anime.duration ? `${anime.duration} min` : undefined,
    airing: anime.status === 'RELEASING',
    airingEpisodes: anime.nextAiringEpisode?.episode,
  };
}

// Custom hook for trending anime
export const useTrendingAnime = () => {
  return useQuery({
    queryKey: ['trendingAnime'],
    queryFn: async () => {
      const data = await anilistService.getTrending(1, 25);
      return data.media.map(mapToAnimeData);
    },
    staleTime: 5 * 60 * 1000,
  });
};

// Custom hook for popular anime
export const usePopularAnime = () => {
  return useQuery({
    queryKey: ['popularAnime'],
    queryFn: async () => {
      const data = await anilistService.getPopular(1, 25);
      return data.media.map(mapToAnimeData);
    },
    staleTime: 5 * 60 * 1000,
  });
};

// Custom hook for seasonal anime
export const useSeasonalAnime = () => {
  const currentYear = new Date().getFullYear();
  const seasons: ('WINTER' | 'SPRING' | 'SUMMER' | 'FALL')[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const currentSeason = seasons[new Date().getMonth() / 3 | 0] as any;

  return useQuery({
    queryKey: ['seasonalAnime', currentYear, currentSeason],
    queryFn: async () => {
      const data = await anilistService.getSeasonal(currentYear, currentSeason);
      return data.media.map(mapToAnimeData);
    },
    staleTime: 5 * 60 * 1000,
  });
};

// Search hook
export const useAnimeSearch = (
  query?: string,
  genre?: string,
  _year?: string,
  _status?: string,
  page: number = 1
) => {
  return useQuery({
    queryKey: ['animeSearch', query, genre, page],
    queryFn: async () => {
      if (genre) {
        const data = await anilistService.getByGenre(genre, page, 25);
        return { anime: data.media.map(mapToAnimeData), pagination: { hasNextPage: false, totalPages: 1 } };
      }
      if (query) {
        const data = await anilistService.search(query, page, 25);
        return { anime: data.media.map(mapToAnimeData), pagination: { hasNextPage: false, totalPages: 1 } };
      }
      return { anime: [], pagination: { hasNextPage: false, totalPages: 0 } };
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!(query || genre),
  });
};

// Get anime by ID
export const useAnimeById = (id: number) => {
  return useQuery({
    queryKey: ['anime', id],
    queryFn: async () => {
      const data = await anilistService.getById(id);
      return data ? mapToAnimeData(data) : null;
    },
    staleTime: 5 * 60 * 1000,
    enabled: id > 0,
  });
};

// Similar/recommendations
export const useSimilarAnime = (id: number) => {
  return useQuery({
    queryKey: ['similarAnime', id],
    queryFn: async () => {
      const data = await anilistService.getById(id);
      if (!data?.recommendations) return [];
      return data.recommendations.map(r => ({
        id: r.id,
        title: r.title,
        image: r.image || '',
        category: '',
        rating: r.score?.toString() || 'N/A',
        year: '',
      }));
    },
    staleTime: 5 * 60 * 1000,
    enabled: id > 0,
    retry: 1,
  });
};

// Genres list
export const fetchGenres = async (): Promise<string[]> => {
  return anilistService.getGenres();
};

// Main hook combining all data
export const useAnimeData = () => {
  const { data: trendingAnime = [], isLoading: trendingLoading } = useTrendingAnime();
  const { data: popularAnime = [], isLoading: popularLoading } = usePopularAnime();
  const { data: seasonalAnime = [], isLoading: seasonalLoading } = useSeasonalAnime();

  const isLoading = trendingLoading || popularLoading || seasonalLoading;
  const allAnime = [...(trendingAnime || []), ...(popularAnime || []), ...(seasonalAnime || [])];

  const getAnimeByIdLocal = useCallback((id: number): AnimeData | null => {
    return allAnime.find(anime => anime.id === id) || null;
  }, [allAnime]);

  return {
    trendingAnime: trendingAnime || [],
    popularAnime: popularAnime || [],
    seasonalAnime: seasonalAnime || [],
    allAnime,
    isLoading,
    getAnimeById: getAnimeByIdLocal,
  };
};
