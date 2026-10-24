import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import AnimeGrid from '../components/AnimeGrid';
import { SearchFilters, type SearchFilters as SearchFiltersType } from '../components/SearchFilters';
import { useAnimeSearch, usePopularAnime, useSeasonalAnime, useTrendingAnime } from '../hooks/useAnimeData';
import { GridSkeleton } from '../components/LoadingSkeletons';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';

const PAGE_SIZE_LABEL = 30;

const AnimeList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const category = searchParams.get('category') || 'all';
  const genre = searchParams.get('genre') || '';
  const year = searchParams.get('year') || '';
  const query = searchParams.get('query') || '';
  const status = searchParams.get('status') || '';

  const { data: trending = [], isLoading: trendingLoading } = useTrendingAnime();
  const { data: popular = [], isLoading: popularLoading } = usePopularAnime();
  const { data: seasonal = [], isLoading: seasonalLoading } = useSeasonalAnime();

  const {
    data: searchData,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = useAnimeSearch(query, genre, year, status, page);

  const { animeList, isLoading, hasMore, totalPages } = useMemo(() => {
    if (category === 'trending') {
      return { animeList: trending, isLoading: trendingLoading, hasMore: false, totalPages: 1 };
    }
    if (category === 'popular') {
      return { animeList: popular, isLoading: popularLoading, hasMore: false, totalPages: 1 };
    }
    if (category === 'seasonal' || category === 'new') {
      return { animeList: seasonal, isLoading: seasonalLoading, hasMore: false, totalPages: 1 };
    }
    if (category === 'top') {
      const sorted = [...popular].sort(
        (a, b) => (Number.parseFloat(b.rating) || 0) - (Number.parseFloat(a.rating) || 0),
      );
      return { animeList: sorted, isLoading: popularLoading, hasMore: false, totalPages: 1 };
    }
    if (genre || query || year || status) {
      return {
        animeList: searchData?.anime ?? [],
        isLoading: searchLoading,
        hasMore: searchData?.pagination.hasNextPage ?? false,
        totalPages: searchData?.pagination.totalPages ?? 1,
      };
    }
    const mixed = [...trending, ...popular];
    return {
      animeList: Array.from(new Map(mixed.map((item) => [item.id, item])).values()),
      isLoading: trendingLoading || popularLoading,
      hasMore: false,
      totalPages: 1,
    };
  }, [
    category, genre, query, year, status,
    trending, popular, seasonal,
    trendingLoading, popularLoading, seasonalLoading,
    searchData, searchLoading,
  ]);

  const handleSearch = (filters: SearchFiltersType) => {
    const next = new URLSearchParams();
    if (filters.query) next.set('query', filters.query);
    if (filters.genres.length > 0) next.set('genre', filters.genres[0]);
    if (filters.year) next.set('year', filters.year);
    if (filters.status) next.set('status', filters.status);
    if (category !== 'all') next.set('category', category);
    setSearchParams(next);
    setPage(1);
    setShowFilters(false);
  };

  const getCategoryTitle = () => {
    switch (category) {
      case 'trending':
        return 'Trending Anime';
      case 'popular':
        return 'Popular Anime';
      case 'seasonal':
        return 'Recently Updated';
      case 'new':
        return 'New Releases';
      case 'top':
        return 'Top Rated Anime';
      default:
        if (query) return `Search: "${query}"`;
        if (genre) return `${genre.charAt(0).toUpperCase()}${genre.slice(1)} Anime`;
        return 'All Anime';
    }
  };

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main className="container mx-auto px-4 pb-12 pt-28 md:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-white md:text-3xl">{getCategoryTitle()}</h1>
          <Button variant="secondary" onClick={() => setShowFilters((value) => !value)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>

        {showFilters && (
          <div className="glass-card mb-6 p-4">
            <SearchFilters onSearch={handleSearch} />
          </div>
        )}

        {isLoading ? (
          <GridSkeleton />
        ) : animeList.length === 0 ? (
          <p className="py-16 text-center text-white/60">No anime matched your search.</p>
        ) : (
          <>
            <AnimeGrid title="" animeList={animeList.map((anime) => ({
              id: anime.id,
              title: anime.title,
              image: anime.image,
              category: anime.category,
              rating: anime.rating,
              year: anime.year,
              episodes: anime.episodes,
            }))} />

            {hasMore && (
              <div className="mt-8 flex justify-center">
                <Button
                  onClick={() => setPage((value) => value + 1)}
                  disabled={searchFetching || page >= totalPages}
                >
                  {searchFetching ? 'Loading…' : `Load more (page ${page} of ${totalPages})`}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default AnimeList;
