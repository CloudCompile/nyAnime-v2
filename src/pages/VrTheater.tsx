import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Hls from "hls.js";
import { ArrowLeft, Glasses, Loader2, Play, TriangleAlert } from "lucide-react";
import Header from "../components/Header";
import QuestInstallPrompt from "../components/QuestInstallPrompt";
import { Button } from "@/components/ui/button";
import {
  AnimeApiError,
  getEpisodes,
  getStream,
  type EpisodeSummary,
  type StreamResult,
} from "../services/animeApiService";
import { fetchAnimeByRouteId, useTrendingAnime, type AnimeData } from "../hooks/useAnimeData";
import { getLibrary } from "../services/localLibrary";
import { maybeProxy } from "../lib/stream";
import { enterTheater } from "../vr/theater";

type XrState = "checking" | "supported" | "unsupported";
type Phase = "idle" | "loading" | "ready" | "error";

interface ResumeTarget {
  id: string;
  episode: number;
  title: string;
  image: string;
}

const VrTheater = () => {
  const [searchParams] = useSearchParams();
  const animeId = searchParams.get("id") ?? "";
  const requestedEpisode = Number(searchParams.get("ep") || "1");

  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<XRSession | null>(null);

  const [xr, setXr] = useState<XrState>("checking");
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<AnimeData | null>(null);
  const [episode, setEpisode] = useState<EpisodeSummary | null>(null);
  const [stream, setStream] = useState<StreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [session, setSession] = useState<XRSession | null>(null);

  const { data: trending = [] } = useTrendingAnime();

  const [resume, setResume] = useState<ResumeTarget | null>(null);

  // --- capabilities -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const xrSystem = navigator.xr;
    if (!xrSystem?.isSessionSupported) {
      setXr("unsupported");
      return;
    }
    xrSystem
      .isSessionSupported("immersive-vr")
      .then((supported) => {
        if (!cancelled) setXr(supported ? "supported" : "unsupported");
      })
      .catch(() => {
        if (!cancelled) setXr("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- most recent watch, for the launcher --------------------------------
  useEffect(() => {
    if (animeId) return;
    const entry = getLibrary().history[0];
    if (!entry) return;
    let cancelled = false;
    fetchAnimeByRouteId(String(entry.animeId))
      .then((anime) => {
        if (cancelled || !anime) return;
        setResume({
          id: String(entry.animeId),
          episode: entry.episodeId,
          title: anime.title,
          image: anime.image,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [animeId]);

  // --- resolve the episode and its stream ---------------------------------
  useEffect(() => {
    if (!animeId) {
      setPhase("idle");
      return;
    }
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setStream(null);
    setEpisode(null);

    (async () => {
      const [anime, episodes] = await Promise.all([
        fetchAnimeByRouteId(animeId).catch(() => null),
        getEpisodes(animeId),
      ]);
      if (cancelled) return;
      setInfo(anime);

      const wanted = Number.isFinite(requestedEpisode) ? requestedEpisode : 1;
      const selected = episodes.find((entry) => entry.number === wanted) ?? episodes[0];
      if (!selected) throw new Error("No episodes are available for this title.");
      setEpisode(selected);

      const result = await getStream(selected.key, { type: "sub" });
      if (cancelled) return;
      if (!result.file) {
        throw new Error(
          "This source only offers an embedded player, which cannot be shown in VR. Try another title.",
        );
      }
      setStream(result);
      setPhase("ready");
    })().catch((err) => {
      if (cancelled) return;
      setError(
        err instanceof AnimeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not load this episode.",
      );
      setPhase("error");
    });

    return () => {
      cancelled = true;
    };
  }, [animeId, requestedEpisode]);

  // --- feed hls.js the same proxied manifest the 2D player uses -----------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream?.file) return;

    const source = maybeProxy(stream.file);
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
      });
      // A cinema screen exposes every bit of compression, so start on the best
      // rendition instead of letting ABR ramp up from its 500 kbps default.
      hls.config.capLevelToPlayerSize = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const instance = hls;
        if (!instance || instance.levels.length === 0) return;
        // Manifests are not ordered low-to-high (this one is 1080p, 720p,
        // 480p), so pick the tallest rendition rather than the last one.
        let bestIndex = 0;
        instance.levels.forEach((level, index) => {
          const winner = instance.levels[bestIndex];
          if (
            level.height > winner.height ||
            (level.height === winner.height && level.bitrate > winner.bitrate)
          ) {
            bestIndex = index;
          }
        });
        instance.currentLevel = bestIndex;
      });
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // A frozen frame inside the headset is worse than leaving the room; the
        // page can then show what went wrong.
        setError("The stream stopped. Go back and pick another episode or title.");
        setPhase("error");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
    } else {
      setError("This browser cannot play HLS video.");
    }

    return () => {
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [stream?.file]);

  // End the session if the viewer navigates away mid-experience.
  useEffect(
    () => () => {
      sessionRef.current?.end().catch(() => undefined);
    },
    [],
  );

  const watchOnPageUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (episode) params.set("ep", String(episode.number));
    const query = params.toString();
    return `/anime/${animeId}/watch${query ? `?${query}` : ""}`;
  }, [animeId, episode]);

  const startTheater = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return false;

    setEntering(true);
    setError(null);
    try {
      // requestSession runs synchronously inside enterTheater, so this must be
      // reached without awaiting anything that spends the user activation.
      const handle = await enterTheater(video, { title: info?.title });
      sessionRef.current = handle.session;
      setSession(handle.session);
      handle.session.addEventListener(
        "end",
        () => {
          sessionRef.current = null;
          setSession(null);
          video.pause();
        },
        { once: true },
      );
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not start the theater: ${err.message}`
          : "Could not start the theater. Open this page in the Quest browser and allow VR.",
      );
      return false;
    } finally {
      setEntering(false);
    }
  }, [info?.title]);

  const handleEnter = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !stream?.file) return;
    void video.play().catch(() => undefined);
    await startTheater();
  }, [startTheater, stream?.file]);

  // Launching the installed app counts as the user action WebXR needs, so a
  // Quest library launch opens the theater instead of a 2D panel with a button.
  // The room is entered before the stream resolves; it shows black until the
  // video is attached, which is preferable to losing the activation by awaiting
  // the catalogue first.
  const autoEnterRef = useRef(false);
  useEffect(() => {
    if (autoEnterRef.current) return;
    if (xr !== "supported") return;
    if (!window.matchMedia("(display-mode: standalone)").matches) return;
    const hasTarget = Boolean(animeId) || Boolean(getLibrary().history[0]);
    if (!hasTarget) return;
    autoEnterRef.current = true;
    void startTheater();
  }, [animeId, startTheater, xr]);

  // If the launch happened before the stream was ready, start playback once it
  // is. A trigger press still works if the browser refuses autoplay.
  useEffect(() => {
    if (!session || !stream?.file) return;
    videoRef.current?.play().catch(() => undefined);
  }, [session, stream?.file]);

  // A failed stream is invisible inside the headset, so return to the page
  // where the error is rendered.
  useEffect(() => {
    if (phase === "error" && session) void session.end().catch(() => undefined);
  }, [phase, session]);

  const xrNotice =
    xr === "unsupported" ? (
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          This browser cannot start an immersive VR session. Open this page in the Meta Quest
          browser (or another WebXR-capable headset browser) to use the theater. Everything else
          on NyAnime still works here.
        </p>
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-anime-darker">
      <Header />

      <main className="container mx-auto px-4 pb-16 pt-24 md:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-3 text-2xl font-bold text-white md:text-3xl">
              <Glasses className="h-7 w-7 text-anime-purple" />
              NyAnime VR Theater
            </h1>
            <Button variant="ghost" className="text-white/70 hover:text-white" asChild>
              <Link to="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to browse
              </Link>
            </Button>
          </div>

          {xrNotice}

          {error && (
            <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
              {error}
            </div>
          )}

          {animeId ? (
            <section className="glass-card rounded-2xl p-5 md:p-7">
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="h-56 w-40 shrink-0 overflow-hidden rounded-xl bg-anime-gray/60">
                  {info?.image ? (
                    <img src={info.image} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-white md:text-2xl">
                    {info?.title ?? "Loading title…"}
                  </h2>
                  <p className="mt-1 text-white/70">
                    {episode ? `Episode ${episode.number}` : "Resolving episode…"}
                    {episode?.title && !/^Episode\s*\d+$/i.test(episode.title)
                      ? ` — ${episode.title}`
                      : ""}
                  </p>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button
                      size="lg"
                      onClick={handleEnter}
                      disabled={
                        xr !== "supported" || phase !== "ready" || !stream?.file || entering
                      }
                      className="bg-anime-purple hover:bg-anime-purple/90"
                    >
                      {entering ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Starting…
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-5 w-5" />
                          Enter VR theater
                        </>
                      )}
                    </Button>

                    {session ? (
                      <Button
                        size="lg"
                        variant="secondary"
                        onClick={() => void session.end().catch(() => undefined)}
                      >
                        End VR session
                      </Button>
                    ) : (
                      <Button size="lg" variant="secondary" asChild>
                        <Link to={watchOnPageUrl}>Watch on the page</Link>
                      </Button>
                    )}
                  </div>

                  {phase === "loading" && (
                    <p className="mt-4 flex items-center text-sm text-white/60">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Preparing the stream…
                    </p>
                  )}

                  {session && (
                    <p className="mt-4 text-sm text-white/60">
                      Put on the headset. Trigger toggles play/pause, the thumbstick seeks, and the
                      system menu exits.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <>
              <QuestInstallPrompt />

              {resume && (
                <section className="glass-card mb-8 mt-4 rounded-2xl p-5 md:p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">Continue watching</h2>
                  <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                    <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-anime-gray/60">
                      <img src={resume.image} alt="" className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{resume.title}</p>
                      <p className="text-sm text-white/60">Episode {resume.episode}</p>
                    </div>
                    <Button size="lg" asChild className="bg-anime-purple hover:bg-anime-purple/90">
                      <Link to={`/vr?id=${resume.id}&ep=${resume.episode}`}>
                        <Play className="mr-2 h-5 w-5" />
                        Resume in theater
                      </Link>
                    </Button>
                  </div>
                </section>
              )}

              <section className="mt-6">
                <h2 className="mb-4 text-lg font-semibold text-white">Pick something trending</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {trending.slice(0, 12).map((anime) => (
                    <Link
                      key={anime.id}
                      to={`/vr?id=${anime.id}&ep=1`}
                      className="group relative aspect-[2/3] overflow-hidden rounded-xl bg-anime-gray/60"
                    >
                      <img
                        src={anime.image}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-3">
                        <p className="line-clamp-2 text-sm font-semibold text-white">
                          {anime.title}
                        </p>
                        <p className="mt-0.5 text-xs text-white/60">Episode 1</p>
                      </div>
                    </Link>
                  ))}
                </div>
                {trending.length === 0 && (
                  <p className="text-sm text-white/60">
                    Nothing loaded yet. Open the catalogue and pick a title.
                  </p>
                )}
              </section>
            </>
          )}

          <p className="mt-8 text-xs text-white/40">
            VR needs HTTPS (or localhost) and a WebXR-capable browser. Subtitles are shown in the
            on-page player only for now.
          </p>
        </div>
      </main>

      {/* The player's video element stays in the DOM, off screen, because the
          WebXR scene samples it as a texture. */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        aria-hidden
      />
    </div>
  );
};

export default VrTheater;
