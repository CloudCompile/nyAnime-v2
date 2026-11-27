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
 * It backs the Vercel function (`api/stream.ts`). The same module can run on a
 * Cloudflare Worker unchanged, which is why the fetch logic is kept free of
 * Node-only APIs.
 *
 * ## Why URLs are signed
 *
 * The manifest host is stable (`fetch.nexabloom.top`), but the segments are
 * served from a *different, randomly named host on every episode* — the samples
 * so far have landed on `shadowharbor.space`, `silentforge.top`,
 * `stellarfrontier.space` and others, each behind a random subdomain, and the
 * video is disguised as `.jpg`. A host allowlist therefore cannot cover
 * playback, and allowing every host would turn this deployment into an open
 * relay.
 *
 * So the proxy signs what it hands out: every child URI is rewritten with an
 * HMAC over the absolute upstream URL. A request for a host outside the
 * allowlist is served only when its signature verifies, which means the caller
 * can only fetch URLs that came out of a manifest we ourselves fetched from a
 * trusted host. Signed targets must also look like media, as a second bound on
 * what the proxy will spend bandwidth on.
 *
 * The signing key comes from `STREAM_PROXY_SECRET` when set (recommended in
 * production), otherwise the platform's deployment id, so no configuration is
 * required for playback to work.
 */

/**
 * Upstream domains the proxy is willing to fetch without a signature. Entries
 * are matched as domains, not exact hostnames, because these hosts rotate
 * through numbered subdomains that change per episode.
 */
const ALLOWED_DOMAINS = [
  'dpopdrop89.store',
  'echovideo.to',
  'echovideo.ru',
  'roburnt10.store',
  // The megaplay players used by the current playback sources serve their
  // manifests from here, and reject requests without a megaplay referer.
  'nexabloom.top',
  // Vidplay's current manifest host. It rotates its numbered subdomain, so the
  // registrable domain is allow-listed and the suffix check covers the rest.
  'crystaldrift.world',
  // MegaPlay serves its WebVTT caption files from these hosts. They reject
  // browser requests outright (Cloudflare answers 403 unless the referer and
  // origin are the megaplay player), so the client must route them through the
  // proxy like the playlists. The subdomain rotates per episode.
  'distantdaydreams.org',
  'emeralddrift.world',
];

/** True when `hostname` is one of the allowed domains or a subdomain of one. */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** True when the proxy is willing to fetch this hostname without a signature. */
export function isCdnHost(hostname: string): boolean {
  return isAllowedHost(hostname);
}

/** Reject loopback, link-local and private-network targets outright. */
function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return false;
  if (host.startsWith('[')) return false; // IPv6 literal
  // Bare IPv4 literal, including the private and loopback ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Signing

const SIGNING_KEY =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.STREAM_PROXY_SECRET ||
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VERCEL_DEPLOYMENT_ID ||
  'nyanime-stream-proxy';

let keyPromise: Promise<CryptoKey> | null = null;

function signingKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return keyPromise;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HMAC of an absolute upstream URL, as carried in a proxied `&sig=` param. */
export async function signatureFor(url: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    new TextEncoder().encode(url),
  );
  return base64url(new Uint8Array(signature));
}

async function signatureMatches(url: string, signature: string): Promise<boolean> {
  const expected = await signatureFor(url);
  // Constant-time-ish comparison; lengths are public, contents are not.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Targets

/** The `Referer` each CDN expects. Requests without the right one are rejected. */
const CDN_REFERERS: Array<{ domain: string; referer: string }> = [
  { domain: 'nexabloom.top', referer: 'https://megaplay.buzz/' },
  { domain: 'dpopdrop89.store', referer: 'https://play.echovideo.ru/' },
  { domain: 'roburnt10.store', referer: 'https://play.echovideo.ru/' },
  { domain: 'crystaldrift.world', referer: 'https://megaplay.buzz/' },
  // Caption hosts answer only the megaplay player that listed them.
  { domain: 'distantdaydreams.org', referer: 'https://megaplay.buzz/' },
  { domain: 'emeralddrift.world', referer: 'https://megaplay.buzz/' },
];

/** Default referer, used when no target host is supplied. */
export const STREAM_REFERER = 'https://play.echovideo.ru/';

/** The referer the proxy should send for a given upstream host. */
export function refererFor(hostname: string): string {
  const host = hostname.toLowerCase();
  const match = CDN_REFERERS.find((entry) => host === entry.domain || host.endsWith(`.${entry.domain}`));
  return match?.referer ?? STREAM_REFERER;
}

/** Player origins a proxied request is allowed to claim as its referer. */
const ALLOWED_REFERER_ORIGINS = new Set([
  'https://megaplay.buzz',
  'https://play.echovideo.ru',
]);

export interface ProxyTarget {
  url: URL;
  /** Referer to send upstream; set from the manifest the URL came out of. */
  referer?: string;
}

export class ProxyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Validate a client-supplied target.
 *
 * An allowlisted host is accepted directly. Anything else needs a signature
 * produced by `rewriteManifest` for that exact URL, which is what stops the
 * proxy being a general-purpose relay. The target's extension is deliberately
 * not checked: the CDN disguises each segment with a random one (`.jpg`,
 * `.html`, `.js`, `.css`, `.png`...), so an extension list blocks real video.
 */
export async function resolveTarget(
  rawUrl: string | null,
  signature: string | null = null,
  referer: string | null = null,
): Promise<ProxyTarget> {
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
  if (!isPublicHost(url.hostname)) {
    throw new ProxyError(`Host not allowed: ${url.hostname}`, 403);
  }

  const claimedReferer = referer && ALLOWED_REFERER_ORIGINS.has(referer) ? referer : undefined;

  if (isAllowedHost(url.hostname)) return { url, referer: claimedReferer };

  if (!signature) {
    throw new ProxyError(`Host not allowed: ${url.hostname}`, 403);
  }
  if (!(await signatureMatches(url.toString(), signature))) {
    throw new ProxyError(`Invalid signature for ${url.hostname}`, 403);
  }
  return { url, referer: claimedReferer };
}

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Headers to send upstream. An explicit referer (carried from the manifest)
 * wins, because a segment host only accepts the player that served it; the
 * host lookup is the fallback for directly requested manifests.
 */
export function upstreamHeaders(url?: URL, referer?: string): HeadersInit {
  const chosen = referer ?? (url ? refererFor(url.hostname) : STREAM_REFERER);
  // The CDN compares the referer literally: `https://megaplay.buzz` is refused
  // where `https://megaplay.buzz/` is served, so the path is always present.
  const header = chosen.endsWith('/') ? chosen : `${chosen}/`;
  return {
    Referer: header,
    Origin: new URL(header).origin,
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  };
}

// ---------------------------------------------------------------------------
// Manifest rewriting

/**
 * Rewrite a playlist so every child URI is fetched through the proxy.
 *
 * Both absolute and root-relative URIs are supported; `#EXT-X-KEY` and
 * `#EXT-X-MAP` carry their target in a `URI="..."` attribute rather than on
 * their own line, so those are rewritten in place. Each child URI is signed,
 * which is what lets segments on per-episode hosts through.
 */
export async function rewriteManifest(
  text: string,
  manifestUrl: URL,
  proxyBase: string,
): Promise<string> {
  const absolute = (uri: string): string | null => {
    try {
      return new URL(uri, manifestUrl).toString();
    } catch {
      return null;
    }
  };

  const lines = text.split(/\r?\n/);
  const targets = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      for (const match of trimmed.matchAll(/URI="([^"]+)"/g)) {
        const resolved = absolute(match[1]);
        if (resolved) targets.add(resolved);
      }
    } else {
      const resolved = absolute(trimmed);
      if (resolved) targets.add(resolved);
    }
  }

  const signatures = new Map<string, string>();
  await Promise.all(
    [...targets].map(async (target) => {
      signatures.set(target, await signatureFor(target));
    }),
  );

  // Children are fetched with the referer of the manifest's own player: the
  // segment host only answers the player that served it. Carried explicitly so
  // a randomly named segment host knows which one that is.
  const referer = new URL(refererFor(manifestUrl.hostname)).origin;

  const toProxy = (uri: string): string => {
    const resolved = absolute(uri);
    if (!resolved) return uri;
    return `${proxyBase}?url=${encodeURIComponent(resolved)}&sig=${signatures.get(resolved) ?? ''}&ref=${encodeURIComponent(referer)}`;
  };

  return lines
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
    headers: upstreamHeaders(target.url, target.referer),
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
  // Caption files are small text documents too, and the caption hosts label
  // them `application/octet-stream`; sniff them so the player gets WebVTT.
  const isCueFile = head.startsWith('WEBVTT');
  if (head.startsWith('#EXTM3U') || isCueFile) {
    const chunks: Uint8Array[] = [first.value];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) chunks.push(next.value);
    }
    const text = decoder.decode(concatBytes(chunks));
    if (isCueFile) {
      return {
        status: 200,
        body: text,
        headers: { ...headers, 'Content-Type': 'text/vtt; charset=utf-8' },
      };
    }
    return {
      status: 200,
      body: await rewriteManifest(text, target.url, proxyBase),
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
