import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { DownloadJob } from '../lib/download/manager';
import { describeJob, jobPercent } from '../lib/download/manager';

interface Props {
  job: DownloadJob;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
  >
    {children}
  </button>
);

const StatusIcon: React.FC<{ status: DownloadJob['status'] }> = ({ status }) => {
  if (status === 'done') {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Saved" />;
  }
  if (status === 'failed') {
    return <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-label="Failed" />;
  }
  if (status === 'paused') {
    return <PauseCircle className="h-4 w-4 shrink-0 text-amber-300" aria-label="Rate limited" />;
  }
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-anime-purple" aria-label="Downloading" />;
  }
  if (status === 'queued') {
    return <Loader2 className="h-4 w-4 shrink-0 text-white/30" aria-label="Queued" />;
  }
  return <X className="h-4 w-4 shrink-0 text-white/30" aria-label="Cancelled" />;
};

/** One episode in the download queue. */
export const DownloadJobRow: React.FC<Props> = ({ job, onCancel, onRetry, onRemove }) => {
  const percent = jobPercent(job);
  const isActive =
    job.status === 'running' || job.status === 'queued' || job.status === 'paused';
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const isSettled = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';

  // Titles are usually just "Episode 3"; only repeat a title that says more.
  const extraTitle = job.episode.title
    .replace(/^Episode\s*\d+\s*/i, '')
    .replace(/^[-\u2013:]\s*/, '')
    .trim();

  return (
    <li className="flex gap-3 rounded-lg border border-white/5 bg-black/25 p-2.5">
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-white/5">
        {job.poster ? (
          <img src={job.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white/30">
            {job.episode.number}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{job.seriesTitle}</p>
            <p className="truncate text-[11px] text-white/45">
              Episode {job.episode.number}
              {extraTitle ? ` · ${extraTitle}` : ''}
            </p>
          </div>
          <StatusIcon status={job.status} />
        </div>

        {job.status === 'running' && percent !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="download-progress h-full rounded-full bg-gradient-to-r from-anime-purple to-anime-pink"
                style={{ width: `${Math.max(2, percent)}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-white/60">
              {Math.round(percent)}%
            </span>
          </div>
        )}

        <p
          className={`mt-1 truncate text-[11px] ${job.status === 'failed' ? 'text-red-300/80' : 'text-white/45'}`}
        >
          {describeJob(job)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-center justify-center">
        {isActive && (
          <IconButton label="Cancel download" onClick={() => onCancel(job.id)}>
            <X className="h-4 w-4" />
          </IconButton>
        )}
        {canRetry && (
          <IconButton label="Retry download" onClick={() => onRetry(job.id)}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
        )}
        {isSettled && (
          <IconButton label="Remove from list" onClick={() => onRemove(job.id)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>
    </li>
  );
};

export default DownloadJobRow;
