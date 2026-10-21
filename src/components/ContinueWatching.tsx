import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, ChevronRight, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { getUserData, removeFromWatchHistory } from '@/services/authService';
import { fetchAnimeByRouteId } from '@/hooks/useAnimeData';
import { toast } from '@/hooks/use-toast';

interface WatchProgressItem {
  id: string;
  title: string;
  image: string;
  episode: number;
  totalEpisodes: number;
  progress: number;
  timestamp: number;
  lastWatched: string;
}

function formatLastWatched(date: Date): string {
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Continue Watching reads the stored history, then resolves each entry's title
 * and artwork from the catalogue. Only the visible slice is resolved, so the
 * section costs at most a handful of requests.
 */
const ContinueWatching = () => {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [watchProgress, setWatchProgress] = useState<WatchProgressItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    setIsLoggedIn(!!storedUserId);
    setUserId(storedUserId);
    if (!storedUserId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const userData = await getUserData(storedUserId);
        const recent = userData.history.slice(0, 4);
        const resolved = await Promise.all(
          recent.map(async (item): Promise<WatchProgressItem> => {
            const anime = await fetchAnimeByRouteId(String(item.animeId)).catch(() => null);
            return {
              id: String(item.animeId),
              title: anime?.title ?? `Anime ${item.animeId}`,
              image: anime?.image || '/placeholder.svg',
              episode: item.episodeId,
              totalEpisodes: anime?.episodes ?? 0,
              progress: item.progress,
              timestamp: item.timestamp,
              lastWatched: formatLastWatched(new Date(item.lastWatched)),
            };
          }),
        );
        if (!cancelled) setWatchProgress(resolved);
      } catch (error) {
        console.error('Error fetching watch history:', error);
        if (!cancelled) setWatchProgress([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRemoveItem = async (animeId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!userId) {
      toast({
        title: 'Error',
        description: 'You must be logged in to remove items',
        variant: 'destructive',
      });
      return;
    }
    try {
      await removeFromWatchHistory(userId, animeId);
      setWatchProgress((prev) => prev.filter((item) => item.id !== animeId));
      toast({ title: 'Removed', description: 'Item removed from your continue watching list' });
    } catch (error) {
      console.error('Error removing item:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove item. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const formatTimeFromSeconds = (seconds: number): string => {
    if (!seconds) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  };

  const watchUrl = (item: WatchProgressItem) =>
    `/anime/${item.id}/watch?ep=${item.episode}&t=${item.timestamp}`;

  if (!isLoggedIn || (watchProgress.length === 0 && !isLoading)) return null;

  return (
    <section className="py-6">
      <div className="container mx-auto px-4 md:px-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center">
            <div className="mr-3 h-6 w-2 rounded-full bg-anime-purple" />
            <h2 className="text-xl font-semibold text-white">Continue Watching</h2>
          </div>
          <a href="/profile" className="flex items-center text-sm text-anime-purple hover:underline">
            View All <ChevronRight className="h-4 w-4" />
          </a>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {watchProgress.map((item) => (
            <div
              key={`${item.id}-${item.episode}`}
              className="glass-card relative cursor-pointer overflow-hidden rounded-xl transition-transform hover:scale-[1.02]"
              onClick={() => navigate(watchUrl(item))}
            >
              <div className="relative h-32 overflow-hidden">
                <img src={item.image} alt={item.title} className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <h3 className="line-clamp-1 text-sm font-medium text-white">{item.title}</h3>
                  <p className="text-xs text-white/70">
                    Episode {item.episode}
                    {item.totalEpisodes > 0 ? ` of ${item.totalEpisodes}` : ''}
                  </p>
                </div>
                <div className="absolute right-2 top-2 flex space-x-2">
                  <Button
                    size="sm"
                    className="h-8 w-8 rounded-full bg-red-500/80 p-0 hover:bg-red-500"
                    onClick={(event) => handleRemoveItem(item.id, event)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 w-8 rounded-full bg-anime-purple p-0 hover:bg-anime-purple/90"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(watchUrl(item));
                    }}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="p-3 pt-0">
                <div className="mb-2 flex items-center justify-between text-xs text-white/60">
                  <span>{Math.round(item.progress)}% completed</span>
                  <span className="flex items-center">
                    <span className="mr-2">{formatTimeFromSeconds(item.timestamp)}</span>
                    <span>{item.lastWatched}</span>
                  </span>
                </div>
                <Progress value={item.progress} className="h-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ContinueWatching;
