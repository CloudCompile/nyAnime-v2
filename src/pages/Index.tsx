import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Play } from 'lucide-react';
import Header from '../components/Header';
import CategoryRow from '../components/CategoryRow';
import AnimeGrid from '../components/AnimeGrid';
import ContinueWatching from '../components/ContinueWatching';
import DownloadPanel from '../components/DownloadPanel';
import { useHomeData, usePopularAnime, useSeasonalAnime, useTrendingAnime, type AnimeData } from '../hooks/useAnimeData';
import { GridSkeleton } from '../components/LoadingSkeletons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GlassSurface } from '@/components/ui/glass-surface';

const asCardList = (items: AnimeData[]) =>
  items.map((item) => ({
    id: item.id,
    title: item.title,
    image: item.image,
    category: item.category,
    rating: item.rating,
    year: item.year,
    episodes: item.episodes,
  }));

/**
 * A static hero. The previous version cross-faded background images on a timer,
 * which kept a large composited layer alive and woke the CPU every few seconds
 * for no benefit; a single spotlight renders once and then idles.
 */
const Hero = ({ spotlight }: { spotlight?: AnimeData }) => {
  if (!spotlight) {
    return <div className="h-[60vh] w-full bg-anime-darker md:h-[70vh]" />;
  }
  return (
    <section className="relative h-[60vh] w-full overflow-hidden md:h-[70vh]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(13,13,21,0.5), rgba(13,13,21,0.95)), url('${spotlight.image}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="relative z-10 flex h-full flex-col justify-end">
        <div className="container mx-auto px-4 pb-16 md:px-6 md:pb-20">
          <GlassSurface className="max-w-3xl rounded-2xl p-6">
            <span className="mb-3 inline-block rounded-full bg-anime-purple/20 px-3 py-1 text-xs font-medium text-white">
              Spotlight
            </span>
            <h1 className="mb-3 text-3xl font-bold leading-tight text-white md:text-5xl">
              {spotlight.title}
            </h1>
            {spotlight.synopsis && (
              <p className="mb-6 max-w-2xl text-sm text-white/80 md:text-base">
                {spotlight.synopsis.slice(0, 220)}…
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to={`/anime/${spotlight.id}/watch`}>
                  <Play className="mr-2 h-4 w-4" />
                  Watch now
                </Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to={`/anime/${spotlight.id}`}>
                  More info
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </GlassSurface>
        </div>
      </div>
    </section>
  );
};

const Index = () => {
  const { data: home } = useHomeData();
  const { data: trending = [], isLoading: trendingLoading } = useTrendingAnime();
  const { data: popular = [], isLoading: popularLoading } = usePopularAnime();
  const { data: seasonal = [] } = useSeasonalAnime();
  const [activeTab, setActiveTab] = useState('trending');

  const spotlight = useMemo(() => {
    const first = home?.spotlights?.[0];
    if (!first) return undefined;
    return {
      id: first.dataId,
      slug: first.id,
      title: first.title,
      image: first.poster ?? '',
      category: first.showType ?? 'Anime',
      rating: 'N/A',
      year: 'N/A',
      synopsis: first.description,
    } satisfies AnimeData;
  }, [home]);

  const newAnime = useMemo(
    () => popular.filter((anime) => Number(anime.year) >= 2023).slice(0, 10),
    [popular],
  );

  const isLoading = trendingLoading && popularLoading;

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main>
        <Hero spotlight={spotlight} />
        <ContinueWatching />

        {isLoading ? (
          <GridSkeleton />
        ) : (
          <>
            <CategoryRow title="Trending Now" seeAllLink="/anime?category=trending" animeList={asCardList(trending)} />
            <CategoryRow title="Popular This Season" seeAllLink="/anime?category=popular" animeList={asCardList(popular)} />
            {newAnime.length > 0 && (
              <CategoryRow title="New Releases" seeAllLink="/anime?category=new" animeList={asCardList(newAnime)} />
            )}
            {seasonal.length > 0 && (
              <CategoryRow title="Recently Updated" seeAllLink="/anime?category=seasonal" animeList={asCardList(seasonal)} />
            )}
          </>
        )}

        <section className="py-8">
          <div className="container mx-auto px-4 md:px-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">Browse</h2>
                <TabsList>
                  <TabsTrigger value="trending">Trending</TabsTrigger>
                  <TabsTrigger value="popular">Popular</TabsTrigger>
                </TabsList>
              </div>
            </Tabs>
            <AnimeGrid
              title=""
              animeList={asCardList(activeTab === 'trending' ? trending.slice(0, 15) : popular.slice(0, 15))}
            />
          </div>
        </section>

        <section className="container mx-auto px-4 pb-12 md:px-6">
          <DownloadPanel />
        </section>
      </main>
    </div>
  );
};

export default Index;
