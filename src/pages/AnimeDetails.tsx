import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Check,
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
import { useAnimeDetail, useSimilarAnime, type AnimeData } from '../hooks/useAnimeData';
import { useAnimeCharacters, useAnimeReviews } from '../hooks/useAnimeDetails';
import { getEpisodes, type EpisodeSummary } from '../services/animeApiService';
import { useDownloads } from '../hooks/useDownloads';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { addToWatchlist, getLibrary, isInWatchlist, removeFromWatchlist } from '@/services/localLibrary';

const AnimeDetails = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: anime, isLoading } = useAnimeDetail(id);
  const { data: similar = [] } = useSimilarAnime(id);
  const { data: characters = [] } = useAnimeCharacters(anime?.title ?? '');
  const { data: reviews = [] } = useAnimeReviews(id);
  const { enqueue, ensureFolder } = useDownloads();

  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [savedToWatchlist, setSavedToWatchlist] = useState(false);

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
    if (!id) return;
    setSavedToWatchlist(isInWatchlist(id));
  }, [id]);

  // Resume state and per-episode progress come from the same device library
  // the player writes to, so this page can offer "Continue E4" instead of
  // always starting over at episode one.
  const [history, setHistory] = useState(() => getLibrary().history);

  useEffect(() => {
    const sync = () => setHistory(getLibrary().history);
    window.addEventListener('nyanime:library-changed', sync);
    return () => window.removeEventListener('nyanime:library-changed', sync);
  }, []);

  const seriesIds = useMemo(
    () => new Set([id, anime?.dataId, anime?.id].filter(Boolean).map(String)),
    [id, anime],
  );

  const resume = useMemo(() => {
    const entry = history.find((item) => seriesIds.has(item.animeId));
    if (!entry || entry.progress >= 95 || entry.timestamp < 5) return null;
    return entry;
  }, [history, seriesIds]);

  const progressByEpisode = useMemo(() => {
    const map = new Map<number, { progress: number; timestamp: number }>();
    for (const entry of history) {
      if (!seriesIds.has(entry.animeId) || map.has(entry.episodeId)) continue;
      map.set(entry.episodeId, { progress: entry.progress, timestamp: entry.timestamp });
    }
    return map;
  }, [history, seriesIds]);

  const handleToggleWatchlist = () => {
    if (savedToWatchlist) {
      removeFromWatchlist(id);
      setSavedToWatchlist(false);
      toast({ title: 'Removed from watchlist', description: anime?.title ?? 'Anime removed.' });
      return;
    }
    addToWatchlist(id);
    setSavedToWatchlist(true);
    toast({ title: 'Added to watchlist', description: anime?.title ?? 'Anime added.' });
  };

  const downloadAll = async () => {
    if (!anime || episodes.length === 0) return;
    // Ask for a folder once, while the click still counts as a user gesture.
    await ensureFolder();
    const added = enqueue(anime.title, episodes, { seriesId: id, poster: anime.poster });
    toast({
      title: added > 0 ? `Queued ${added} episodes` : 'Already queued',
      description: added > 0 ? 'Progress and finished files are in the downloads dock.' : undefined,
    });
  };

  const downloadEpisode = async (episode: EpisodeSummary) => {
    if (!anime) return;
    const folder = await ensureFolder();
    const added = enqueue(anime.title, [episode], { seriesId: id, poster: anime.poster });
    toast({
      title: added > 0 ? `Queued episode ${episode.number}` : 'Already queued',
      description:
        added > 0
          ? `Saving to ${folder?.name ?? 'your downloads folder'} — progress is in the downloads dock.`
          : 'That episode is already in the download queue.',
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
                {resume ? (
                  <Button asChild>
                    <Link to={`/anime/${id}/watch?ep=${resume.episodeId}&t=${resume.timestamp}`}>
                      <Play className="mr-2 h-4 w-4" />
                      Continue E{resume.episodeId}
                      {resume.progress > 0 ? ` · ${Math.round(resume.progress)}%` : ''}
                    </Link>
                  </Button>
                ) : (
                  <Button onClick={() => navigate(`/anime/${id}/watch`)}>
                    <Play className="mr-2 h-4 w-4" />
                    Watch now
                  </Button>
                )}
                <Button variant="secondary" onClick={handleToggleWatchlist}>
                  {savedToWatchlist ? (
                    <>
                      <Heart className="mr-2 h-4 w-4" fill="currentColor" />
                      Remove from watchlist
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
                  <div className="glass-card max-h-[32rem] divide-y divide-white/5 overflow-y-auto rounded-xl">
                    {episodes.map((episode) => {
                      // Titles are often just "Episode 3"; only print a title
                      // when it actually says something beyond the number.
                      const cleanTitle = episode.title
                        .replace(/^Episode\s*\d+\s*/i, '')
                        .replace(/^[-\u2013:]\s*/, '')
                        .trim();
                      const watched = progressByEpisode.get(episode.number);
                      const isWatched = Boolean(watched && watched.progress >= 90);
                      const resumeAt =
                        watched && watched.progress > 0 && watched.progress < 90 ? watched : null;
                      const href = `/anime/${id}/watch?ep=${episode.number}${
                        resumeAt ? `&t=${resumeAt.timestamp}` : ''
                      }`;
                      return (
                        <div
                          key={episode.key}
                          className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/5"
                        >
                          <Link to={href} className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/5 text-xs font-semibold text-white/70">
                              {isWatched ? (
                                <Check className="h-4 w-4 text-emerald-400" />
                              ) : (
                                episode.number
                              )}
                              {resumeAt && (
                                <span className="absolute inset-x-1 bottom-1 h-0.5 overflow-hidden rounded bg-white/15">
                                  <span
                                    className="block h-full rounded bg-anime-purple"
                                    style={{ width: `${resumeAt.progress}%` }}
                                  />
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-white">
                                {cleanTitle
                                  ? `${episode.number}. ${cleanTitle}`
                                  : `Episode ${episode.number}`}
                              </span>
                              <span className="block text-[11px] text-white/40">
                                {isWatched
                                  ? 'Watched'
                                  : resumeAt
                                    ? `${Math.round(resumeAt.progress)}% watched`
                                    : 'Not started'}
                              </span>
                            </span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => void downloadEpisode(episode)}
                            aria-label={`Download episode ${episode.number}`}
                            title="Download this episode"
                            className="rounded-md p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <Button size="sm" variant="secondary" asChild>
                            <Link to={href} aria-label={`Play episode ${episode.number}`}>
                              <Play className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      );
                    })}
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
