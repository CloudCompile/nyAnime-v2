import { useQuery } from '@tanstack/react-query';
import { fetchCharacters, fetchReviews, type CharacterData, type ReviewData } from '../services/characterService';

/** Cast list for an anime, resolved from its title. */
export const useAnimeCharacters = (title: string) => {
  return useQuery({
    queryKey: ['animeCharacters', title],
    queryFn: () => fetchCharacters(title),
    staleTime: 30 * 60 * 1000,
    enabled: title.trim().length > 0,
    select: (data) => (Array.isArray(data) ? data : []),
  });
};

export const useAnimeReviews = (animeId: string) => {
  return useQuery({
    queryKey: ['animeReviews', animeId],
    queryFn: () => fetchReviews(animeId),
    staleTime: 5 * 60 * 1000,
    enabled: !!animeId,
    select: (data) => (Array.isArray(data) ? data : []),
  });
};

export type { CharacterData, ReviewData };
