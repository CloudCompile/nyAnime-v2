import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_OPTIONS,
  DownloadManager,
  type DownloadJob,
  type ManagerOptions,
} from '../lib/download/manager';

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

function getManager(): DownloadManager {
  if (!manager) {
    // `directory` is a live handle and cannot be serialized, so it is never
    // restored from storage.
    const { directory: _ignored, ...persisted } = readOptions();
    manager = new DownloadManager({ ...DEFAULT_OPTIONS, ...persisted });
  }
  return manager;
}

export function useDownloads() {
  const instance = useMemo(getManager, []);
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

  return {
    jobs,
    options,
    setOptions,
    enqueue: (seriesTitle: string, episodes: Parameters<DownloadManager['enqueue']>[1]) =>
      instance.enqueue(seriesTitle, episodes),
    cancel: (id: string) => instance.cancel(id),
    cancelAll: () => instance.cancelAll(),
    clearFinished: () => instance.clearFinished(),
  };
}
