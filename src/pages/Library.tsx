import React, { useEffect, useState } from 'react';
import Header from '../components/Header';
import AnimeCard from '../components/AnimeCard';
import DownloadsLibrary from '../components/DownloadsLibrary';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Clock3, Download, Heart, Library as LibraryIcon } from 'lucide-react';
import { getLibrary } from '@/services/localLibrary';
import { fetchAnimeByRouteId } from '@/hooks/useAnimeData';

interface LibraryCard {
  id: string;
  title: string;
  image: string;
  category: string;
  rating: string;
  year: string;
  episodes: number;
  progress?: number;
}

/**
 * Everything the viewer saved on this device. There is no account: the data is
 * the browser's, so the page only says where it lives instead of asking who is
 * looking at it.
 */
const Library = () => {
  const [watchlist, setWatchlist] = useState<LibraryCard[]>([]);
  const [history, setHistory] = useState<LibraryCard[]>([]);
  const [favorites, setFavorites] = useState<LibraryCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Bumped whenever anything writes to the library, so this page never shows
  // an entry that was just unfavourited on another page.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const handleLibraryChange = () => setRevision((value) => value + 1);
    window.addEventListener('nyanime:library-changed', handleLibraryChange);
    return () => window.removeEventListener('nyanime:library-changed', handleLibraryChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const toCards = async (animeIds: string[]): Promise<LibraryCard[]> => {
      const unique = Array.from(new Set(animeIds));
      return Promise.all(
        unique.map(async (id): Promise<LibraryCard> => {
          const anime = await fetchAnimeByRouteId(id).catch(() => null);
          return {
            id,
            title: anime?.title ?? `Anime ${id}`,
            image: anime?.image || '/placeholder.svg',
            category: anime?.category ?? 'Unknown',
            rating: anime?.rating ?? 'N/A',
            year: anime?.year ?? 'N/A',
            episodes: anime?.episodes ?? 0,
          };
        }),
      );
    };

    (async () => {
      const library = getLibrary();
      const [watchlistCards, historyCards, favoriteCards] = await Promise.all([
        toCards(library.watchlist.map((item) => item.animeId)),
        toCards(library.history.map((item) => item.animeId)),
        toCards(library.favorites.map((item) => item.animeId)),
      ]);
      if (cancelled) return;

      setWatchlist(watchlistCards);
      setHistory(
        historyCards.map((card, index) => ({
          ...card,
          progress: library.history[index]?.progress ?? 0,
        })),
      );
      setFavorites(favoriteCards);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [revision]);

  const grid = (cards: LibraryCard[], empty: string) =>
    cards.length === 0 ? (
      <p className="py-10 text-center text-white/60">{empty}</p>
    ) : (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 md:gap-6">
        {cards.map((anime) => (
          <AnimeCard
            key={`${anime.id}-${anime.progress ?? ''}`}
            id={anime.id}
            title={anime.title}
            image={anime.image}
            category={anime.category}
            rating={anime.rating}
            year={anime.year}
            episodes={anime.episodes}
            progress={anime.progress}
          />
        ))}
      </div>
    );

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main className="container mx-auto px-4 py-8 md:py-16 mt-16">
        <div className="glass-card p-6 md:p-8 rounded-xl mb-10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-anime-purple/20 rounded-full flex items-center justify-center">
              <LibraryIcon className="w-8 h-8 text-anime-purple" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">My Library</h1>
              <p className="text-white/60 mt-1">
                Saved on this device. Nothing here is uploaded or synced.
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-white/70">Loading…</div>
        ) : (
          <Tabs defaultValue="watchlist" className="w-full">
            <TabsList className="h-10 mb-8">
              <TabsTrigger value="watchlist" className="text-sm">
                <Heart className="mr-2 h-4 w-4" /> Watchlist
              </TabsTrigger>
              <TabsTrigger value="history" className="text-sm">
                <Clock3 className="mr-2 h-4 w-4" /> Watch History
              </TabsTrigger>
              <TabsTrigger value="favorites" className="text-sm">
                Favorites
              </TabsTrigger>
              <TabsTrigger value="downloads" className="text-sm">
                <Download className="mr-2 h-4 w-4" /> Downloads
              </TabsTrigger>
            </TabsList>

            <TabsContent value="watchlist" className="mt-0">
              {grid(watchlist, 'Nothing saved yet. Use “Add to watchlist” on any title.')}
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              {grid(history, 'Nothing watched yet. Play an episode and it will show up here.')}
            </TabsContent>

            <TabsContent value="favorites" className="mt-0">
              {grid(favorites, 'No favourites yet.')}
            </TabsContent>

            <TabsContent value="downloads" className="mt-0">
              <DownloadsLibrary />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
};

export default Library;
