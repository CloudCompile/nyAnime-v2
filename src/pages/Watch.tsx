import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  List,
  Loader2,
  Server,
} from 'lucide-react';
import Header from '../components/Header';
import HlsPlayer from '../components/HlsPlayer';
import DownloadPanel from '../components/DownloadPanel';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  AnimeApiError,
  getAnimeInfo,
  getEpisodes,
  getStream,
  type AnimeDetail,
  type EpisodeSummary,
  type ServerOption,
  type StreamResult,
} from '../services/animeApiService';
import { useDownloads } from '../hooks/useDownloads';
import { resolveSlug } from '../hooks/useAnimeData';
import { rememberSlug } from '../lib/animeIds';
import { getCurrentUserData, updateWatchHistory } from '../services/authService';

const Watch = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { enqueue, options, setOptions, jobs } = useDownloads();

  const episodeParam = Number(searchParams.get('ep') || '1');
  const [anime, setAnime] = useState<AnimeDetail | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [episodeNumber, setEpisodeNumber] = useState(Number.isFinite(episodeParam) ? episodeParam : 1);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serverName, setServerName] = useState<string>('');
  const [trackType, setTrackType] = useState<'sub' | 'dub'>('sub');
  const [stream, setStream] = useState<StreamResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEpisodeList, setShowEpisodeList] = useState(false);
  const [downloadRange, setDownloadRange] = useState({ from: 1, to: 1 });

  const currentEpisode = useMemo(
    () => episodes.find((episode) => episode.number === episodeNumber) ?? episodes[0] ?? null,
    [episodes, episodeNumber],
  );

  // Load metadata and the episode list once per series.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // `/api/info` only resolves catalogue slugs, while the route id is the
        // numeric id used by history and the watchlist. Episodes and streams
        // accept either, so only the metadata lookup needs the resolved slug.
        const slug = (await resolveSlug(id)) ?? id;
        const [info, episodeList] = await Promise.all([getAnimeInfo(slug), getEpisodes(id)]);
        if (cancelled) return;
        setAnime(info);
        setEpisodes(episodeList);
        rememberSlug(info?.dataId, info?.id || slug);
        if (info) document.title = `${info.title} — NyAnime`;
        if (episodeList.length > 0) {
          setDownloadRange({ from: 1, to: episodeList.length });
          const wanted = Number(searchParams.get('ep') || '1');
          const valid = episodeList.some((episode) => episode.number === wanted);
          setEpisodeNumber(valid ? wanted : (episodeList[0]?.number ?? 1));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof AnimeApiError ? err.message : 'Could not load this anime.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `searchParams` is intentionally excluded: the episode is tracked in state
    // and the URL is updated from it, so depending on it here would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Resolve the stream whenever the episode, server or track type changes.
  useEffect(() => {
    if (!currentEpisode) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      setStream(null);
      try {
        const result = await getStream(
          currentEpisode.key,
          { server: serverName || undefined, type: trackType },
          controller.signal,
        );
        if (cancelled) return;
        setStream(result);
        if (result.servers.length > 0) setServers(result.servers);
        if (result.server && !serverName) setServerName(result.server);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof AnimeApiError
            ? err.message
            : 'This episode could not be loaded. Try another server.',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentEpisode, serverName, trackType]);

  const selectEpisode = useCallback(
    (number: number) => {
      setEpisodeNumber(number);
      setShowEpisodeList(false);
      const next = new URLSearchParams(searchParams);
      next.set('ep', String(number));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleProgress = useCallback(
    (seconds: number, duration: number) => {
      if (!anime || duration <= 0) return;
      const user = getCurrentUserData();
      if (!user) return;
      void updateWatchHistory(
        user.id,
        anime.dataId,
        episodeNumber,
        Math.round((seconds / duration) * 100),
        Math.round(seconds),
      ).catch(() => undefined);
    },
    [anime, episodeNumber],
  );

  const downloadEpisodes = (list: EpisodeSummary[]) => {
    if (!anime || list.length === 0) return;
    const added = enqueue(anime.title, list);
    toast({
      title: added > 0 ? `Queued ${added} episode${added === 1 ? '' : 's'}` : 'Already queued',
      description:
        added > 0
          ? `Downloading to ${options.directory?.name ?? 'your chosen location'}`
          : 'Those episodes are already in the download queue.',
    });
  };

  const handleDownloadCurrent = () => {
    if (currentEpisode) downloadEpisodes([currentEpisode]);
  };

  const handleDownloadRange = () => {
    const from = Math.min(downloadRange.from, downloadRange.to);
    const to = Math.max(downloadRange.from, downloadRange.to);
    downloadEpisodes(episodes.filter((episode) => episode.number >= from && episode.number <= to));
  };

  const serverOptions = servers.filter((server) => server.type === trackType);
  const hasDub = servers.some((server) => server.type === 'dub');
  const canPrev = currentEpisode && episodes.some((episode) => episode.number === episodeNumber - 1);
  const canNext = currentEpisode && episodes.some((episode) => episode.number === episodeNumber + 1);
  const embedOnly = Boolean(stream && !stream.file && stream.iframe);

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main className="container mx-auto px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="ghost" className="text-white/80 hover:text-white" asChild>
            <Link to={`/anime/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to details
            </Link>
          </Button>
          {anime && (
            <h1 className="text-lg font-semibold text-white md:text-xl">
              {anime.title}
              <span className="ml-2 text-white/60">Episode {episodeNumber}</span>
            </h1>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {error ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black">
                <div className="max-w-md px-6 text-center">
                  <p className="text-white/80">{error}</p>
                  <Button
                    className="mt-4"
                    variant="secondary"
                    onClick={() => setServerName('')}
                  >
                    Retry with the default server
                  </Button>
                </div>
              </div>
            ) : embedOnly && stream?.iframe ? (
              // Some servers only offer an embed page. It cannot be proxied or
              // downloaded, so it is shown as-is with an escape hatch.
              <div className="space-y-3">
                <iframe
                  src={stream.iframe}
                  className="aspect-video w-full rounded-xl bg-black"
                  allowFullScreen
                  allow="autoplay; encrypted-media; picture-in-picture"
                />
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <span>
                    {stream.server} only offers an embedded player, which cannot be downloaded.
                    Choose <strong>Vidplay</strong> for a direct stream.
                  </span>
                  <a
                    className="inline-flex items-center gap-1 text-anime-purple hover:underline"
                    href={stream.iframe}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                </div>
              </div>
            ) : isLoading && !stream ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black">
                <Loader2 className="h-8 w-8 animate-spin text-anime-purple" />
              </div>
            ) : stream?.file ? (
              <HlsPlayer
                src={stream.file}
                poster={anime?.poster}
                autoPlay
                onProgress={handleProgress}
                onEnded={() => canNext && selectEpisode(episodeNumber + 1)}
                subtitles={stream.tracks}
                intro={stream.intro}
                outro={stream.outro}
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black">
                <p className="text-white/70">No playable stream for this episode.</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canPrev}
                onClick={() => selectEpisode(episodeNumber - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowEpisodeList((value) => !value)}
              >
                <List className="mr-1 h-4 w-4" />
                Episodes
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canNext}
                onClick={() => selectEpisode(episodeNumber + 1)}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
              <div className="flex-1" />
              <Button size="sm" onClick={handleDownloadCurrent} disabled={!currentEpisode}>
                <Download className="mr-1 h-4 w-4" />
                Download episode
              </Button>
            </div>

            {showEpisodeList && episodes.length > 0 && (
              <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
                  {episodes.map((episode) => (
                    <button
                      key={episode.key}
                      onClick={() => selectEpisode(episode.number)}
                      className={`rounded px-2 py-1 text-sm transition-colors ${
                        episode.number === episodeNumber
                          ? 'bg-anime-purple text-white'
                          : 'bg-white/5 text-white/80 hover:bg-white/15'
                      }`}
                      title={episode.title}
                    >
                      {episode.number}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            {/* Servers */}
            <section className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Server className="h-4 w-4" />
                Servers
              </h2>

              {hasDub && (
                <div className="mb-3 flex gap-2">
                  {(['sub', 'dub'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setTrackType(type);
                        setServerName('');
                      }}
                      className={`flex-1 rounded px-3 py-1.5 text-sm capitalize transition-colors ${
                        trackType === type
                          ? 'bg-anime-purple text-white'
                          : 'bg-white/5 text-white/70 hover:bg-white/15'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {serverOptions.length === 0 && (
                  <p className="text-xs text-white/50">No servers listed for this episode.</p>
                )}
                {serverOptions.map((server) => (
                  <button
                    key={`${server.type}-${server.serverName}`}
                    onClick={() => setServerName(server.serverName)}
                    className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm transition-colors ${
                      serverName === server.serverName
                        ? 'bg-anime-purple/20 text-anime-purple'
                        : 'bg-white/5 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    <span>{server.serverName}</span>
                    {serverName === server.serverName && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </section>

            {/* Downloads */}
            <section className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Download className="h-4 w-4" />
                Batch download
              </h2>
              <div className="flex items-end gap-2">
                <label className="flex-1 text-xs text-white/60">
                  From
                  <input
                    type="number"
                    min={1}
                    max={episodes.length || 1}
                    value={downloadRange.from}
                    onChange={(event) =>
                      setDownloadRange((range) => ({ ...range, from: Number(event.target.value) }))
                    }
                    className="mt-1 w-full rounded bg-black/40 px-2 py-1 text-sm text-white"
                  />
                </label>
                <label className="flex-1 text-xs text-white/60">
                  To
                  <input
                    type="number"
                    min={1}
                    max={episodes.length || 1}
                    value={downloadRange.to}
                    onChange={(event) =>
                      setDownloadRange((range) => ({ ...range, to: Number(event.target.value) }))
                    }
                    className="mt-1 w-full rounded bg-black/40 px-2 py-1 text-sm text-white"
                  />
                </label>
                <Button size="sm" onClick={handleDownloadRange} disabled={episodes.length === 0}>
                  Add
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/60">
                <label>
                  Format
                  <select
                    value={options.format}
                    onChange={(event) =>
                      setOptions({ format: event.target.value as 'mp4' | 'ts' })
                    }
                    className="mt-1 w-full rounded bg-black/40 px-2 py-1 text-sm text-white"
                  >
                    <option value="mp4">MP4 (playable)</option>
                    <option value="ts">TS (raw stream)</option>
                  </select>
                </label>
                <label>
                  Quality
                  <select
                    value={options.quality}
                    onChange={(event) => setOptions({ quality: Number(event.target.value) })}
                    className="mt-1 w-full rounded bg-black/40 px-2 py-1 text-sm text-white"
                  >
                    <option value={1080}>1080p</option>
                    <option value={720}>720p</option>
                    <option value={480}>480p</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-white/40">
                Sources are 720p in practice; the closest available quality is used.
              </p>
            </section>

            <DownloadPanel />
          </aside>
        </div>
      </main>

      {jobs.length > 0 && (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 lg:hidden">
          <div className="pointer-events-auto mx-4 mb-4 rounded-lg bg-black/80 p-2 text-xs text-white">
            {jobs.filter((job) => job.status === 'running').length} downloading
          </div>
        </div>
      )}
    </div>
  );
};

export default Watch;
