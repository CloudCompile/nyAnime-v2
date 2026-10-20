/**
 * Download queue, ported from CloudCompile/browserformobile.
 *
 * The manager resolves a stream for each episode, picks the best quality
 * variant, downloads the segments through the proxy and writes either the raw
 * MPEG-TS stream or a transmuxed MP4. Jobs run a few at a time, and a job the
 * CDN rate limits is parked and retried rather than failed.
 *
 * It is deliberately timer-free while idle: the only timers are the progress
 * coalescer and the rate-limit retry, so a paused queue costs no CPU.
 */
import { getStream, type EpisodeSummary, type StreamResult } from '../../services/animeApiService';
import { maybeProxy, proxied } from '../stream';
import {
  DownloadError,
  RateLimitError,
  downloadSegmentsStreaming,
  formatBytes,
  formatDuration,
  formatSpeed,
  loadMediaPlaylist,
} from './hls';
import { TransmuxStream, patchDuration } from './transmux';
import {
  openSink,
  renderTemplate,
  sanitizeName,
  type FileSink,
} from './sink';

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type OutputFormat = 'mp4' | 'ts';

export interface DownloadJob {
  id: string;
  seriesTitle: string;
  episode: EpisodeSummary;
  status: JobStatus;
  /** Segments downloaded / total, or null before the playlist is known. */
  completed: number | null;
  total: number | null;
  bytes: number;
  fileSize: number | null;
  filename: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Bytes per second, averaged over the last few seconds. */
  speed: number | null;
  /** Estimated seconds remaining. */
  eta: number | null;
  /** When a rate-limited job parked at the bottom of the queue will retry. */
  retryAt: number | null;
  rateLimitRetries: number;
  speedSampleAt?: number;
  speedSampleBytes?: number;
}

export interface ManagerOptions {
  /** Preferred height in pixels; the closest available variant is used. */
  quality: number;
  format: OutputFormat;
  /** Parallel segment requests per episode. */
  segmentConcurrency: number;
  /** Episodes downloaded at the same time. */
  maxConcurrentJobs: number;
  filenameTemplate: string;
  /** Reused for every episode once the user has chosen one. */
  directory?: FileSystemDirectoryHandle | null;
}

export const DEFAULT_OPTIONS: ManagerOptions = {
  quality: 720,
  format: 'mp4',
  segmentConcurrency: 6,
  maxConcurrentJobs: 2,
  filenameTemplate: '{series} - {ep:02} - {title}',
  directory: null,
};

const RATE_LIMIT_RETRY_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 6;
const UPDATE_INTERVAL_MS = 250;
/** Coalesced write size; also the transmux flush window. */
const BATCH_BYTES = 8 * 1024 * 1024;

export interface StreamVariant {
  height: number;
  width: number;
  bandwidth: number;
  url: string;
}

/** Parse an HLS master playlist into its quality variants. */
export function parseMasterPlaylist(text: string, baseUrl: string): StreamVariant[] {
  const lines = text.split(/\r?\n/);
  const variants: StreamVariant[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line || !line.startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines[index + 1];
    if (!uri || uri.startsWith('#')) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const resolution = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    variants.push({
      width: resolution ? Number(resolution[1]) : 0,
      height: resolution ? Number(resolution[2]) : 0,
      bandwidth,
      url: new URL(uri, baseUrl).toString(),
    });
  }
  return variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}

/**
 * Pick the variant matching a requested height, falling back to the closest
 * available. Sources are frequently single-variant (720p), so a request for
 * 1080p must not fail the download.
 */
export function selectVariant(variants: StreamVariant[], preferredHeight: number): StreamVariant | null {
  if (variants.length === 0) return null;
  const exact = variants.find((variant) => variant.height === preferredHeight);
  if (exact) return exact;
  const atOrBelow = variants.filter((variant) => variant.height > 0 && variant.height <= preferredHeight);
  if (atOrBelow.length > 0) return atOrBelow[0] ?? null;
  return variants[0] ?? null;
}

type Listener = (jobs: DownloadJob[]) => void;

export class DownloadManager {
  private jobs: DownloadJob[] = [];
  private listeners = new Set<Listener>();
  private running = 0;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private controllers = new Map<string, AbortController>();
  private sequence = 0;

  constructor(private options: ManagerOptions = DEFAULT_OPTIONS) {}

  setOptions(options: Partial<ManagerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): ManagerOptions {
    return this.options;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener([...this.jobs]);
    return () => this.listeners.delete(listener);
  }

  getJobs(): DownloadJob[] {
    return [...this.jobs];
  }

  /** Coalesce UI updates so a fast download cannot thrash the render loop. */
  private notify(): void {
    if (this.updateTimer !== null) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      const snapshot = [...this.jobs];
      for (const listener of this.listeners) listener(snapshot);
    }, UPDATE_INTERVAL_MS);
  }

  enqueue(seriesTitle: string, episodes: EpisodeSummary[]): number {
    let added = 0;
    for (const episode of episodes) {
      const existing = this.jobs.find(
        (job) =>
          job.episode.key === episode.key &&
          (job.status === 'queued' || job.status === 'running' || job.status === 'paused'),
      );
      if (existing) continue;
      this.jobs.push({
        id: `job-${++this.sequence}`,
        seriesTitle,
        episode,
        status: 'queued',
        completed: null,
        total: null,
        bytes: 0,
        fileSize: null,
        filename: null,
        error: null,
        startedAt: null,
        finishedAt: null,
        speed: null,
        eta: null,
        retryAt: null,
        rateLimitRetries: 0,
      });
      added++;
    }
    this.notify();
    this.pump();
    return added;
  }

  cancel(id: string): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job) return;
    if (job.status === 'queued' || job.status === 'paused') {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
    } else if (job.status === 'running') {
      this.controllers.get(id)?.abort();
    }
    this.notify();
  }

  cancelAll(): void {
    for (const job of this.jobs) this.cancel(job.id);
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter(
      (job) => job.status === 'queued' || job.status === 'running' || job.status === 'paused',
    );
    this.notify();
  }

  dispose(): void {
    if (this.updateTimer !== null) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    this.cancelAll();
    this.listeners.clear();
  }

  /** Start as many queued jobs as the concurrency limit allows. */
  private pump(): void {
    while (this.running < this.options.maxConcurrentJobs) {
      const next = this.jobs.find((job) => job.status === 'queued');
      if (!next) return;
      void this.run(next);
    }
  }

  private async run(job: DownloadJob): Promise<void> {
    this.running++;
    job.status = 'running';
    job.startedAt = Date.now();
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.notify();

    try {
      await this.download(job, controller.signal);
      job.status = 'done';
      job.finishedAt = Date.now();
      job.speed = null;
      job.eta = null;
    } catch (error) {
      if (error instanceof RateLimitError) {
        this.park(job);
      } else if (controller.signal.aborted) {
        job.status = 'cancelled';
        job.finishedAt = Date.now();
      } else {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.finishedAt = Date.now();
      }
    } finally {
      this.controllers.delete(job.id);
      this.running--;
      this.notify();
      this.pump();
    }
  }

  /** Park a rate-limited job at the bottom of the queue and retry it later. */
  private park(job: DownloadJob): void {
    if (job.rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
      job.status = 'failed';
      job.error = 'The server kept rate limiting this download. Try again later.';
      job.finishedAt = Date.now();
      return;
    }
    job.rateLimitRetries++;
    job.status = 'paused';
    job.retryAt = Date.now() + RATE_LIMIT_RETRY_MS;
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      job.retryAt = null;
      job.status = 'queued';
      this.notify();
      this.pump();
    }, RATE_LIMIT_RETRY_MS);
    this.retryTimers.add(timer);
  }

  private async download(job: DownloadJob, signal: AbortSignal): Promise<void> {
    const { seriesTitle, episode } = job;
    const stream = await getStream(episode.key, { type: episode.dubbed ? 'dub' : 'sub' }, signal);

    const masterUrl = await this.resolveMasterUrl(stream);
    if (!masterUrl) {
      throw new DownloadError(
        stream.iframe
          ? 'This server only offers an embed, which cannot be downloaded. Pick a different server.'
          : 'No downloadable stream was returned for this episode.',
      );
    }

    const mediaUrl = await this.resolveMediaUrl(masterUrl, signal);
    const playlist = await loadMediaPlaylist(mediaUrl, signal);

    const extension = this.options.format === 'mp4' ? 'mp4' : 'ts';
    const filename = sanitizeName(
      renderTemplate(this.options.filenameTemplate, {
        series: seriesTitle,
        episode: episode.number,
        title: episode.title,
        ext: extension,
      }),
    );
    job.filename = filename;
    job.total = playlist.segments.length;
    job.completed = 0;

    const sink = await openSink(filename, {
      directory: this.options.directory ?? null,
      mimeType: this.options.format === 'mp4' ? 'video/mp4' : 'video/mp2t',
    });

    const onProgress = (progress: { completed: number; bytes: number }) => {
      this.recordProgress(job, progress);
    };

    try {
      if (this.options.format === 'mp4') {
        await this.writeMp4(job, sink, playlist, signal, onProgress);
      } else {
        await downloadSegmentsStreaming(
          playlist,
          {
            concurrency: this.options.segmentConcurrency,
            signal,
            onProgress,
            batchBytes: BATCH_BYTES,
          },
          async (_index, data) => {
            await sink.write(data);
          },
        );
      }
      await sink.close();
      await sink.finalize(filename);
      job.fileSize = sink.bytes;
    } catch (error) {
      await sink.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * MP4 is transmuxed as the stream arrives, not from a whole-file read-back.
   * mux.js emits nothing from `push()`, so each batch is pushed and flushed in
   * turn; the transmuxer then holds one batch rather than the whole episode.
   */
  private async writeMp4(
    job: DownloadJob,
    sink: FileSink,
    playlist: Awaited<ReturnType<typeof loadMediaPlaylist>>,
    signal: AbortSignal,
    onProgress: (progress: { completed: number; bytes: number }) => void,
  ): Promise<void> {
    let initWritten = false;
    const stream = new TransmuxStream(
      (init) => {
        void sink.write(patchDuration(init, playlist.duration));
        initWritten = true;
      },
      async (fragment) => {
        await sink.write(fragment);
      },
    );

    await downloadSegmentsStreaming(
      playlist,
      {
        concurrency: this.options.segmentConcurrency,
        signal,
        onProgress,
        batchBytes: BATCH_BYTES,
      },
      async (_index, chunk) => {
        stream.push(chunk);
        await stream.flush();
      },
    );
    await stream.finish();
    if (!initWritten) throw new DownloadError('The stream produced no video data.');
  }

  /** Resolve the master playlist URL, proxying CDN links. */
  private async resolveMasterUrl(stream: StreamResult): Promise<string | null> {
    if (!stream.file) return null;
    return maybeProxy(stream.file);
  }

  /**
   * A master playlist points at quality variants. Fetch it and choose the best
   * variant; if the URL is already a media playlist, use it as-is.
   */
  private async resolveMediaUrl(masterUrl: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(masterUrl, { signal });
    if (!response.ok) throw new DownloadError(`HTTP ${response.status} for the stream playlist.`);
    const text = await response.text();
    const variants = parseMasterPlaylist(text, masterUrl);
    if (variants.length === 0) return masterUrl;
    const chosen = selectVariant(variants, this.options.quality) ?? variants[0];
    return chosen ? chosen.url : masterUrl;
  }

  private recordProgress(job: DownloadJob, progress: { completed: number; bytes: number }): void {
    job.completed = progress.completed;
    job.bytes = progress.bytes;

    const now = Date.now();
    if (job.speedSampleAt === undefined) {
      job.speedSampleAt = now;
      job.speedSampleBytes = progress.bytes;
    } else {
      const elapsed = (now - job.speedSampleAt) / 1000;
      if (elapsed >= 3) {
        const delta = progress.bytes - (job.speedSampleBytes ?? 0);
        job.speed = delta / elapsed;
        job.speedSampleAt = now;
        job.speedSampleBytes = progress.bytes;
      }
    }
    if (job.speed && job.total && job.completed !== null) {
      const remaining = job.total - job.completed;
      const perSegment = job.bytes / Math.max(1, job.completed);
      job.eta = (remaining * perSegment) / job.speed;
    }
    this.notify();
  }
}

/** A one-line description of a job's state, for the downloads panel. */
export function describeJob(job: DownloadJob): string {
  if (job.status === 'queued') return 'Queued';
  if (job.status === 'cancelled') return 'Cancelled';
  if (job.status === 'failed') return job.error ?? 'Failed';
  if (job.status === 'paused') {
    const wait = job.retryAt ? Math.max(0, Math.round((job.retryAt - Date.now()) / 1000)) : 0;
    return `Rate limited · retrying in ${formatDuration(wait)}`;
  }
  if (job.status === 'done') {
    return `Saved${job.fileSize ? ` · ${formatBytes(job.fileSize)}` : ''}`;
  }
  if (job.total && job.completed !== null) {
    const progress = `${job.completed} / ${job.total} segments · ${formatBytes(job.bytes)}`;
    const rate = job.speed ? ` · ${formatSpeed(job.speed)}` : '';
    const eta = job.eta ? ` · ${formatDuration(job.eta)} left` : '';
    return `${progress}${rate}${eta}`;
  }
  return 'Starting…';
}

export { proxied };
