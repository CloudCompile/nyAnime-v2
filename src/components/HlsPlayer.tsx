import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls, { type Level } from 'hls.js';
import {
  Captions,
  FastForward,
  Glasses,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Rewind,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SubtitleTrack } from '../services/animeApiService';
import { maybeProxy } from '../lib/stream';
import { looksLikeVtt, shiftVtt } from '../lib/subtitles';

export interface HlsPlayerProps {
  /** Master playlist URL. CDN links are proxied automatically. */
  src: string;
  /** Poster image shown before playback starts. */
  poster?: string;
  /** Resume position in seconds. */
  initialProgress?: number;
  autoPlay?: boolean;
  /** Called with the current position, throttled to a few seconds. */
  onProgress?: (seconds: number, duration: number) => void;
  onEnded?: () => void;
  /** Label of the episode queued after this one, e.g. "Episode 5". */
  nextUpLabel?: string;
  /** Play the next episode; enables the end-of-episode countdown. */
  onNext?: () => void;
  subtitles?: SubtitleTrack[];
  /** Intro/outro windows in seconds, when the source advertises them. */
  intro?: number[];
  outro?: number[];
  /** Subtitle delay persisted for this series, in seconds. */
  initialSubtitleDelay?: number;
  /** Called when the viewer changes the subtitle delay. */
  onSubtitleDelayChange?: (seconds: number) => void;
  /** Shown on the theater marquee. */
  theaterTitle?: string;
}

const PROGRESS_REPORT_INTERVAL_MS = 5000;
const CONTROLS_HIDE_DELAY_MS = 2800;
const DELAY_STEP_SECONDS = 0.25;
const NEXT_UP_SECONDS = 10;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
};

/**
 * A deliberately small HLS player: one `<video>` element, hls.js when the
 * browser needs it, and plain controls. No skins and no animation library —
 * the UI stays cheap to render so it also behaves on the Intel integrated
 * graphics of an older laptop.
 *
 * Subtitles are loaded by the player rather than handed to the `<video>` as a
 * `<track>` element, because scraped cue files are authored against a
 * different encode than the one being streamed and need a fixed retiming
 * offset. The file is fetched once, shifted, and re-emitted as a blob URL.
 */
const HlsPlayer: React.FC<HlsPlayerProps> = ({
  src,
  poster,
  initialProgress = 0,
  autoPlay = false,
  onProgress,
  onEnded,
  nextUpLabel,
  onNext,
  subtitles = [],
  intro = [],
  outro = [],
  initialSubtitleDelay = 0,
  onSubtitleDelayChange,
  theaterTitle,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastReportRef = useRef(0);
  const appliedProgressRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Changes force a fresh attach after a fatal error; without it the error
  // screen was a dead end.
  const [reloadToken, setReloadToken] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [levels, setLevels] = useState<{ height: number; index: number }[]>([]);
  const [activeLevel, setActiveLevel] = useState(-1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [activeSubtitle, setActiveSubtitle] = useState(0);
  const [subtitleDelay, setSubtitleDelay] = useState(initialSubtitleDelay);
  const [rawVtt, setRawVtt] = useState<string | null>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [theaterBusy, setTheaterBusy] = useState(false);
  const [theaterError, setTheaterError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [pipSupported, setPipSupported] = useState(false);
  const [showNextUp, setShowNextUp] = useState(false);
  const [nextUpCountdown, setNextUpCountdown] = useState(NEXT_UP_SECONDS);
  // Preloaded so the VR click can request the session synchronously, without
  // an intervening `await import()` that could spend the user activation.
  const theaterModuleRef = useRef<typeof import('../vr/theater') | null>(null);

  const playableSrc = useMemo(() => maybeProxy(src), [src]);

  // Picture-in-picture is a browser capability, not a given; the control only
  // exists where the API does.
  useEffect(() => {
    setPipSupported(Boolean(document.pictureInPictureEnabled));
  }, []);

  const subtitleTracks = useMemo(
    () =>
      subtitles
        .filter((track) => track.file)
        .map((track, index) => ({
          url: maybeProxy(track.file),
          label: track.label || `Track ${index + 1}`,
        })),
    [subtitles],
  );

  // --- media source -------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playableSrc) return;

    setIsLoading(true);
    setError(null);
    appliedProgressRef.current = false;

    let networkErrors = 0;
    let mediaErrors = 0;

    if (Hls.isSupported()) {
      const hls = new Hls({
        // A modest buffer keeps memory bounded; a whole episode is never held.
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.loadSource(playableSrc);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLevels(
          data.levels.map((level: Level, index: number) => ({
            height: level.height,
            index,
          })),
        );
        setIsLoading(false);
        if (autoPlay) void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => setActiveLevel(data.level));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // A network error usually means the proxy could not reach the CDN, and
        // hls.js can recover from it; a media error cannot be recovered.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Retrying forever hid an unreachable CDN behind an endless spinner.
          if (networkErrors < 2) {
            networkErrors += 1;
            hls.startLoad();
            return;
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaErrors < 2) {
            mediaErrors += 1;
            hls.recoverMediaError();
            return;
          }
        }
        setError('This stream could not be played. Try another server.');
        setIsLoading(false);
        hls.destroy();
        hlsRef.current = null;
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari plays HLS natively, but the proxied manifest is still needed for
      // CORS, so the same URL is used either way.
      video.src = playableSrc;
    } else {
      setError('This browser cannot play HLS video.');
      setIsLoading(false);
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [playableSrc, autoPlay, reloadToken]);

  // --- subtitles ----------------------------------------------------------
  // Fetch the raw cue file whenever the track changes, and switch subtitles on
  // as soon as a usable one arrives: a viewer who opened the player to read
  // subtitles should not have to find the toggle first.
  useEffect(() => {
    const track = subtitleTracks[activeSubtitle];
    if (!track) {
      setRawVtt(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setRawVtt(null);

    (async () => {
      try {
        const response = await fetch(track.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (cancelled) return;
        if (!looksLikeVtt(text)) throw new Error('not WebVTT');
        setRawVtt(text);
        setSubtitlesEnabled(true);
      } catch {
        if (cancelled) return;
        setRawVtt(null);
        setSubtitlesEnabled(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [subtitleTracks, activeSubtitle]);

  // Re-emit the shifted file whenever the delay changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (!rawVtt || !subtitlesEnabled) return;

    const blobUrl = URL.createObjectURL(
      new Blob([shiftVtt(rawVtt, subtitleDelay)], { type: 'text/vtt' }),
    );
    blobUrlRef.current = blobUrl;

    const element = document.createElement('track');
    element.kind = 'subtitles';
    element.label = subtitleTracks[activeSubtitle]?.label ?? 'Subtitles';
    element.src = blobUrl;
    element.default = true;
    video.appendChild(element);
    const native = video.textTracks[video.textTracks.length - 1];
    if (native) native.mode = 'showing';

    return () => {
      element.remove();
    };
  }, [rawVtt, subtitleDelay, subtitlesEnabled, subtitleTracks, activeSubtitle]);

  // Blob URLs are process-wide; release the last one on unmount.
  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    },
    [],
  );

  // --- controls visibility ------------------------------------------------
  const hideControls = useCallback(() => {
    const video = videoRef.current;
    // Keep the bar up while paused: hiding it would leave no way to resume
    // without a stray click, which reads as a frozen player.
    if (video && !video.paused) setControlsVisible(false);
  }, []);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(hideControls, CONTROLS_HIDE_DELAY_MS);
  }, [hideControls]);

  // Only WebXR-capable browsers get the VR control, and only they pay for
  // loading the three.js theater chunk.
  useEffect(() => {
    let cancelled = false;
    const xr = navigator.xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported('immersive-vr')
      .then((supported) => {
        if (cancelled || !supported) return;
        setXrSupported(true);
        void import('../vr/theater')
          .then((module) => {
            if (!cancelled) theaterModuleRef.current = module;
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnterTheater = useCallback(async () => {
    const video = videoRef.current;
    if (!video || theaterBusy) return;
    setTheaterBusy(true);
    setTheaterError(null);
    try {
      const module = theaterModuleRef.current ?? (await import('../vr/theater'));
      const handle = await module.enterTheater(video, { title: theaterTitle });
      handle.session.addEventListener('end', () => setTheaterBusy(false), { once: true });
    } catch {
      setTheaterBusy(false);
      setTheaterError('Could not start the VR session. Open this page in the Quest browser.');
    }
  }, [theaterBusy, theaterTitle]);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await container.requestFullscreen().catch(() => undefined);
    bumpControls();
  }, [bumpControls]);

  const handleEnded = useCallback(() => {
    if (onNext) {
      setNextUpCountdown(NEXT_UP_SECONDS);
      setShowNextUp(true);
      return;
    }
    onEnded?.();
  }, [onEnded, onNext]);

  // The only timer in the player, and it runs only in the ten seconds between
  // one episode ending and the next starting.
  useEffect(() => {
    if (!showNextUp) return;
    if (nextUpCountdown <= 0) {
      setShowNextUp(false);
      onNext?.();
      return;
    }
    const timer = window.setTimeout(() => setNextUpCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [showNextUp, nextUpCountdown, onNext]);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // The browser can refuse while a stream is loading; nothing to report.
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      bumpControls();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [bumpControls]);

  // Any interaction reveals the bar; the timer is only armed while playing, so
  // a paused player never hides it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reveal = () => bumpControls();
    const events: (keyof HTMLElementEventMap)[] = ['mousemove', 'pointerdown', 'touchstart'];
    events.forEach((event) => video.addEventListener(event, reveal));
    video.addEventListener('keydown', reveal);
    return () => {
      events.forEach((event) => video.removeEventListener(event, reveal));
      video.removeEventListener('keydown', reveal);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [bumpControls]);

  useEffect(() => {
    if (!isPlaying) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
      return;
    }
    bumpControls();
  }, [isPlaying, bumpControls]);

  // Keyboard: space/enter toggles playback, arrows seek, and the usual
  // fullscreen keys work inside the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      // Arrow keys inside the quality or speed menu belong to that menu.
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      if (event.key === ' ' || event.key === 'k') {
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      } else if (event.key === 'ArrowRight') {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
      } else if (event.key === 'ArrowLeft') {
        video.currentTime = Math.max(0, video.currentTime - 10);
      } else if (event.key === 'ArrowUp') {
        video.muted = false;
        video.volume = Math.min(1, video.volume + 0.1);
        setIsMuted(false);
      } else if (event.key === 'ArrowDown') {
        video.volume = Math.max(0, video.volume - 0.1);
      } else if (event.key === 'm') {
        video.muted = !video.muted;
        setIsMuted(video.muted);
      } else if (event.key === 'f') {
        void toggleFullscreen();
      } else if (event.key === 'c') {
        setSubtitlesEnabled((value) => !value);
      } else {
        return;
      }
      event.preventDefault();
      bumpControls();
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [bumpControls, toggleFullscreen]);

  // --- handlers -----------------------------------------------------------
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    // A new source resets the element's rate, so re-apply the chosen one.
    video.playbackRate = playbackRate;
    // Seeking before the media is ready is ignored, so this runs once here.
    if (!appliedProgressRef.current && initialProgress > 1 && initialProgress < video.duration - 5) {
      video.currentTime = initialProgress;
      appliedProgressRef.current = true;
    }
    setIsLoading(false);
  }, [initialProgress, playbackRate]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    const now = Date.now();
    if (onProgress && now - lastReportRef.current > PROGRESS_REPORT_INTERVAL_MS) {
      lastReportRef.current = now;
      onProgress(video.currentTime, video.duration || 0);
    }
  }, [onProgress]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    bumpControls();
  }, [bumpControls]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    bumpControls();
  }, [bumpControls]);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      setCurrentTime(seconds);
      bumpControls();
    },
    [bumpControls],
  );

  const skip = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
      bumpControls();
    },
    [bumpControls],
  );

  const nudgeDelay = useCallback(
    (delta: number) => {
      setSubtitleDelay((value) => {
        const next = Math.round((value + delta) * 100) / 100;
        onSubtitleDelayChange?.(next);
        return next;
      });
    },
    [onSubtitleDelayChange],
  );

  const handleScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(Number(event.target.value));
  };

  // The intro window is advertised as [start, end]; the button appears only
  // while playback is inside it.
  const introWindow = intro.length >= 2 ? intro : null;
  const inIntro = introWindow
    ? currentTime >= (introWindow[0] ?? 0) && currentTime < (introWindow[1] ?? 0)
    : false;

  const outroWindow = outro.length >= 2 ? outro : null;
  const inOutro = outroWindow
    ? currentTime >= (outroWindow[0] ?? 0) && currentTime < (outroWindow[1] ?? 0)
    : false;

  // Skipping the credits is the same event as reaching the end: stop, then
  // offer the next episode through the same countdown.
  const skipCredits = () => {
    videoRef.current?.pause();
    handleEnded();
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const showBar = controlsVisible || !isPlaying;

  if (error) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-black">
        <p className="px-6 text-center text-sm text-white/80">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setIsLoading(true);
            setReloadToken((token) => token + 1);
          }}
          className="rounded-md bg-anime-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-anime-purple/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`group/player relative w-full aspect-video overflow-hidden rounded-xl bg-black outline-none ${
        showBar ? '' : 'cursor-none'
      }`}
    >
      <video
        ref={videoRef}
        poster={poster}
        className="w-full h-full"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleLoadedMetadata}
        onPlay={() => {
          setIsPlaying(true);
          setShowNextUp(false);
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onEnded={handleEnded}
      />

      {theaterError && (
        <div className="absolute left-3 top-3 z-20 rounded-md bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white">
          {theaterError}
        </div>
      )}

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      )}

      {(inIntro || inOutro) && (
        <div className="absolute bottom-24 right-4 z-20 flex flex-col items-end gap-2">
          {inIntro && introWindow && (
            <button
              className="rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white"
              onClick={() => seekTo(introWindow[1] ?? currentTime)}
            >
              <SkipForward className="mr-1 inline h-4 w-4" />
              Skip intro
            </button>
          )}
          {inOutro && (
            <button
              className="rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white"
              onClick={skipCredits}
            >
              <SkipForward className="mr-1 inline h-4 w-4" />
              Skip credits
            </button>
          )}
        </div>
      )}

      {showNextUp && nextUpLabel && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#141420]/95 p-5 text-center shadow-2xl">
            <p className="text-[11px] uppercase tracking-wide text-white/50">Next episode</p>
            <p className="mt-1 text-lg font-semibold text-white">{nextUpLabel}</p>
            <p className="mt-1 text-sm text-white/60">Playing in {nextUpCountdown}s</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button
                onClick={() => {
                  setShowNextUp(false);
                  onNext?.();
                }}
              >
                <Play className="mr-1 h-4 w-4" fill="currentColor" />
                Play now
              </Button>
              <Button variant="secondary" onClick={() => setShowNextUp(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Controls. The wrapper carries the visibility so the bar and the
          gradient fade together and stop capturing clicks once hidden. */}
      <div
        className={`absolute inset-x-0 bottom-0 px-3 pb-2 pt-10 transition-opacity duration-300 ${
          showBar ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{
          background:
            'linear-gradient(to top, hsl(240 23% 9% / 0.92) 0%, hsl(240 23% 9% / 0.55) 45%, transparent 100%)',
        }}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={currentTime}
          onChange={handleScrub}
          aria-label="Seek"
          className="player-scrub w-full cursor-pointer appearance-none"
          style={{ '--progress': `${progressPercent}%` } as React.CSSProperties}
        />
        <div className="mt-2 flex items-center gap-3 text-white">
          <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button onClick={() => skip(-10)} aria-label="Rewind 10 seconds">
            <Rewind className="h-5 w-5" />
          </button>
          <button onClick={() => skip(10)} aria-label="Forward 10 seconds">
            <FastForward className="h-5 w-5" />
          </button>
          <button onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <span className="hidden text-xs tabular-nums sm:inline">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex-1" />

          {subtitleTracks.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSubtitlesEnabled((value) => !value)}
                aria-label={subtitlesEnabled ? 'Hide subtitles' : 'Show subtitles'}
                className={subtitlesEnabled ? 'text-anime-purple' : 'text-white/70 hover:text-white'}
              >
                <Captions className="h-5 w-5" />
              </button>
              {subtitlesEnabled && (
                <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums">
                  <button
                    onClick={() => nudgeDelay(-DELAY_STEP_SECONDS)}
                    aria-label="Subtitles earlier"
                    className="px-1 hover:text-anime-purple"
                  >
                    −
                  </button>
                  <span className="w-12 text-center">
                    {subtitleDelay > 0 ? '+' : ''}
                    {subtitleDelay.toFixed(2)}s
                  </span>
                  <button
                    onClick={() => nudgeDelay(DELAY_STEP_SECONDS)}
                    aria-label="Subtitles later"
                    className="px-1 hover:text-anime-purple"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          )}

          {levels.length > 1 && (
            <select
              value={activeLevel}
              onChange={(event) => {
                const index = Number(event.target.value);
                setActiveLevel(index);
                if (hlsRef.current) hlsRef.current.currentLevel = index;
              }}
              aria-label="Quality"
              className="rounded bg-black/60 px-2 py-1 text-xs text-white"
            >
              <option value={-1}>Auto</option>
              {levels.map((level) => (
                <option key={level.index} value={level.index}>
                  {level.height ? `${level.height}p` : `Level ${level.index + 1}`}
                </option>
              ))}
            </select>
          )}

          <select
            value={playbackRate}
            onChange={(event) => {
              const rate = Number(event.target.value);
              setPlaybackRate(rate);
              if (videoRef.current) videoRef.current.playbackRate = rate;
            }}
            aria-label="Playback speed"
            className="hidden rounded bg-black/60 px-2 py-1 text-xs text-white sm:block"
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 1 ? 'Normal' : `${rate}x`}
              </option>
            ))}
          </select>

          {pipSupported && (
            <button
              type="button"
              onClick={() => void togglePictureInPicture()}
              aria-label="Picture in picture"
              title="Picture in picture"
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>
          )}

          {xrSupported && (
            <button
              type="button"
              onClick={handleEnterTheater}
              disabled={theaterBusy}
              aria-label="Enter VR theater"
              className="flex items-center gap-1 text-white/80 transition-colors hover:text-white disabled:opacity-50"
            >
              <Glasses className="h-5 w-5" />
              <span className="hidden text-xs font-medium sm:inline">VR</span>
            </button>
          )}

          <button onClick={toggleFullscreen} aria-label="Fullscreen">
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HlsPlayer;
