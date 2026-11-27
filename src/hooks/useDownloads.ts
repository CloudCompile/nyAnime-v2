import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_OPTIONS,
  DownloadManager,
  type DownloadJob,
  type ManagerOptions,
} from '../lib/download/manager';
import { canStreamToDisk, pickDirectory } from '../lib/download/sink';

const STORAGE_KEY = 'nyanime.download.options';

/** The manager is a singleton so a download survives page navigation. */
let manager: DownloadManager | null = null;

function readOptions(): Partial<ManagerOptions> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ManagerOptions>) : {};
  } catch {
    return {};
  }
}

export function getDownloadManager(): DownloadManager {
  if (!manager) {
    // `directory` is a live handle and cannot be serialized, so it is never
    // restored from storage.
    const { directory: _ignored, ...persisted } = readOptions();
    manager = new DownloadManager({ ...DEFAULT_OPTIONS, ...persisted });
  }
  return manager;
}

function activeCount(jobs: DownloadJob[]): number {
  return jobs.filter(
    (job) => job.status === 'running' || job.status === 'queued' || job.status === 'paused',
  ).length;
}

export function useDownloads() {
  const instance = useMemo(getDownloadManager, []);
  const [jobs, setJobs] = useState<DownloadJob[]>(() => instance.getJobs());
  const [options, setOptionsState] = useState<ManagerOptions>(() => instance.getOptions());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = instance.subscribe((next) => {
      if (mounted.current) setJobs(next);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [instance]);

  const setOptions = (patch: Partial<ManagerOptions>) => {
    instance.setOptions(patch);
    const next = instance.getOptions();
    setOptionsState({ ...next });
    const { directory: _ignored, ...persisted } = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      /* Storage may be unavailable in private mode. */
    }
  };

  /**
   * Ask for a save folder once, before a batch starts. The File System Access
   * picker needs the click's transient activation, so it has to happen here
   * rather than when the first segment is ready — otherwise every episode in a
   * batch would open its own save dialog.
   */
  const ensureFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!canStreamToDisk()) return null;
    const existing = instance.getOptions().directory ?? null;
    if (existing) return existing;
    const handle = await pickDirectory();
    if (handle) setOptions({ directory: handle });
    return handle;
  };

  return {
    jobs,
    options,
    setOptions,
    ensureFolder,
    enqueue: (
      seriesTitle: string,
      episodes: Parameters<DownloadManager['enqueue']>[1],
      meta?: Parameters<DownloadManager['enqueue']>[2],
    ) => instance.enqueue(seriesTitle, episodes, meta),
    cancel: (id: string) => instance.cancel(id),
    cancelAll: () => instance.cancelAll(),
    retry: (id: string) => instance.retry(id),
    retryFailed: () => instance.retryFailed(),
    remove: (id: string) => instance.remove(id),
    clearFinished: () => instance.clearFinished(),
  };
}

/**
 * Just the number of unsettled jobs, for the header badge. Subscribing to the
 * whole queue would re-render the fixed header on every progress tick; this
 * only re-renders when the count actually changes.
 */
export function useDownloadCount(): number {
  const [count, setCount] = useState(() => activeCount(getDownloadManager().getJobs()));

  useEffect(() => {
    const instance = getDownloadManager();
    let last = activeCount(instance.getJobs());
    setCount(last);
    return instance.subscribe((jobs) => {
      const next = activeCount(jobs);
      if (next !== last) {
        last = next;
        setCount(next);
      }
    });
  }, []);

  return count;
}
