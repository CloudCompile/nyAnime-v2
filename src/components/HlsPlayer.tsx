import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls, { type Level } from 'hls.js';
import { Loader2, Maximize, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { SubtitleTrack } from '../services/animeApiService';
import { maybeProxy } from '../lib/stream';

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
  subtitles?: SubtitleTrack[];
  /** Intro/outro windows in seconds, when the source advertises them. */
  intro?: number[];
  outro?: number[];
}

const PROGRESS_REPORT_INTERVAL_MS = 5000;

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
 * browser needs it, and plain controls. No skins, no animation library, no
 * blur effects — the UI stays cheap to render so it also behaves on the Intel
 * integrated graphics of an older laptop.
 */
const HlsPlayer: React.FC<HlsPlayerProps> = ({
  src,
  poster,
  initialProgress = 0,
  autoPlay = false,
  onProgress,
  onEnded,
  subtitles = [],
  intro = [],
  outro = [],
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastReportRef = useRef(0);
  const appliedProgressRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [levels, setLevels] = useState<{ height: number; index: number }[]>([]);
  const [activeLevel, setActiveLevel] = useState(-1);

  const playableSrc = useMemo(() => maybeProxy(src), [src]);

  const subtitleTracks = useMemo(
    () =>
      subtitles
        .filter((track) => track.file)
        .map((track, index) => ({
          url: maybeProxy(track.file),
          label: track.label || `Track ${index + 1}`,
          isDefault: Boolean(track.default) || index === 0,
        })),
    [subtitles],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playableSrc) return;

    setIsLoading(true);
    setError(null);
    appliedProgressRef.current = false;

    const attachNative = () => {
      // Safari plays HLS natively, but the proxied manifest is still needed for
      // CORS, so the same URL is used either way.
      video.src = playableSrc;
    };

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
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        setError('This stream could not be played. Try another server.');
        setIsLoading(false);
        hls.destroy();
        hlsRef.current = null;
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      attachNative();
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
  }, [playableSrc, autoPlay]);

  // Attach subtitle tracks as WebVTT once the manifest is known.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of subtitleTracks) {
      const element = document.createElement('track');
      element.kind = 'subtitles';
      element.label = track.label;
      element.src = track.url;
      element.default = track.isDefault;
      video.appendChild(element);
    }
    return () => {
      video.querySelectorAll('track').forEach((track) => track.remove());
    };
  }, [subtitleTracks]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    // Seeking before the media is ready is ignored, so this runs once here.
    if (!appliedProgressRef.current && initialProgress > 1 && initialProgress < video.duration - 5) {
      video.currentTime = initialProgress;
      appliedProgressRef.current = true;
    }
    setIsLoading(false);
  }, [initialProgress]);

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
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const requestFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen().catch(() => undefined);
  }, []);

  const handleScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(Number(event.target.value));
  };

  // The intro window is advertised as [start, end]; the button appears only
  // while playback is inside it.
  const introWindow = intro.length >= 2 ? intro : null;
  const inIntro = introWindow
    ? currentTime >= (introWindow[0] ?? 0) && currentTime < (introWindow[1] ?? 0)
    : false;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (error) {
    return (
      <div className="w-full aspect-video flex items-center justify-center bg-black rounded-xl">
        <p className="text-white/80 text-sm px-6 text-center">{error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group">
      <video
        ref={videoRef}
        poster={poster}
        className="w-full h-full"
        playsInline
        onClick={togglePlay}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onEnded={onEnded}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      )}

      {inIntro && introWindow && (
        <button
          className="absolute bottom-20 right-4 rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white"
          onClick={() => seekTo(introWindow[1] ?? currentTime)}
        >
          <SkipForward className="mr-1 inline h-4 w-4" />
          Skip intro
        </button>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-8">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={currentTime}
          onChange={handleScrub}
          aria-label="Seek"
          className="w-full h-1 cursor-pointer appearance-none rounded bg-white/25 accent-white"
          style={{
            background: `linear-gradient(to right, #8b5cf6 ${progressPercent}%, rgba(255,255,255,0.25) ${progressPercent}%)`,
          }}
        />
        <div className="mt-1 flex items-center gap-3 text-white">
          <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <span className="text-xs tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex-1" />
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
          <button onClick={requestFullscreen} aria-label="Fullscreen">
            <Maximize className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default HlsPlayer;
