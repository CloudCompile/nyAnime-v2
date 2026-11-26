/**
 * The device's library: watchlist, resume history and favourites.
 *
 * There are no accounts in this app. Everything a viewer saves belongs to the
 * browser they saved it in, under one implicit profile — no email, no password,
 * no session, and nothing transmitted anywhere. That is a deliberate trade: the
 * previous "authentication" only wrote bcrypt hashes and emails into this same
 * localStorage, so it protected nothing it claimed to, while making the
 * watchlist and resume features unusable until a visitor "registered".
 *
 * The record is small enough that reading it whole on each use is cheaper than
 * a subscription model, and it is written back atomically per change.
 */

const STORAGE_KEY = 'nyanime.library';

// Keys written by the removed account system. They are migrated once and then
// deleted, so stored emails and password hashes do not linger in the browser.
const LEGACY_USERS_KEY = 'anime_streaming_users';
const LEGACY_SESSION_KEY = 'anime_streaming_current_user';
const LEGACY_USER_ID_KEY = 'userId';
const LEGACY_USER_KEY = 'user';

/** Resume history keeps the most recent entries; older ones fall off. */
const HISTORY_LIMIT = 20;

export interface SavedAnime {
  animeId: string;
  addedAt: string;
}

export interface HistoryEntry {
  animeId: string;
  /** Episode number, as shown in the player. */
  episodeId: number;
  /** Percentage watched, 0-100. */
  progress: number;
  /** Playback position in seconds, used to resume. */
  timestamp: number;
  lastWatched: string;
}

export interface Library {
  watchlist: SavedAnime[];
  history: HistoryEntry[];
  favorites: SavedAnime[];
}

const empty = (): Library => ({ watchlist: [], history: [], favorites: [] });

let cache: Library | null = null;

function toIso(value: unknown, fallback = new Date()): string {
  const date = value ? new Date(value as string) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function normaliseSaved(entries: unknown): SavedAnime[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is { animeId?: unknown; addedAt?: unknown } => Boolean(entry))
    .filter((entry) => entry.animeId !== undefined && entry.animeId !== null && `${entry.animeId}` !== '')
    .map((entry) => ({ animeId: String(entry.animeId), addedAt: toIso(entry.addedAt) }));
}

function normaliseHistory(entries: unknown): HistoryEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => entry.animeId !== undefined && entry.animeId !== null && `${entry.animeId}` !== '')
    .map((entry) => ({
      animeId: String(entry.animeId),
      episodeId: Number(entry.episodeId) || 1,
      progress: Math.min(100, Math.max(0, Number(entry.progress) || 0)),
      timestamp: Math.max(0, Number(entry.timestamp) || 0),
      lastWatched: toIso(entry.lastWatched),
    }))
    .sort((a, b) => Date.parse(b.lastWatched) - Date.parse(a.lastWatched))
    .slice(0, HISTORY_LIMIT);
}

function parse(raw: string | null): Library | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Library>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      watchlist: normaliseSaved(parsed.watchlist),
      history: normaliseHistory(parsed.history),
      favorites: normaliseSaved(parsed.favorites),
    };
  } catch {
    return null;
  }
}

/**
 * Lift the saved lists out of the old fake-account store, once. The signed-in
 * account wins, then the last stored profile, then whichever account exists —
 * a browser with several fake users can only keep one library now, and the one
 * the viewer was actually using is the least surprising choice.
 */
function migrateLegacy(): Library | null {
  try {
    const raw = localStorage.getItem(LEGACY_USERS_KEY);
    const users = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : null;
    const sessionId = localStorage.getItem(LEGACY_USER_ID_KEY);

    let chosen: Record<string, unknown> | null = null;
    if (Array.isArray(users) && users.length > 0) {
      chosen = users.find((user) => String(user?.id) === String(sessionId)) ?? users[0];
    }
    if (!chosen) {
      const stored = localStorage.getItem(LEGACY_USER_KEY);
      if (stored) chosen = JSON.parse(stored) as Record<string, unknown>;
    }
    if (!chosen) return null;

    return {
      watchlist: normaliseSaved(chosen.watchlist),
      history: normaliseHistory(chosen.history),
      favorites: normaliseSaved(chosen.favorites),
    };
  } catch {
    return null;
  }
}

function clearLegacy(): void {
  for (const key of [LEGACY_USERS_KEY, LEGACY_SESSION_KEY, LEGACY_USER_ID_KEY, LEGACY_USER_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable (private mode, quota); nothing to clean up.
    }
  }
}

function write(library: Library): Library {
  cache = library;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    // A full or disabled storage still lets the session work in memory.
  }
  // Pages that render the library (Library, Continue Watching) listen for this
  // so a favourite toggled from a card disappears without a reload.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nyanime:library-changed'));
  }
  return library;
}

/** The whole library. Migrates the old account store on first use. */
export function getLibrary(): Library {
  if (cache) return cache;

  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = parse(stored);
  if (parsed) {
    cache = parsed;
    // Old keys can outlive the migration if it failed halfway through.
    if (localStorage.getItem(LEGACY_USERS_KEY) || localStorage.getItem(LEGACY_SESSION_KEY)) {
      clearLegacy();
    }
    return parsed;
  }

  const migrated = migrateLegacy();
  const library = write(migrated ?? empty());
  if (migrated) clearLegacy();
  return library;
}

export function isInWatchlist(animeId: string): boolean {
  return getLibrary().watchlist.some((entry) => entry.animeId === String(animeId));
}

export function isFavorite(animeId: string): boolean {
  return getLibrary().favorites.some((entry) => entry.animeId === String(animeId));
}

export function addToWatchlist(animeId: string): Library {
  const id = String(animeId);
  const library = getLibrary();
  if (library.watchlist.some((entry) => entry.animeId === id)) return library;
  return write({
    ...library,
    watchlist: [{ animeId: id, addedAt: new Date().toISOString() }, ...library.watchlist],
  });
}

export function removeFromWatchlist(animeId: string): Library {
  const id = String(animeId);
  const library = getLibrary();
  return write({
    ...library,
    watchlist: library.watchlist.filter((entry) => entry.animeId !== id),
  });
}

export function toggleFavorite(animeId: string): Library {
  const id = String(animeId);
  const library = getLibrary();
  const exists = library.favorites.some((entry) => entry.animeId === id);
  return write({
    ...library,
    favorites: exists
      ? library.favorites.filter((entry) => entry.animeId !== id)
      : [{ animeId: id, addedAt: new Date().toISOString() }, ...library.favorites],
  });
}

/**
 * Record playback progress. One entry per anime+episode, most recent first, so
 * Continue Watching shows the latest thing the viewer touched.
 */
export function updateWatchHistory(
  animeId: string,
  episodeId: number,
  progress: number,
  timestamp = 0,
): HistoryEntry[] {
  const id = String(animeId);
  const library = getLibrary();
  const now = new Date().toISOString();
  const entry: HistoryEntry = {
    animeId: id,
    episodeId: Number(episodeId) || 1,
    progress: Math.min(100, Math.max(0, Math.round(Number(progress) || 0))),
    timestamp: Math.max(0, Math.round(Number(timestamp) || 0)),
    lastWatched: now,
  };

  const rest = library.history.filter(
    (item) => !(item.animeId === id && item.episodeId === entry.episodeId),
  );
  const history = [entry, ...rest].slice(0, HISTORY_LIMIT);
  write({ ...library, history });
  return history;
}

export function removeFromWatchHistory(animeId: string): HistoryEntry[] {
  const id = String(animeId);
  const library = getLibrary();
  const history = library.history.filter((entry) => entry.animeId !== id);
  write({ ...library, history });
  return history;
}

/** Wipe the library on this device. */
export function clearLibrary(): void {
  write(empty());
}
