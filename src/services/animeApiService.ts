/**
 * Client for the animeapi instance (CloudCompile/animeapiapi) that fronts the
 * aniwaves.ru catalogue.
 *
 * The public API is CORS-open, so the browser talks to it directly. The stream
 * CDN is not: it pins `Access-Control-Allow-Origin` to its own player origin,
 * so playlists and segments must go through the proxy described in
 * `src/lib/streamProxy.ts`.
 */

export const ANIME_API_BASE =
  (import.meta.env.VITE_ANIME_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://animeapi.cjhauser.me';

/** The `Referer` the stream CDN expects. Segments 404 without it. */
export const STREAM_REFERER = 'https://play.echovideo.ru/';

export class AnimeApiError extends Error {}

export interface AnimeSummary {
  /** Canonical slug id, e.g. `sousou-no-frieren-74575`. */
  id: string;
  /** Numeric upstream id, e.g. `74575`. */
  dataId: string;
  title: string;
  japaneseTitle?: string;
  poster?: string;
  showType?: string;
  sub?: number;
  dub?: number;
  eps?: number;
  rating?: string;
  /** Only present on spotlights in the home payload. */
  description?: string;
}

export interface AnimeDetail extends AnimeSummary {
  description?: string;
  genres?: string[];
  studios?: string[];
  producers?: string[];
  status?: string;
  duration?: string;
  aired?: string;
  premiered?: string;
  country?: string[];
  type?: string;
  score?: string;
  totalEpisodes?: number;
  recommendations?: AnimeSummary[];
  related?: AnimeSummary[];
  popular?: AnimeSummary[];
}

export interface EpisodeSummary {
  /** Episode key accepted by `/api/stream`, e.g. `74575_1`. */
  key: string;
  /** Full id as returned by the API, e.g. `sousou-no-frieren-74575?ep=74575_1`. */
  id: string;
  number: number;
  title: string;
  japaneseTitle?: string;
  filler: boolean;
  subbed: boolean;
  dubbed: boolean;
}

export interface ServerOption {
  type: 'sub' | 'dub';
  serverName: string;
  dataId: number;
  serverId: number;
}

export interface SubtitleTrack {
  file: string;
  label: string;
  kind: string;
  default?: boolean;
}

export interface StreamResult {
  /** Master playlist URL, or null when the server only offers an embed. */
  file: string | null;
  /** Embed URL, or null when the server offers a direct stream. */
  iframe: string | null;
  server: string;
  type: string;
  tracks: SubtitleTrack[];
  intro: number[];
  outro: number[];
  servers: ServerOption[];
}

export interface ListPage<T> {
  items: T[];
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Read a field the API may return as a string or number. */
function pick(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return '';
}

function mapSummary(row: unknown): AnimeSummary {
  const record = (row ?? {}) as Record<string, unknown>;
  const info = (record.tvInfo ?? {}) as Record<string, unknown>;
  const poster = pick(record, 'poster', 'image');
  return {
    id: pick(record, 'id'),
    dataId: pick(record, 'data_id', 'dataId'),
    title: pick(record, 'title', 'name'),
    japaneseTitle: pick(record, 'japanese_title') || undefined,
    poster: poster || undefined,
    showType: pick(info, 'showType') || undefined,
    sub: asNumber(info.sub) || undefined,
    dub: asNumber(info.dub) || undefined,
    eps: asNumber(info.eps) || undefined,
    rating: pick(record, 'rating') || undefined,
    description: pick(record, 'description') || undefined,
  };
}

function mapSummaryList(rows: unknown): AnimeSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(mapSummary).filter((item) => item.id);
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${ANIME_API_BASE}${path}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AnimeApiError(
      `Could not reach the anime API: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new AnimeApiError(`The anime API returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new AnimeApiError('The anime API returned a response that was not JSON.');
  }
}

/** Read the `results` envelope, surfacing the API's own error message. */
function results(payload: unknown): unknown {
  const envelope = (payload ?? {}) as { success?: boolean; results?: unknown; message?: string };
  if (envelope.success === false) {
    throw new AnimeApiError(envelope.message || 'The anime API reported a failure.');
  }
  return envelope.results;
}

export async function getHome(signal?: AbortSignal): Promise<{
  spotlights: AnimeSummary[];
  trending: AnimeSummary[];
  topAiring: AnimeSummary[];
  mostPopular: AnimeSummary[];
  mostFavorite: AnimeSummary[];
  latestCompleted: AnimeSummary[];
  latestEpisode: AnimeSummary[];
  genres: string[];
}> {
  const data = (results(await getJson('/api/', signal)) ?? {}) as Record<string, unknown>;
  return {
    spotlights: mapSummaryList(data.spotlights),
    trending: mapSummaryList(data.trending),
    topAiring: mapSummaryList(data.topAiring),
    mostPopular: mapSummaryList(data.mostPopular),
    mostFavorite: mapSummaryList(data.mostFavorite),
    latestCompleted: mapSummaryList(data.latestCompleted),
    latestEpisode: mapSummaryList(data.latestEpisode),
    genres: Array.isArray(data.genres) ? (data.genres as string[]) : [],
  };
}

export async function getTopTen(signal?: AbortSignal): Promise<AnimeSummary[]> {
  const data = (results(await getJson('/api/top-ten', signal)) ?? {}) as { today?: unknown };
  return mapSummaryList(data.today);
}

export async function searchAnime(keyword: string, signal?: AbortSignal): Promise<AnimeSummary[]> {
  const query = keyword.trim();
  if (!query) return [];
  const data = (results(
    await getJson(`/api/search?keyword=${encodeURIComponent(query)}`, signal),
  ) ?? {}) as { data?: unknown };
  return dedupe(mapSummaryList(data.data));
}

export async function suggestAnime(keyword: string, signal?: AbortSignal): Promise<AnimeSummary[]> {
  const query = keyword.trim();
  if (!query) return [];
  const data = results(await getJson(`/api/search/suggest?keyword=${encodeURIComponent(query)}`, signal));
  return dedupe(mapSummaryList(data));
}

export async function getTopSearch(signal?: AbortSignal): Promise<{ title: string; id: string }[]> {
  const rows = results(await getJson('/api/top-search', signal));
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      const link = pick(record, 'link');
      return { title: pick(record, 'title'), id: link.split('/').pop() ?? '' };
    })
    .filter((item) => item.title && item.id);
}

/** Browse a category route such as `genre/action`, `top-airing` or `movie`. */
export async function browseCategory(
  route: string,
  page = 1,
  signal?: AbortSignal,
): Promise<ListPage<AnimeSummary>> {
  const data = (results(
    await getJson(`/api/${route}?page=${page}`, signal),
  ) ?? {}) as Record<string, unknown>;
  const items = dedupe(mapSummaryList(data.data));
  const currentPage = asNumber(data.currentPage) || page;
  // Category routes (`/api/genre/...`, `/api/movie`, ...) return `totalPages`,
  // while `/api/filter` returns `totalPage`. Read both, and fall back to a
  // derived `hasNextPage` because the category routes do not send one.
  const totalPages = asNumber(data.totalPages) || asNumber(data.totalPage) || 1;
  return {
    items,
    currentPage,
    totalPages,
    hasNextPage:
      typeof data.hasNextPage === 'boolean' ? data.hasNextPage : currentPage < totalPages,
  };
}

export interface FilterParams {
  keyword?: string;
  genre?: string;
  year?: string;
  season?: string;
  type?: string;
  status?: string;
  page?: number;
}

export async function filterAnime(
  params: FilterParams,
  signal?: AbortSignal,
): Promise<ListPage<AnimeSummary>> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.genre) query.set('genres', params.genre);
  if (params.year) query.set('sy', params.year);
  if (params.season) query.set('season', params.season);
  if (params.type) query.set('type', params.type);
  if (params.status) query.set('status', params.status);
  query.set('page', String(params.page ?? 1));
  const data = (results(
    await getJson(`/api/filter?${query.toString()}`, signal),
  ) ?? {}) as Record<string, unknown>;
  const items = dedupe(mapSummaryList(data.data));
  const currentPage = asNumber(data.currentPage) || params.page || 1;
  const totalPages = asNumber(data.totalPages) || asNumber(data.totalPage) || 1;
  return {
    items,
    currentPage,
    totalPages,
    hasNextPage:
      typeof data.hasNextPage === 'boolean' ? data.hasNextPage : currentPage < totalPages,
  };
}

export async function getAnimeInfo(id: string, signal?: AbortSignal): Promise<AnimeDetail | null> {
  const payload = (results(
    await getJson(`/api/info?id=${encodeURIComponent(id)}`, signal),
  ) ?? {}) as { data?: unknown };
  const data = dataOrNull(payload.data);
  if (!data) return null;
  const info = (data.animeInfo ?? {}) as Record<string, unknown>;
  const tvInfo = (info.tvInfo ?? {}) as Record<string, unknown>;
  const genre = Array.isArray(info.Genre) ? (info.Genre as string[]) : [];
  const episodesField = asString(info.Episodes);

  return {
    id: pick(data, 'id') || id,
    dataId: pick(data, 'data_id', 'dataId'),
    title: pick(data, 'title'),
    japaneseTitle: pick(data, 'japanese_title') || undefined,
    poster: pick(data, 'poster') || undefined,
    showType: pick(data, 'showType') || pick(info, 'Type') || undefined,
    sub: asNumber(tvInfo.sub) || undefined,
    dub: asNumber(tvInfo.dub) || undefined,
    eps: asNumber(episodesField.split('/').pop()) || undefined,
    rating: pick(info, 'Scores') || undefined,
    description: pick(info, 'Overview') || undefined,
    genres: genre,
    studios: Array.isArray(info.Studios) ? (info.Studios as string[]) : [],
    producers: Array.isArray(info.Producers) ? (info.Producers as string[]) : [],
    status: pick(info, 'Status') || undefined,
    duration: pick(info, 'Duration') || undefined,
    aired: pick(info, 'Date aired') || undefined,
    premiered: Array.isArray(info.Premiered) ? asString(info.Premiered[0]) : undefined,
    country: Array.isArray(info.Country) ? (info.Country as string[]) : [],
    type: pick(info, 'Type') || undefined,
    score: pick(info, 'Scores') || undefined,
    totalEpisodes: asNumber(episodesField.split('/').pop()) || undefined,
    recommendations: mapSummaryList(data.recommended_data),
    related: mapSummaryList(flattenRelated(data.related_data)),
    popular: mapSummaryList(data.popular_data),
  };
}

function dataOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** `related_data` is keyed by relation type; flatten it into one list. */
function flattenRelated(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value;
  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    Array.isArray(entry) ? entry : [],
  );
}

export async function getEpisodes(id: string, signal?: AbortSignal): Promise<EpisodeSummary[]> {
  const data = (results(
    await getJson(`/api/episodes/${encodeURIComponent(id)}`, signal),
  ) ?? {}) as { episodes?: unknown };
  if (!Array.isArray(data.episodes)) return [];
  return data.episodes
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      const fullId = pick(record, 'id');
      // Prefer the composite `<dataId>_<n>` key the stream route expects.
      const key = fullId.includes('?ep=') ? fullId.split('?ep=')[1] : fullId;
      return {
        key,
        id: fullId,
        number: asNumber(record.episode_no),
        title: pick(record, 'title') || `Episode ${asNumber(record.episode_no)}`,
        japaneseTitle: pick(record, 'japanese_title') || undefined,
        filler: Boolean(record.filler),
        subbed: record.subbed !== false,
        dubbed: Boolean(record.dubbed),
      };
    })
    .filter((episode) => episode.key);
}

export async function getServers(episodeKey: string, signal?: AbortSignal): Promise<ServerOption[]> {
  const rows = results(
    await getJson(`/api/servers/${encodeURIComponent(episodeKey)}`, signal),
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      const type = pick(record, 'type').toLowerCase() === 'dub' ? 'dub' : 'sub';
      return {
        type: type as 'sub' | 'dub',
        serverName: pick(record, 'serverName', 'server_name'),
        dataId: asNumber(record.data_id),
        serverId: asNumber(record.server_id),
      };
    })
    .filter((server) => server.serverName);
}

/**
 * Resolve a playable stream for an episode. `server` and `type` are optional;
 * the API falls back to its first available server.
 */
export async function getStream(
  episodeKey: string,
  options: { server?: string; type?: 'sub' | 'dub'; fallback?: boolean } = {},
  signal?: AbortSignal,
): Promise<StreamResult> {
  const query = new URLSearchParams({ id: episodeKey });
  if (options.server) query.set('server', options.server);
  if (options.type) query.set('type', options.type);
  const path = options.fallback ? '/api/stream/fallback' : '/api/stream';
  const payload = (results(await getJson(`${path}?${query.toString()}`, signal)) ?? {}) as {
    streamingLink?: unknown;
    servers?: unknown;
  };
  const link = (Array.isArray(payload.streamingLink) ? payload.streamingLink[0] : payload.streamingLink) as
    | Record<string, unknown>
    | undefined;
  const file = (link?.link ?? {}) as Record<string, unknown>;
  const tracks = Array.isArray(link?.tracks) ? (link?.tracks as SubtitleTrack[]) : [];
  return {
    file: pick(file, 'file') || null,
    iframe: pick(link ?? {}, 'iframe') || null,
    server: pick(link ?? {}, 'server'),
    type: pick(link ?? {}, 'type'),
    tracks,
    intro: Array.isArray(link?.intro) ? (link?.intro as number[]) : [],
    outro: Array.isArray(link?.outro) ? (link?.outro as number[]) : [],
    servers: mapServers(payload.servers),
  };
}

function mapServers(rows: unknown): ServerOption[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      return {
        type: (pick(record, 'type').toLowerCase() === 'dub' ? 'dub' : 'sub') as 'sub' | 'dub',
        serverName: pick(record, 'serverName', 'server_name'),
        dataId: asNumber(record.data_id),
        serverId: asNumber(record.server_id),
      };
    })
    .filter((server) => server.serverName);
}

export async function getRandomId(signal?: AbortSignal): Promise<string> {
  const data = results(await getJson('/api/random/id', signal));
  if (typeof data === 'string') return data;
  const record = (data ?? {}) as Record<string, unknown>;
  return pick(record, 'id');
}

export function dedupe(items: AnimeSummary[]): AnimeSummary[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}
