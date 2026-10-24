import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Download, FolderOpen, Loader2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDownloads } from '../hooks/useDownloads';
import { describeJob } from '../lib/download/manager';
import { canStreamToDisk, pickDirectory } from '../lib/download/sink';

/**
 * The download queue panel. It is a plain list with a single progress bar per
 * job; no virtualisation or animation, because the queue is short and the UI
 * should stay cheap.
 */
const DownloadPanel: React.FC = () => {
  const { jobs, options, setOptions, cancel, cancelAll, clearFinished } = useDownloads();
  const [collapsed, setCollapsed] = useState(false);

  if (jobs.length === 0) return null;

  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;

  const chooseFolder = async () => {
    const handle = await pickDirectory();
    if (handle) setOptions({ directory: handle });
  };

  return (
    <section className="glass-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Download className="h-4 w-4 text-white" />
        <h2 className="flex-1 text-sm font-semibold text-white">
          Downloads
          {active > 0 && <span className="ml-2 text-white/50">({active} active)</span>}
        </h2>
        <button
          className="text-white/60 hover:text-white"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand downloads' : 'Collapse downloads'}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </header>

      {!collapsed && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            {canStreamToDisk() ? (
              <Button size="sm" variant="secondary" onClick={chooseFolder}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
                {options.directory ? options.directory.name : 'Choose folder'}
              </Button>
            ) : (
              <span className="text-white/50">
                Saving to your browser's downloads folder.
              </span>
            )}
            <div className="flex-1" />
            {active > 0 && (
              <Button size="sm" variant="ghost" className="text-white/70" onClick={cancelAll}>
                Cancel all
              </Button>
            )}
            {jobs.some((job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && (
              <Button size="sm" variant="ghost" className="text-white/70" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
          </div>

          <ul className="space-y-3">
            {jobs.map((job) => {
              const percent =
                job.total && job.completed !== null ? (job.completed / job.total) * 100 : 0;
              const isActive = job.status === 'running' || job.status === 'paused';
              return (
                <li key={job.id} className="rounded border border-white/5 bg-black/20 p-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-white">
                        {job.seriesTitle} — Ep {job.episode.number}
                      </p>
                      <p className="truncate text-[11px] text-white/50">{describeJob(job)}</p>
                    </div>
                    {isActive && (
                      <button
                        onClick={() => cancel(job.id)}
                        className="text-white/50 hover:text-white"
                        aria-label="Cancel download"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {job.status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {job.status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
                    {job.status === 'queued' && (
                      <Loader2 className="h-4 w-4 animate-spin text-white/40" />
                    )}
                  </div>
                  {job.status === 'running' && (
                    <div className="mt-2 h-1 w-full overflow-hidden rounded bg-white/10">
                      <div
                        className="h-full bg-anime-purple transition-[width] duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
};

export default DownloadPanel;
