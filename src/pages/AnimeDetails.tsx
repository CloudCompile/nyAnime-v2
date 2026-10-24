import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  Heart,
  List,
  Play,
  PlusCircle,
  Star,
} from 'lucide-react';
import Header from '../components/Header';
import CategoryRow from '../components/CategoryRow';
import DownloadPanel from '../components/DownloadPanel';
import { useAnimeDetail, useSimilarAnime, type AnimeData } from '../hooks/useAnimeData';
import { useAnimeCharacters, useAnimeReviews } from '../hooks/useAnimeDetails';
import { getEpisodes, type EpisodeSummary } from '../services/animeApiService';
import { useDownloads } from '../hooks/useDownloads';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { addToWatchlist, getCurrentUserData, getUserData } from '@/services/authService';

const AnimeDetails = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: anime, isLoading } = useAnimeDetail(id);
  const { data: similar = [] } = useSimilarAnime(id);
  const { data: characters = [] } = useAnimeCharacters(anime?.title ?? '');
  const { data: reviews = [] } = useAnimeReviews(id);
  const { enqueue } = useDownloads();

  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getEpisodes(id)
      .then((list) => {
        if (!cancelled) setEpisodes(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const user = getCurrentUserData();
    if (!user) return;
    let cancelled = false;
    getUserData(user.id)
      .then((data) => {
        if (cancelled) return;
        setIsInWatchlist(data.watchlist.some((item) => String(item.animeId) === id));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleAddToWatchlist = async () => {
    const user = getCurrentUserData();
    if (!user) {
      toast({ title: 'Sign in required', description: 'Please sign in to use your watchlist.' });
      navigate('/signin');
      return;
    }
    setIsAdding(true);
    try {
      await addToWatchlist(user.id, id);
      setIsInWatchlist(true);
      toast({ title: 'Added to watchlist', description: anime?.title ?? 'Anime added.' });
    } catch (error) {
      toast({
        title: 'Could not update watchlist',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const downloadAll = () => {
    if (!anime || episodes.length === 0) return;
    const added = enqueue(anime.title, episodes);
    toast({
      title: added > 0 ? `Queued ${added} episodes` : 'Already queued',
      description: added > 0 ? 'Track progress in the downloads panel.' : undefined,
    });
  };

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-anime-darker">
        <Header />
        <div className="flex min-h-[60vh] items-center justify-center text-white/70">
          Loading anime…
        </div>
      </div>
    );
  }

  if (!anime) {
    return (
      <div className="min-h-screen bg-anime-darker">
        <Header />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-white/80">This anime could not be found in the catalogue.</p>
          <Button onClick={() => navigate('/')}>Back to home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <section className="relative h-[45vh] w-full overflow-hidden md:h-[55vh]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to bottom, rgba(13,13,21,0.4), rgba(13,13,21,0.95)), url('${anime.poster ?? ''}')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 flex items-end">
          <div className="container mx-auto flex gap-6 px-4 pb-8 md:px-6">
            <img
              src={anime.poster}
              alt={anime.title}
              className="hidden w-40 rounded-lg shadow-lg md:block"
            />
            <div className="max-w-3xl">
              <Button variant="ghost" className="mb-3 text-white/80 hover:text-white" asChild>
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Home
                </Link>
              </Button>
              <h1 className="mb-2 text-3xl font-bold text-white md:text-4xl">{anime.title}</h1>
              {anime.japaneseTitle && (
                <p className="mb-3 text-sm text-white/60">{anime.japaneseTitle}</p>
              )}
              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-white/80">
                {anime.score && (
                  <span className="flex items-center gap-1">
                    <Star className="h-4 w-4 text-yellow-400" fill="currentColor" />
                    {anime.score}
                  </span>
                )}
                {anime.premiered && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {anime.premiered}
                  </span>
                )}
                {anime.duration && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {anime.duration}
                  </span>
                )}
                {anime.totalEpisodes && (
                  <span className="flex items-center gap-1">
                    <List className="h-4 w-4" />
                    {anime.totalEpisodes} episodes
                  </span>
                )}
                {anime.status && <span>{anime.status}</span>}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => navigate(`/anime/${id}/watch`)}>
                  <Play className="mr-2 h-4 w-4" />
                  Watch now
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleAddToWatchlist}
                  disabled={isAdding || isInWatchlist}
                >
                  {isInWatchlist ? (
                    <>
                      <Heart className="mr-2 h-4 w-4" fill="currentColor" />
                      In watchlist
                    </>
                  ) : (
                    <>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add to watchlist
                    </>
                  )}
                </Button>
                <Button variant="secondary" onClick={downloadAll} disabled={episodes.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Download all
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-4 py-8 md:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="episodes">Episodes</TabsTrigger>
                <TabsTrigger value="characters">Characters</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-6 space-y-6">
                {anime.description && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">
                    {anime.description}
                  </p>
                )}
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  {anime.genres && anime.genres.length > 0 && (
                    <div>
                      <dt className="text-white/50">Genres</dt>
                      <dd className="text-white/90">{anime.genres.join(', ')}</dd>
                    </div>
                  )}
                  {anime.studios && anime.studios.length > 0 && (
                    <div>
                      <dt className="text-white/50">Studio</dt>
                      <dd className="text-white/90">{anime.studios.join(', ')}</dd>
                    </div>
                  )}
                  {anime.aired && (
                    <div>
                      <dt className="text-white/50">Aired</dt>
                      <dd className="text-white/90">{anime.aired}</dd>
                    </div>
                  )}
                  {anime.type && (
                    <div>
                      <dt className="text-white/50">Type</dt>
                      <dd className="text-white/90">{anime.type}</dd>
                    </div>
                  )}
                </dl>
              </TabsContent>

              <TabsContent value="episodes" className="mt-6">
                {episodes.length === 0 ? (
                  <p className="text-sm text-white/60">No episodes listed yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {episodes.map((episode) => (
                      <Button
                        key={episode.key}
                        variant="secondary"
                        className="justify-start"
                        onClick={() => navigate(`/anime/${id}/watch?ep=${episode.number}`)}
                      >
                        {episode.number}. {episode.title.replace(/^Episode \d+$/, '').trim() || 'Episode'}
                      </Button>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="characters" className="mt-6">
                {characters.length === 0 ? (
                  <p className="text-sm text-white/60">No character data available.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {characters.map((character) => (
                      <div key={character.id} className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={character.image} alt={character.name} />
                          <AvatarFallback>{character.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">{character.name}</p>
                          <p className="text-xs text-white/50">{character.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <aside className="space-y-5">
            <DownloadPanel />
            {reviews.length > 0 && (
              <section className="glass-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Reviews</h2>
                <p className="text-xs text-white/60">{reviews.length} reviews</p>
              </section>
            )}
          </aside>
        </div>

        {similar.length > 0 && (
          <div className="mt-10">
            <CategoryRow title="You might also like" animeList={asCardList(similar)} />
          </div>
        )}
      </main>
    </div>
  );
};

export default AnimeDetails;
