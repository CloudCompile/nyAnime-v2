/**
 * Download records, kept across reloads.
 *
 * The queue itself lives in memory because a running job owns a live file
 * handle, but the *record* of what was queued and what finished is the useful
 * part: it survives a reload, feeds the downloads dock and the Library's
 * Downloads tab, and lets a failed job be retried with one tap.
 *
 * Only settled fields are stored. Speed, ETA and retry timers are recomputed
 * and would only go stale.
 */
import type { DownloadJob, JobStatus } from './manager';

const STORAGE_KEY = 'nyanime.downloads.jobs.v1';
/** Enough history for a couple of seasons without unbounded growth. */
const MAX_RECORDS = 100;

export const DOWNLOADS_CHANGED_EVENT = 'nyanime:downloads-changed';

const STATUSES: JobStatus[] = ['queued', 'running', 'paused', 'done', 'failed', 'cancelled'];
const ACTIVE_STATUSES = new Set<JobStatus>(['queued', 'running', 'paused']);

type StoredJob = Omit<
  DownloadJob,
  'speed' | 'eta' | 'retryAt' | 'speedSampleAt' | 'speedSampleBytes'
>;

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normaliseStatus(value: unknown): JobStatus {
  return STATUSES.includes(value as JobStatus) ? (value as JobStatus) : 'failed';
}

function normaliseJob(value: unknown, index: number): DownloadJob | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const episode = (raw.episode ?? {}) as Record<string, unknown>;
  const key = String(episode.key ?? '');
  // A record without an episode key could never be retried.
  if (!key) return null;

  const number = finite(episode.number, 1);
  const status = normaliseStatus(raw.status);
  // A job that was mid-flight when the tab closed has lost its file handle, so
  // it comes back as a retryable failure instead of pretending to still run.
  const interrupted = ACTIVE_STATUSES.has(status);

  return {
    id: String(raw.id ?? `job-restored-${index}`),
    seriesTitle: String(raw.seriesTitle ?? 'Unknown series'),
    seriesId: raw.seriesId ? String(raw.seriesId) : undefined,
    poster: typeof raw.poster === 'string' && raw.poster ? raw.poster : null,
    episode: {
      key,
      id: String(episode.id ?? ''),
      number,
      title: String(episode.title ?? `Episode ${number}`),
      japaneseTitle:
        typeof episode.japaneseTitle === 'string' ? episode.japaneseTitle : undefined,
      filler: Boolean(episode.filler),
      subbed: episode.subbed === undefined ? true : Boolean(episode.subbed),
      dubbed: Boolean(episode.dubbed),
    },
    status: interrupted ? 'failed' : status,
    enqueuedAt: finite(raw.enqueuedAt, Date.now()),
    completed:
      raw.completed === null || raw.completed === undefined ? null : finite(raw.completed),
    total: raw.total === null || raw.total === undefined ? null : finite(raw.total),
    bytes: finite(raw.bytes),
    fileSize:
      raw.fileSize === null || raw.fileSize === undefined ? null : finite(raw.fileSize),
    filename: typeof raw.filename === 'string' ? raw.filename : null,
    error: interrupted
      ? 'Interrupted when the page closed. Retry to download it again.'
      : typeof raw.error === 'string'
        ? raw.error
        : null,
    startedAt:
      raw.startedAt === null || raw.startedAt === undefined ? null : finite(raw.startedAt),
    finishedAt: interrupted
      ? Date.now()
      : raw.finishedAt === null || raw.finishedAt === undefined
        ? null
        : finite(raw.finishedAt),
    speed: null,
    eta: null,
    retryAt: null,
    rateLimitRetries: finite(raw.rateLimitRetries),
  };
}

export function loadJobs(): DownloadJob[] {
  if (typeof window === 'undefined') return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normaliseJob)
      .filter((job): job is DownloadJob => job !== null)
      .slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

/**
 * Write the queue back, keeping the newest records. Also pings listeners so the
 * Library's Downloads tab updates without polling.
 */
export function saveJobs(jobs: DownloadJob[]): void {
  if (typeof window === 'undefined') return;

  const records: StoredJob[] = jobs.slice(-MAX_RECORDS).map((job) => ({
    id: job.id,
    seriesTitle: job.seriesTitle,
    seriesId: job.seriesId,
    poster: job.poster ?? null,
    episode: job.episode,
    status: job.status,
    enqueuedAt: job.enqueuedAt,
    completed: job.completed,
    total: job.total,
    bytes: job.bytes,
    fileSize: job.fileSize,
    filename: job.filename,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    rateLimitRetries: job.rateLimitRetries,
  }));

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Private mode or a full quota; the queue still works in memory.
  }

  window.dispatchEvent(new CustomEvent(DOWNLOADS_CHANGED_EVENT));
}
