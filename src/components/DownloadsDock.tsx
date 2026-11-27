import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Download,
  FolderOpen,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDownloads } from '../hooks/useDownloads';
import type { DownloadJob } from '../lib/download/manager';
import { formatBytes } from '../lib/download/hls';
import { canStreamToDisk } from '../lib/download/sink';
import {
  isDownloadDockOpen,
  setDownloadDockOpen,
  subscribeDownloadDock,
} from '../lib/download/ui';
import { DownloadJobRow } from './DownloadJobRow';

/** A small radial progress readout for the collapsed pill. */
const ProgressRing: React.FC<{ percent: number }> = ({ percent }) => {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute text-[9px] font-semibold tabular-nums text-white">
        {Math.round(clamped)}
      </span>
    </span>
  );
};

/**
 * One downloads surface for the whole site.
 *
 * It is mounted once in `App`, so a queue keeps running and stays visible while
 * the viewer moves between pages. Collapsed it is a progress pill; expanded it
 * is a queue with retry, cancel and save settings.
 */
const DownloadsDock: React.FC = () => {
  const {
    jobs,
    options,
    setOptions,
    ensureFolder,
    cancel,
    cancelAll,
    retry,
    retryFailed,
    remove,
    clearFinished,
  } = useDownloads();
  const [open, setOpen] = useState(isDownloadDockOpen);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => subscribeDownloadDock(setOpen), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDownloadDockOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const active = jobs.filter(
    (job) => job.status === 'running' || job.status === 'queued' || job.status === 'paused',
  );
  const running = active.filter((job) => job.status === 'running');
  const saved = jobs
    .filter((job) => job.status === 'done')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const broken = jobs
    .filter((job) => job.status === 'failed' || job.status === 'cancelled')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  const totalSegments = active.reduce((sum, job) => sum + (job.total ?? 0), 0);
  const doneSegments = active.reduce((sum, job) => sum + (job.completed ?? 0), 0);
  const percent = totalSegments > 0 ? Math.min(100, (doneSegments / totalSegments) * 100) : 0;
  const downloadedBytes = active.reduce((sum, job) => sum + job.bytes, 0);
  const savedBytes = saved.reduce((sum, job) => sum + (job.fileSize ?? 0), 0);

  const summary =
    [
      active.length > 0 ? `${active.length} active` : null,
      saved.length > 0 ? `${saved.length} saved` : null,
      savedBytes > 0 ? formatBytes(savedBytes) : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing queued yet';

  if (!open && jobs.length === 0) return null;

  if (!open) {
    const label =
      running.length > 0
        ? `Downloading ${running.length}`
        : active.length > 0
          ? `${active.length} in queue`
          : broken.length > 0
            ? `${broken.length} failed`
            : 'Downloads';
    const detail =
      active.length > 0
        ? `${Math.round(percent)}% · ${formatBytes(downloadedBytes)}`
        : saved.length > 0
          ? `${saved.length} saved`
          : 'Open the queue';

    return (
      <button
        type="button"
        onClick={() => setDownloadDockOpen(true)}
        aria-label="Open downloads"
        className="download-dock fixed bottom-5 right-4 z-[60] flex items-center gap-3 rounded-full border border-white/15 bg-anime-dark/90 py-2 pl-2 pr-4 text-left text-white shadow-2xl backdrop-blur-md transition-transform hover:scale-[1.02] sm:right-6"
      >
        <ProgressRing percent={percent} />
        <span>
          <span className="block text-xs font-semibold">{label}</span>
          <span className="block text-[10px] text-white/55">{detail}</span>
        </span>
      </button>
    );
  }

  const chooseFolder = async () => {
    await ensureFolder();
  };

  const renderSection = (title: string, list: DownloadJob[]) => (
    <div>
      <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h3>
      <ul className="space-y-2">
        {list.map((job) => (
          <DownloadJobRow
            key={job.id}
            job={job}
            onCancel={cancel}
            onRetry={retry}
            onRemove={remove}
          />
        ))}
      </ul>
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] sm:inset-x-auto sm:bottom-5 sm:right-5">
      <section
        role="dialog"
        aria-label="Downloads"
        className="download-dock glass-card flex max-h-[82vh] w-full flex-col overflow-hidden rounded-t-2xl border-white/15 sm:max-h-[74vh] sm:w-[400px] sm:rounded-2xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20 sm:hidden" />

        <header className="flex items-center gap-2 px-4 pb-3 pt-3 sm:pt-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-anime-purple/20 text-anime-purple">
            <Download className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white">Downloads</h2>
            <p className="truncate text-[11px] text-white/50">{summary}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            aria-label="Download settings"
            aria-pressed={showSettings}
            className={`rounded-md p-1.5 transition-colors ${
              showSettings ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDownloadDockOpen(false)}
            aria-label="Minimise downloads"
            className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </header>

        <div className="scrollbar-hide flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          {showSettings && (
            <div className="space-y-3 rounded-lg border border-white/10 bg-black/25 p-3">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Save to
                </p>
                {canStreamToDisk() ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full justify-start"
                    onClick={chooseFolder}
                  >
                    <FolderOpen className="mr-1 h-3.5 w-3.5" />
                    <span className="truncate">
                      {options.directory ? options.directory.name : 'Choose a folder'}
                    </span>
                  </Button>
                ) : (
                  <p className="text-[11px] text-white/45">
                    Your browser&apos;s downloads folder.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Format
                  <select
                    value={options.format}
                    onChange={(event) =>
                      setOptions({ format: event.target.value as 'mp4' | 'ts' })
                    }
                    className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-white focus:border-anime-purple focus:outline-none"
                  >
                    <option value="mp4">MP4</option>
                    <option value="ts">TS (raw)</option>
                  </select>
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Quality
                  <select
                    value={options.quality}
                    onChange={(event) => setOptions({ quality: Number(event.target.value) })}
                    className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-white focus:border-anime-purple focus:outline-none"
                  >
                    <option value={1080}>1080p</option>
                    <option value={720}>720p</option>
                    <option value={480}>480p</option>
                  </select>
                </label>
              </div>

              <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Filename
                <input
                  type="text"
                  value={options.filenameTemplate}
                  onChange={(event) => setOptions({ filenameTemplate: event.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-white focus:border-anime-purple focus:outline-none"
                />
                <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-white/30">
                  {'{series}'} {'{ep:02}'} {'{title}'}
                </span>
              </label>
            </div>
          )}

          {jobs.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Download className="mx-auto mb-3 h-8 w-8 text-white/20" />
              <p className="text-sm text-white/70">Nothing downloading yet</p>
              <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-white/45">
                Open any episode and choose Download. Progress and finished files live here, on
                every page.
              </p>
              {canStreamToDisk() && !options.directory && (
                <Button size="sm" variant="secondary" className="mt-4" onClick={chooseFolder}>
                  <FolderOpen className="mr-1 h-3.5 w-3.5" />
                  Choose a save folder
                </Button>
              )}
            </div>
          ) : (
            <>
              {active.length > 0 &&
                renderSection(
                  `In progress · ${Math.round(percent)}%`,
                  active,
                )}
              {broken.length > 0 && renderSection('Needs attention', broken)}
              {saved.length > 0 &&
                renderSection(
                  `Saved${savedBytes > 0 ? ` · ${formatBytes(savedBytes)}` : ''}`,
                  saved,
                )}
            </>
          )}
        </div>

        {(active.length > 0 || broken.length > 0 || saved.length > 0) && (
          <div className="flex items-center gap-1 border-t border-white/10 px-2 py-2">
            {active.length > 0 && (
              <Button size="sm" variant="ghost" className="text-white/70" onClick={cancelAll}>
                Cancel all
              </Button>
            )}
            {broken.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-white/70"
                onClick={() => retryFailed()}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            <div className="flex-1" />
            {saved.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-white/60"
                title="Clear finished records; files already saved stay on disk."
                onClick={clearFinished}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default DownloadsDock;
