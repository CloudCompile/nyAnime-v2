import React, { useMemo } from 'react';
import Header from '../components/Header';
import CategoryRow from '../components/CategoryRow';
import ContinueWatching from '../components/ContinueWatching';
import HeroBillboard, { type BillboardSlide } from '../components/HeroBillboard';
import TopTenRow from '../components/TopTenRow';
import QuestInstallPrompt from '../components/QuestInstallPrompt';
import {
  useHomeData,
  usePopularAnime,
  useSeasonalAnime,
  useTrendingAnime,
  type AnimeData,
} from '../hooks/useAnimeData';
import { GridSkeleton, HeroSkeleton } from '../components/LoadingSkeletons';

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

const Index = () => {
  const { data: home, isLoading: homeLoading } = useHomeData();
  const { data: trending = [], isLoading: trendingLoading } = useTrendingAnime();
  const { data: popular = [], isLoading: popularLoading } = usePopularAnime();
  const { data: seasonal = [] } = useSeasonalAnime();

  // Every spotlight is reachable from the billboard, not just the first one.
  const slides = useMemo<BillboardSlide[]>(
    () =>
      (home?.spotlights ?? []).slice(0, 5).map((spotlight) => ({
        id: spotlight.dataId || spotlight.id,
        title: spotlight.title,
        image: spotlight.poster ?? '',
        synopsis: spotlight.description,
        type: spotlight.showType,
        episodes: spotlight.eps,
        rating: spotlight.rating,
        audio:
          spotlight.dub && spotlight.sub
            ? 'Sub & Dub'
            : spotlight.dub
              ? 'Dub'
              : spotlight.sub
                ? 'Sub'
                : undefined,
      })),
    [home],
  );

  const newAnime = useMemo(
    () => popular.filter((anime) => Number(anime.year) >= 2023).slice(0, 10),
    [popular],
  );

  const isLoading = trendingLoading && popularLoading;
  const topTen = asCardList(trending).slice(0, 10);

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main>
        {homeLoading && slides.length === 0 ? <HeroSkeleton /> : <HeroBillboard slides={slides} />}
        <QuestInstallPrompt />
        <ContinueWatching />

        {isLoading ? (
          <GridSkeleton />
        ) : (
          <>
            <TopTenRow title="Top 10 on NyAnime Today" seeAllLink="/anime?category=trending" items={topTen} />
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
      </main>
    </div>
  );
};

export default Index;
