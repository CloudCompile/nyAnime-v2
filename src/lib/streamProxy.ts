/**
 * Rewrites upstream HLS manifests so the player fetches everything through our
 * own proxy.
 *
 * The stream CDN pins `Access-Control-Allow-Origin` to its own player origin,
 * so a browser cannot read a playlist or a segment directly. The proxy fetches
 * upstream and re-serves with permissive CORS; this module is the piece that
 * makes the result playable by rewriting every URI in the manifest back to the
 * proxy.
 *
 * It is shared by the Vercel function (`api/stream.ts`) and the Cloudflare
 * Worker (`worker/index.ts`) so both stay byte-for-byte consistent.
 */

/**
 * Upstream domains the proxy is willing to fetch. Entries are matched as
 * domains, not exact hostnames, because the CDN rotates through numbered
 * subdomains (`ru-cdn2`, `ru-ri-cdn3`, ...) that change per episode.
 */
const ALLOWED_DOMAINS = [
  'dpopdrop89.store',
  'echovideo.to',
  'echovideo.ru',
];

/** True when `hostname` is one of the allowed domains or a subdomain of one. */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The `Referer` the CDN expects. Requests without it are rejected or 404. */
export const STREAM_REFERER = 'https://play.echovideo.ru/';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ProxyTarget {
  url: URL;
}

export class ProxyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Validate a client-supplied target. Only the CDN hosts are allowed, so the
 * proxy cannot be used as an open relay.
 */
export function resolveTarget(rawUrl: string | null): ProxyTarget {
  if (!rawUrl) throw new ProxyError('Missing url parameter.');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProxyError('Malformed url parameter.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProxyError('Only http(s) targets are supported.');
  }
  if (!isAllowedHost(url.hostname)) {
    throw new ProxyError(`Host not allowed: ${url.hostname}`, 403);
  }
  return { url };
}

/** Headers to send upstream. */
export function upstreamHeaders(): HeadersInit {
  return {
    Referer: STREAM_REFERER,
    Origin: 'https://play.echovideo.ru',
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  };
}

/**
 * Rewrite a playlist so every child URI is fetched through the proxy.
 *
 * Both absolute and root-relative URIs are supported; `#EXT-X-KEY` and
 * `#EXT-X-MAP` carry their target in a `URI="..."` attribute rather than on
 * their own line, so those are rewritten in place.
 */
export function rewriteManifest(
  text: string,
  manifestUrl: URL,
  proxyBase: string,
): string {
  const toProxy = (uri: string): string => {
    let absolute: string;
    try {
      absolute = new URL(uri, manifestUrl).toString();
    } catch {
      return uri;
    }
    return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." attributes on tags such as EXT-X-KEY / EXT-X-MAP.
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${toProxy(uri)}"`);
      }
      return toProxy(trimmed);
    })
    .join('\n');
}

/** Strip hop-by-hop and CORS headers that must not be copied downstream. */
export function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const blocked = new Set([
    'connection',
    'keep-alive',
    'transfer-encoding',
    'content-encoding',
    'content-length',
    // The CDN mislabels everything `image/jpeg`, and this module always sets
    // its own value, so the upstream header is dropped rather than duplicated.
    'content-type',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'content-security-policy',
    'x-frame-options',
  ]);
  headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) out[key] = value;
  });
  return out;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

/**
 * Fetch a proxied target and return a ready-to-send payload.
 *
 * The CDN labels every response `image/jpeg`, playlists included, and its media
 * playlists have no `.m3u8` marker in the URL — they are extensionless paths
 * under `/cdn/`. Neither the content type nor the URL can therefore identify a
 * playlist. The body is sniffed instead: a playlist starts with `#EXTM3U`, so
 * the first chunk decides. Playlists are small and get buffered so their URIs
 * can be rewritten; segments are passed through as a stream.
 */
export async function proxyFetch(
  target: ProxyTarget,
  proxyBase: string,
): Promise<{ status: number; body: BodyInit; headers: Record<string, string> }> {
  const response = await fetch(target.url.toString(), {
    headers: upstreamHeaders(),
    redirect: 'follow',
  });

  const headers = sanitizeResponseHeaders(response.headers);

  if (!response.ok) {
    return {
      status: response.status,
      body: await response.text().catch(() => ''),
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    };
  }

  if (!response.body) {
    // A HEAD request, or an empty body.
    return { status: response.status, body: new Uint8Array(), headers };
  }

  const reader = response.body.getReader();
  const first = await reader.read();
  if (first.done || !first.value) {
    return { status: response.status, body: new Uint8Array(), headers };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const head = decoder.decode(first.value.subarray(0, 64)).replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('#EXTM3U')) {
    const chunks: Uint8Array[] = [first.value];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) chunks.push(next.value);
    }
    const text = decoder.decode(concatBytes(chunks));
    return {
      status: 200,
      body: rewriteManifest(text, target.url, proxyBase),
      headers: { ...headers, 'Content-Type': 'application/vnd.apple.mpegurl' },
    };
  }

  // Not a playlist: re-emit the sniffed chunk, then pipe the rest through
  // untouched. `Content-Type` is corrected because the CDN's `image/jpeg` would
  // stop a strict player from decoding the MPEG-TS segment.
  headers['Content-Type'] = 'video/mp2t';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value);
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      if (next.value) controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { status: 200, body, headers };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
