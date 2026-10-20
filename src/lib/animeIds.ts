/**
 * The app routes anime by their numeric upstream id (e.g. `/anime/74575`),
 * which is what watch history and the watchlist store. The catalogue API,
 * however, needs the full slug (`sousou-no-frieren-74575`) for `/api/info`.
 *
 * Rather than issuing a lookup request on every page load, the slug seen in a
 * browse response is cached here. When a page is opened directly by numeric id
 * the cache usually has it already; otherwise the caller falls back to a
 * keyword search.
 */

const STORAGE_KEY = 'nyanime.slug-map';
const MAX_ENTRIES = 500;

type SlugMap = Record<string, string>;

let cache: SlugMap | null = null;

function load(): SlugMap {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as SlugMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(map: SlugMap): void {
  try {
    // Bound the map so it cannot grow without limit.
    const entries = Object.entries(map);
    const trimmed = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(-MAX_ENTRIES)) : map;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    cache = trimmed;
  } catch {
    /* Storage may be unavailable in private mode. */
  }
}

/** Remember the slug for a numeric id, so later visits skip a lookup. */
export function rememberSlug(dataId: string | undefined, slug: string): void {
  if (!dataId || !slug) return;
  const map = load();
  if (map[dataId] === slug) return;
  map[dataId] = slug;
  persist(map);
}

/** The cached slug for a numeric id, if one was seen this session or before. */
export function cachedSlug(dataId: string): string | null {
  return load()[dataId] ?? null;
}

/** The numeric id embedded in a slug, e.g. `one-piece-81553` -> `81553`. */
export function numericIdFromSlug(slug: string): string {
  return slug.split('-').pop() ?? slug;
}

/** True when a route id is already a full slug rather than a bare number. */
export function looksLikeSlug(value: string): boolean {
  return /[a-z]/i.test(value);
}
