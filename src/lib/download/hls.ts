/**
 * HLS download engine, ported from CloudCompile/browserformobile.
 *
 * The CDN serves plain, unencrypted MPEG-TS segments with a small concurrency
 * budget: it starts answering 429 above roughly four parallel requests. The
 * engine therefore treats concurrency as a target rather than a fixed pool,
 * dropping it on a 429 and creeping back up after a cooldown.
 *
 * Segments are delivered to the sink in playlist order as soon as they are
 * available, so only the out-of-order window is held in memory. That is what
 * keeps peak memory bounded on a long episode.
 */

export interface MediaPlaylist {
  /** Absolute segment URLs in playback order. */
  segments: string[];
  /** Duration of each segment in seconds, in the same order. */
  durations: number[];
  /** Total duration in seconds, from the `#EXTINF` values. */
  duration: number;
  targetDuration: number;
}

export interface DownloadProgress {
  completed: number;
  total: number;
  bytes: number;
}

export interface DownloadOptions {
  concurrency: number;
  signal?: AbortSignal;
  onProgress?(progress: DownloadProgress): void;
  /** Bytes buffered before a write is issued. */
  batchBytes?: number;
  /** Segments already written, skipped by a resumed download. */
  resumeFrom?: number;
  /** Bytes already on disk, added to the progress total of a resume. */
  resumeBytes?: number;
}

export class DownloadError extends Error {}

/** The CDN is rate limiting us (429) even after the retries were spent. */
export class RateLimitError extends DownloadError {}

const REQUEST_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 5;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 750;
const BACKOFF_MAX_MS = 15000;
const RATE_LIMIT_COOLDOWN_MS = 5000;
const GATE_POLL_MS = 50;

/** Exponential backoff with jitter, so parallel workers do not retry in lockstep. */
function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DownloadError('Download cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DownloadError('Download cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split(/\r?\n/);
  const segments: string[] = [];
  const durations: number[] = [];
  let duration = 0;
  let targetDuration = 0;
  let pending = 0;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      pending = Number.parseFloat(line.slice('#EXTINF:'.length)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseFloat(line.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push(new URL(line, baseUrl).toString());
    durations.push(pending);
    duration += pending;
    pending = 0;
  }
  return { segments, durations, duration, targetDuration };
}

/**
 * Fetch one segment, retrying transient failures with backoff. `onRateLimit`
 * fires the moment a 429 is seen so the pool can shed concurrency immediately.
 */
async function fetchSegment(
  url: string,
  signal: AbortSignal | undefined,
  onRateLimit: () => void,
): Promise<Uint8Array> {
  let lastError: unknown = null;
  let rateLimited = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DownloadError('Download cancelled.');
    try {
      const response = await fetchWithTimeout(url, signal);
      if (!response.ok) {
        if (response.status === 429) {
          rateLimited = true;
          onRateLimit();
        }
        if (TRANSIENT_STATUS.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
          await delay(backoffMs(attempt), signal);
          continue;
        }
        throw new DownloadError(`HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof DownloadError && error.message === 'Download cancelled.') throw error;
      if (error instanceof DOMException && error.name === 'AbortError' && signal?.aborted) {
        throw new DownloadError('Download cancelled.');
      }
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await delay(backoffMs(attempt), signal);
        continue;
      }
    }
  }
  if (rateLimited) {
    throw new RateLimitError('The server is rate limiting downloads (HTTP 429).');
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new DownloadError(`A segment failed after ${MAX_ATTEMPTS} attempts: ${detail}`);
}

/**
 * Download segments and hand each one to `onSegment` in playlist order. The
 * callback's `writtenThrough` is the count of segments written so far, so a
 * caller can record a resume point that is always a true contiguous prefix.
 */
export async function downloadSegmentsStreaming(
  playlist: MediaPlaylist,
  options: DownloadOptions,
  onSegment: (index: number, data: Uint8Array, writtenThrough: number) => Promise<void> | void,
): Promise<void> {
  const total = playlist.segments.length;
  const resumeFrom = Math.max(0, Math.min(options.resumeFrom ?? 0, total));
  const batchBytes = Math.max(1, options.batchBytes ?? 8 * 1024 * 1024);
  const pending = new Map<number, Uint8Array>();
  let nextToWrite = resumeFrom;
  let completed = resumeFrom;
  let bytes = options.resumeBytes ?? 0;
  let nextToFetch = resumeFrom;
  let buffer: Uint8Array[] = [];
  let bufferLength = 0;

  const internal = new AbortController();
  const forwardAbort = () => internal.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  // Writes are chained rather than awaited at the call site: awaiting inside a
  // worker let a later segment's write start before an earlier one finished,
  // which reordered the file.
  let writes: Promise<void> = Promise.resolve();
  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const chunk = concatSegments(buffer);
    const first = nextToWrite - buffer.length;
    const through = nextToWrite;
    buffer = [];
    bufferLength = 0;
    writes = writes.then(() => onSegment(first, chunk, through));
  };

  const workers = Math.max(1, Math.min(options.concurrency, total - resumeFrom));
  const minWorkers = 1;
  let targetWorkers = workers;
  let recoverAt = 0;
  const onRateLimit = () => {
    if (targetWorkers > minWorkers) targetWorkers--;
    recoverAt = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  };
  const gate = async () => {
    while (targetWorkers < workers) {
      if (internal.signal.aborted) throw new DownloadError('Download cancelled.');
      if (Date.now() >= recoverAt) {
        targetWorkers++;
        return;
      }
      await delay(GATE_POLL_MS, internal.signal);
    }
  };

  const worker = async () => {
    for (;;) {
      await gate();
      const index = nextToFetch++;
      if (index >= total) return;
      const url = playlist.segments[index];
      if (!url) return;
      const data = await fetchSegment(url, internal.signal, onRateLimit);
      completed++;
      bytes += data.byteLength;
      options.onProgress?.({ completed, total, bytes });
      pending.set(index, data);
      while (pending.has(nextToWrite)) {
        const next = pending.get(nextToWrite) as Uint8Array;
        pending.delete(nextToWrite);
        buffer.push(next);
        bufferLength += next.byteLength;
        nextToWrite++;
        if (bufferLength >= batchBytes) flushBuffer();
      }
    }
  };

  let failure: Error | null = null;
  try {
    await Promise.all(
      Array.from({ length: workers }, () =>
        worker().catch((error: unknown) => {
          internal.abort();
          throw error;
        }),
      ),
    );
  } catch (error) {
    failure = error instanceof Error ? error : new DownloadError(String(error));
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }

  // Let queued writes finish so the file and its sidecar agree before the
  // caller records a resume point. The unwritten tail is dropped.
  await writes.catch(() => undefined);
  if (failure) throw failure;

  flushBuffer();
  await writes;

  if (nextToWrite !== total) {
    throw new DownloadError(`Only ${nextToWrite} of ${total} segments were written.`);
  }
}

/** Fetch and parse a media playlist through the proxy. */
export async function loadMediaPlaylist(url: string, signal?: AbortSignal): Promise<MediaPlaylist> {
  const response = await fetchWithTimeout(url, signal);
  if (!response.ok) throw new DownloadError(`HTTP ${response.status} for the playlist.`);
  const playlist = parseMediaPlaylist(await response.text(), url);
  if (playlist.segments.length === 0) {
    throw new DownloadError('The stream playlist contained no segments.');
  }
  return playlist;
}

/** Concatenate MPEG-TS segments. The result is directly playable as `.ts`. */
export function concatSegments(segments: Uint8Array[]): Uint8Array {
  const total = segments.reduce((sum, segment) => sum + segment.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.byteLength;
  }
  return output;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
