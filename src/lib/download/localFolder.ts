/**
 * Downloads made before NyAnime kept a queue are just video files in a folder.
 *
 * Re-downloading them would be wasteful, so this module remembers one folder
 * the viewer picks, parses the episode names and plays the files in place.
 * Nothing is copied, moved or uploaded: `openLocalFile` hands the browser a
 * `File` straight from the remembered directory.
 *
 * A directory handle is structured-cloneable but not JSON, so it lives in
 * IndexedDB while the small records (path, size, parsed episode) stay in
 * localStorage next to the rest of the device library. A handle's read
 * permission does not survive a browser restart by itself, so playback asks for
 * it again from the click that opens the file.
 */

export interface LocalDownload {
  /** Path inside the remembered folder, using `/` between segments. */
  path: string;
  /** File name only, for display. */
  name: string;
  /** Series title parsed from the file name, or the name itself. */
  seriesTitle: string;
  episode: number;
  size: number;
  addedAt: number;
}

export interface ImportResult {
  folderName: string;
  /** Records that were not already in the list. */
  added: number;
  /** Video files found in the folder, including ones already listed. */
  total: number;
}

const RECORDS_KEY = 'nyanime.downloads.local';
const FOLDER_KEY = 'nyanime.downloads.local.folder';
export const LOCAL_DOWNLOADS_CHANGED_EVENT = 'nyanime:local-downloads-changed';

const DB_NAME = 'nyanime.library';
const DB_VERSION = 1;
const HANDLE_STORE = 'handles';
const ROOT_HANDLE_KEY = 'legacy-downloads-folder';

// Formats a <video> element can actually play. Raw .ts files are skipped: they
// are what the queue writes for the TS option, and no browser plays them
// without hls.js.
const VIDEO_EXTENSION = /\.(mp4|m4v|webm|mov)$/i;
const MAX_FILES = 2000;
const MAX_DEPTH = 4;

export const supportsFolderImport = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// --- storage --------------------------------------------------------------

/**
 * The DOM lib shipped with this TypeScript version predates parts of the File
 * System Access API, so the few members this module needs are declared here
 * rather than sprinkled through the code as casts.
 */
type DirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
};

interface PermissionCapableHandle {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function readRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(ROOT_HANDLE_KEY);
      request.onsuccess = () =>
        resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(HANDLE_STORE, 'readwrite');
    transaction.objectStore(HANDLE_STORE).put(handle, ROOT_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteRootHandle(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(HANDLE_STORE, 'readwrite');
      transaction.objectStore(HANDLE_STORE).delete(ROOT_HANDLE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // No database, no stored handle.
  }
}

export function loadLocalDownloads(): LocalDownload[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Partial<LocalDownload> => Boolean(entry) && typeof entry === 'object')
      .filter((entry): entry is Partial<LocalDownload> & { path: string } => typeof entry.path === 'string' && entry.path.length > 0)
      .map((entry) => ({
        path: entry.path,
        name: typeof entry.name === 'string' && entry.name ? entry.name : (entry.path.split('/').pop() ?? entry.path),
        seriesTitle:
          typeof entry.seriesTitle === 'string' && entry.seriesTitle.trim()
            ? entry.seriesTitle
            : 'Unknown series',
        episode: Number.isFinite(entry.episode) && Number(entry.episode) > 0 ? Number(entry.episode) : 1,
        size: Number.isFinite(entry.size) && Number(entry.size) > 0 ? Number(entry.size) : 0,
        addedAt: Number.isFinite(entry.addedAt) ? Number(entry.addedAt) : Date.now(),
      }));
  } catch {
    return [];
  }
}

function writeLocalDownloads(records: LocalDownload[]): void {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // A full or disabled storage still works for this session through state.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_DOWNLOADS_CHANGED_EVENT));
  }
}

export function getDownloadFolderName(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

function writeFolderName(name: string | null): void {
  try {
    if (name) localStorage.setItem(FOLDER_KEY, name);
    else localStorage.removeItem(FOLDER_KEY);
  } catch {
    // Not fatal: the records still resolve through the stored handle.
  }
}

// --- file names -----------------------------------------------------------

const TRAILING_NOISE = /\[[^\]]*\]|\([^)]*(?:1080|720|480|hevc|x264|x265)[^)]*\)/gi;

function cleanSeries(text: string): string {
  return text
    .replace(/_+/g, ' ')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—.\s]+|[-–—.\s]+$/g, '')
    .trim();
}

/**
 * Best-effort name parsing, in order of how specific the marker is. The app's
 * own template (`{series} - {ep:02} - {title}`) is covered by the third rule,
 * and anything without an episode marker stays playable as episode 1 under its
 * own name rather than being dropped from the list.
 */
export function parseEpisodeName(filename: string): { seriesTitle: string; episode: number } {
  const base = filename
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(TRAILING_NOISE, ' ')
    .trim();

  const patterns: RegExp[] = [
    /^(.*?)[\s._-]*s\d{1,2}[\s._-]*e(\d{1,4})(?:[\s._-]+.*)?$/i,
    /^(.*?)[\s._-]+(?:episode|ep\.?|e)[\s._-]*(\d{1,4})(?:[\s._-]+.*)?$/i,
    /^(.*?)[\s._-]+-[\s._-]*(\d{1,4})(?:[\s._-]+-.*)?$/,
    /^(.*?)[\s._-]+(\d{1,4})(?:[\s._-]+-.*)?$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(base);
    if (!match) continue;
    const series = cleanSeries(match[1] ?? '');
    const episode = Number(match[2]);
    if (!series || !Number.isFinite(episode) || episode < 1 || episode > 2000) continue;
    return { seriesTitle: series, episode };
  }

  return { seriesTitle: cleanSeries(base) || 'Unknown series', episode: 1 };
}

// --- folder import --------------------------------------------------------

interface FoundVideo {
  path: string;
  name: string;
  size: number;
}

async function collectVideos(
  directory: DirectoryHandle,
  prefix = '',
  depth = 0,
): Promise<FoundVideo[]> {
  const found: FoundVideo[] = [];
  for await (const entry of directory.values()) {
    if (found.length >= MAX_FILES) break;
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      if (!VIDEO_EXTENSION.test(entry.name)) continue;
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        found.push({ path, name: entry.name, size: file.size });
      } catch {
        // A file can vanish between listing and reading; keep going.
      }
    } else if (depth < MAX_DEPTH) {
      found.push(...(await collectVideos(entry as DirectoryHandle, path, depth + 1)));
    }
  }
  return found;
}

async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: {
        mode?: string;
        id?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: 'read', id: 'nyanime-legacy-downloads' });
  } catch {
    // Cancelled; not an error worth surfacing.
    return null;
  }
}

/**
 * Ask for the folder, scan it, and remember it. Choosing a different folder
 * replaces the list, because "the folder" is singular: the files that are no
 * longer there could not be played anyway.
 */
export async function importDownloadFolder(): Promise<ImportResult | null> {
  const root = await pickFolder();
  if (!root) return null;

  const found = await collectVideos(root as DirectoryHandle);
  const previous = new Map(loadLocalDownloads().map((record) => [record.path, record]));
  const now = Date.now();

  const records = found.map((video) => {
    const existing = previous.get(video.path);
    if (existing) return { ...existing, size: video.size || existing.size };
    const parsed = parseEpisodeName(video.name);
    return { path: video.path, name: video.name, ...parsed, size: video.size, addedAt: now };
  });

  await writeRootHandle(root);
  writeFolderName(root.name);
  writeLocalDownloads(records);

  const added = records.filter((record) => !previous.has(record.path)).length;
  return { folderName: root.name, added, total: found.length };
}

export function removeLocalDownload(path: string): void {
  writeLocalDownloads(loadLocalDownloads().filter((record) => record.path !== path));
}

/** Drop the remembered folder and its list. The files themselves are untouched. */
export async function forgetDownloadFolder(): Promise<void> {
  await deleteRootHandle();
  writeFolderName(null);
  writeLocalDownloads([]);
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const capable = handle as unknown as PermissionCapableHandle;
  const descriptor = { mode: 'read' as const };
  if ((await capable.queryPermission(descriptor)) === 'granted') return true;
  // Must be reached from a user gesture; every caller is a click.
  return (await capable.requestPermission(descriptor)) === 'granted';
}

/**
 * Resolve a remembered path to a real file, asking for permission if the
 * browser dropped it since the last visit. Throws when the folder is gone, the
 * permission is refused, or the file has been moved or renamed.
 */
export async function openLocalFile(path: string): Promise<File> {
  const root = await readRootHandle();
  if (!root) throw new Error('No folder remembered');
  if (!(await ensureReadPermission(root))) throw new Error('Read permission was not granted');

  const segments = path.split('/').filter(Boolean);
  const filename = segments.pop();
  if (!filename) throw new Error('Invalid file path');

  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment);
  }
  const handle = await directory.getFileHandle(filename);
  return handle.getFile();
}
