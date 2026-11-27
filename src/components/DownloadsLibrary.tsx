import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Film, FolderOpen, Loader2, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { getDownloadManager } from '../hooks/useDownloads';
import type { DownloadJob } from '../lib/download/manager';
import { DOWNLOADS_CHANGED_EVENT } from '../lib/download/storage';
import { formatBytes } from '../lib/download/hls';
import { openDownloadDock } from '../lib/download/ui';
import {
  LOCAL_DOWNLOADS_CHANGED_EVENT,
  forgetDownloadFolder,
  getDownloadFolderName,
  importDownloadFolder,
  loadLocalDownloads,
  openLocalFile,
  removeLocalDownload,
  supportsFolderImport,
  type LocalDownload,
} from '../lib/download/localFolder';

function savedJobs(): DownloadJob[] {
  return getDownloadManager()
    .getJobs()
    .filter((job) => job.status === 'done')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
}

/**
 * The Downloads tab: episodes this app downloaded, plus episodes that were
 * already sitting in a folder from before the queue existed.
 *
 * The imported list stores only a path and its parsed episode; the file is
 * resolved from the remembered directory when Play is pressed, so nothing is
 * copied and an episode that was moved or deleted fails loudly instead of
 * showing a stale entry that looks playable.
 */
const DownloadsLibrary = () => {
  const [jobs, setJobs] = useState<DownloadJob[]>(savedJobs);
  const [local, setLocal] = useState<LocalDownload[]>(loadLocalDownloads);
  const [folderName, setFolderName] = useState<string | null>(getDownloadFolderName);
  const [importing, setImporting] = useState(false);
  const [player, setPlayer] = useState<{ url: string; title: string } | null>(null);
  const supported = supportsFolderImport();

  useEffect(() => {
    const syncJobs = () => setJobs(savedJobs());
    const syncLocal = () => {
      setLocal(loadLocalDownloads());
      setFolderName(getDownloadFolderName());
    };
    window.addEventListener(DOWNLOADS_CHANGED_EVENT, syncJobs);
    window.addEventListener(LOCAL_DOWNLOADS_CHANGED_EVENT, syncLocal);
    return () => {
      window.removeEventListener(DOWNLOADS_CHANGED_EVENT, syncJobs);
      window.removeEventListener(LOCAL_DOWNLOADS_CHANGED_EVENT, syncLocal);
    };
  }, []);

  // Release the object URL when the dialog closes (or a new file replaces it).
  useEffect(() => {
    if (!player) return;
    return () => URL.revokeObjectURL(player.url);
  }, [player]);

  const sortedLocal = useMemo(
    () =>
      [...local].sort(
        (a, b) => a.seriesTitle.localeCompare(b.seriesTitle) || a.episode - b.episode,
      ),
    [local],
  );

  const handleImport = async () => {
    if (!supported) {
      toast({
        title: 'This browser cannot remember a folder',
        description: 'Chrome or Edge can keep one between visits. Elsewhere the folder has to be picked again each session.',
        variant: 'destructive',
      });
      return;
    }
    setImporting(true);
    try {
      const result = await importDownloadFolder();
      if (!result) return; // The picker was cancelled.
      toast({
        title:
          result.total === 0
            ? 'No video files in that folder'
            : `Found ${result.total} video${result.total === 1 ? '' : 's'}`,
        description:
          result.total === 0
            ? 'Choose the folder your episodes were saved in. Subfolders are searched too.'
            : `${result.added} new · “${result.folderName}” is remembered for playback.`,
      });
    } catch {
      toast({
        title: 'Could not read that folder',
        description: 'Choose it again and allow read access when the browser asks.',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleForget = async () => {
    await forgetDownloadFolder();
    toast({
      title: 'Folder forgotten',
      description: 'The imported entries are gone from this list. The files themselves are untouched.',
    });
  };

  const handlePlayLocal = async (record: LocalDownload) => {
    try {
      const file = await openLocalFile(record.path);
      setPlayer({
        url: URL.createObjectURL(file),
        title: `${record.seriesTitle} · Episode ${record.episode}`,
      });
    } catch {
      toast({
        title: 'Could not open that file',
        description:
          'The folder permission may have expired, or the file was moved. Import the folder again to refresh the list.',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveLocal = (record: LocalDownload) => {
    removeLocalDownload(record.path);
    toast({
      title: 'Removed from the list',
      description: 'The file itself is still in your folder.',
    });
  };

  const jobBytes = jobs.reduce((sum, job) => sum + (job.fileSize ?? job.bytes ?? 0), 0);
  const localBytes = local.reduce((sum, record) => sum + record.size, 0);
  const totalCount = jobs.length + local.length;

  return (
    <div className="space-y-6">
      <section className="glass-card rounded-xl p-4 md:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-anime-purple/15">
            <FolderOpen className="h-5 w-5 text-anime-purple" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white">Migrate existing downloads</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/55">
              Episodes saved before NyAnime kept a download list are just video files in a folder.
              Choose that folder and they appear here — nothing is copied, moved or uploaded, and
              playback reads them where they are.
            </p>
            {folderName && (
              <p className="mt-2 text-[11px] text-white/40">
                Remembered folder: <span className="text-white/60">{folderName}</span>
              </p>
            )}
          </div>
          {supported && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleImport} disabled={importing}>
                {importing ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="mr-1 h-3.5 w-3.5" />
                )}
                {importing ? 'Scanning…' : folderName ? 'Choose another folder' : 'Choose folder'}
              </Button>
              {local.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/60 hover:bg-white/10 hover:text-white"
                  onClick={() => void handleForget()}
                >
                  Forget
                </Button>
              )}
            </div>
          )}
        </div>
        {!supported && (
          <p className="mt-3 text-[11px] leading-relaxed text-amber-300/80">
            This browser cannot keep a folder between visits, so existing files cannot be played in
            place here. Chrome or Edge can do it.
          </p>
        )}
      </section>

      {totalCount === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-14 text-center">
          <Download className="mx-auto mb-3 h-8 w-8 text-white/25" />
          <p className="text-white/70">No downloads yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-white/45">
            Open any episode and choose Download, or migrate a folder of episodes you already have.
          </p>
          <Button size="sm" variant="secondary" className="mt-4" onClick={openDownloadDock}>
            Open the download queue
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
            <span>
              {totalCount} episode{totalCount === 1 ? '' : 's'}
              {jobBytes + localBytes > 0 ? ` · ${formatBytes(jobBytes + localBytes)}` : ''} saved on
              this device
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={openDownloadDock}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Manage downloads
            </Button>
          </div>

          {jobs.length > 0 && (
            <section>
              {local.length > 0 && (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                  Downloaded with NyAnime
                </h3>
              )}
              <ul className="glass-card divide-y divide-white/5 rounded-xl p-1">
                {jobs.map((job) => (
                  <li key={job.id} className="flex items-center gap-3 p-3">
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                      {job.poster ? (
                        <img
                          src={job.poster}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white/30">
                          {job.episode.number}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{job.seriesTitle}</p>
                      <p className="text-xs text-white/50">
                        Episode {job.episode.number}
                        {job.fileSize ? ` · ${formatBytes(job.fileSize)}` : ''}
                        {job.finishedAt
                          ? ` · ${new Date(job.finishedAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}`
                          : ''}
                      </p>
                      {job.filename && (
                        <p className="truncate text-[11px] text-white/30">{job.filename}</p>
                      )}
                    </div>

                    {job.seriesId && (
                      <Button size="sm" variant="secondary" asChild>
                        <Link to={`/anime/${job.seriesId}/watch?ep=${job.episode.number}`}>
                          <Play className="mr-1 h-3.5 w-3.5" />
                          Play
                        </Link>
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => getDownloadManager().remove(job.id)}
                      aria-label="Remove from downloads list"
                      title="Remove from this list; the file stays on disk"
                      className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {local.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                Existing files{folderName ? ` in ${folderName}` : ''}
              </h3>
              <ul className="glass-card divide-y divide-white/5 rounded-xl p-1">
                {sortedLocal.map((record) => (
                  <li key={record.path} className="flex items-center gap-3 p-3">
                    <div className="grid h-14 w-10 shrink-0 place-items-center rounded bg-white/5">
                      <Film className="h-5 w-5 text-white/30" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{record.seriesTitle}</p>
                      <p className="text-xs text-white/50">
                        Episode {record.episode}
                        {record.size > 0 ? ` · ${formatBytes(record.size)}` : ''}
                      </p>
                      <p className="truncate text-[11px] text-white/30">{record.path}</p>
                    </div>

                    <Button size="sm" onClick={() => void handlePlayLocal(record)}>
                      <Play className="mr-1 h-3.5 w-3.5" fill="currentColor" />
                      Play
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleRemoveLocal(record)}
                      aria-label={`Remove ${record.name} from the list`}
                      title="Remove from this list; the file stays in the folder"
                      className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-white/35">
                Playback reads these files from the remembered folder; the browser may ask for
                access once per session. Nothing is copied or uploaded.
              </p>
            </section>
          )}
        </>
      )}

      <Dialog
        open={Boolean(player)}
        onOpenChange={(open) => {
          if (!open) setPlayer(null);
        }}
      >
        <DialogContent className="max-w-3xl border-white/10 bg-anime-darker p-3">
          <DialogHeader>
            <DialogTitle className="pr-8 text-left text-sm font-medium text-white">
              {player?.title ?? 'Local episode'}
            </DialogTitle>
            <DialogDescription className="text-left text-[11px] text-white/40">
              Playing from your downloads folder.
            </DialogDescription>
          </DialogHeader>
          {player && (
            <video
              key={player.url}
              src={player.url}
              controls
              autoPlay
              playsInline
              className="w-full rounded-lg bg-black"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DownloadsLibrary;
