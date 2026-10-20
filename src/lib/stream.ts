/**
 * Client-side helpers for talking to the stream CDN through the proxy.
 *
 * The CDN refuses cross-origin reads, so every playlist and segment request is
 * routed through `/api/stream?url=...`. In production that is the Vercel edge
 * function; in `vite dev` it is a middleware in `vite.config.ts`; on Cloudflare
 * it is `worker/index.ts`. All three rewrite manifests the same way, so the
 * player and the downloader never need to know which one answered.
 */
import { STREAM_REFERER } from '../services/animeApiService';

export { STREAM_REFERER };

/** Absolute URL of the proxy, resolved against the current origin. */
export function proxyBase(): string {
  const configured = import.meta.env.VITE_STREAM_PROXY_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  return `${window.location.origin}/api/stream`;
}

/** Wrap an upstream CDN URL so the proxy will serve it. */
export function proxied(url: string): string {
  return `${proxyBase()}?url=${encodeURIComponent(url)}`;
}

/** True when a URL already points at one of our proxies. */
export function isProxied(url: string): boolean {
  return url.includes('/api/stream?url=');
}

/**
 * True when a URL belongs to the stream CDN and therefore must be proxied.
 * The API returns both CDN file links and third-party embeds; only the former
 * need rewriting.
 */
export function needsProxy(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('dpopdrop89.store') || host.endsWith('echovideo.to') || host.endsWith('echovideo.ru');
  } catch {
    return false;
  }
}

/** Route a URL through the proxy if it is a CDN URL, otherwise leave it alone. */
export function maybeProxy(url: string): string {
  if (isProxied(url)) return url;
  return needsProxy(url) ? proxied(url) : url;
}
