import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import AnimeGrid from '../components/AnimeGrid';
import { SearchFilters, type SearchFilters as SearchFiltersType } from '../components/SearchFilters';
import {
  useAnimeSearch,
  useCatalogue,
  usePopularAnime,
  useSeasonalAnime,
  useTrendingAnime,
} from '../hooks/useAnimeData';
import { GridSkeleton } from '../components/LoadingSkeletons';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const AnimeList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const category = searchParams.get('category') || 'all';
  const genre = searchParams.get('genre') || '';
  const year = searchParams.get('year') || '';
  const query = searchParams.get('query') || '';
  const status = searchParams.get('status') || '';

  const hasFilters = Boolean(genre || query || year || status);
  const isCatalogue = category === 'all' && !hasFilters;

  const { data: trending = [], isLoading: trendingLoading } = useTrendingAnime();
  const { data: popular = [], isLoading: popularLoading } = usePopularAnime();
  const { data: seasonal = [], isLoading: seasonalLoading } = useSeasonalAnime();

  const {
    data: searchData,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = useAnimeSearch(query, genre, year, status, page);

  const { data: catalogueData, isLoading: catalogueLoading } = useCatalogue(page, isCatalogue);

  // A new query or filter starts a new result set.
  useEffect(() => {
    setPage(1);
  }, [query, genre, year, status, category]);

  const { animeList, isLoading, hasMore, totalPages } = useMemo(() => {
    // Filters win over the category route. The old order meant searching from
    // /anime?category=trending ignored the query entirely.
    if (hasFilters) {
      return {
        animeList: searchData?.anime ?? [],
        isLoading: searchLoading,
        hasMore: searchData?.pagination.hasNextPage ?? false,
        totalPages: searchData?.pagination.totalPages ?? 1,
      };
    }
    if (category === 'trending' || category === 'hot') {
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
    return {
      animeList: catalogueData?.anime ?? [],
      isLoading: catalogueLoading,
      hasMore: catalogueData?.pagination.hasNextPage ?? false,
      totalPages: catalogueData?.pagination.totalPages ?? 1,
    };
  }, [
    hasFilters, category,
    trending, popular, seasonal,
    trendingLoading, popularLoading, seasonalLoading,
    searchData, searchLoading,
    catalogueData, catalogueLoading,
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

  const clearFilters = () => {
    setSearchParams(category !== 'all' ? { category } : {});
    setPage(1);
  };

  const getCategoryTitle = () => {
    if (hasFilters) {
      if (query) return `Search: "${query}"`;
      const parts: string[] = [];
      if (genre) parts.push(genre.toLowerCase() === 'anime' ? 'Anime' : `${titleCase(genre)} Anime`);
      if (year) parts.push(year);
      if (status) parts.push(status);
      return parts.join(' • ');
    }
    switch (category) {
      case 'trending':
        return 'Trending Anime';
      case 'hot':
        return 'Hot This Week';
      case 'popular':
        return 'Popular Anime';
      case 'seasonal':
        return 'Recently Updated';
      case 'new':
        return 'New Releases';
      case 'top':
        return 'Top Rated Anime';
      default:
        return 'All Anime';
    }
  };

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main className="container mx-auto px-4 pb-12 pt-24 md:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-white md:text-3xl">{getCategoryTitle()}</h1>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" onClick={clearFilters} className="text-white/70 hover:text-white">
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )}
            <Button
              variant="secondary"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((value) => !value)}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="glass-card mb-6 p-4">
            <SearchFilters onSearch={handleSearch} />
          </div>
        )}

        {isLoading ? (
          <GridSkeleton />
        ) : animeList.length === 0 ? (
          <p className="py-16 text-center text-white/60">
            {hasFilters ? 'No anime matched your search.' : 'Nothing to show right now.'}
          </p>
        ) : (
          <>
            <AnimeGrid
              title=""
              animeList={animeList.map((anime) => ({
                id: anime.id,
                title: anime.title,
                image: anime.image,
                category: anime.category,
                rating: anime.rating,
                year: anime.year,
                episodes: anime.episodes,
              }))}
            />

            {totalPages > 1 && (
              <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((value) => Math.max(1, value - 1));
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-white/60">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  disabled={searchFetching || !hasMore || page >= totalPages}
                  onClick={() => {
                    setPage((value) => value + 1);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </nav>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default AnimeList;
