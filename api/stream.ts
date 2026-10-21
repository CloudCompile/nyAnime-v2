/**
 * Vercel serverless proxy for the HLS stream CDN.
 *
 * Usage: `/api/stream?url=<absolute upstream url>`
 *
 * The CDN pins its CORS origin, so the browser cannot read playlists or
 * segments directly. This function fetches upstream, rewrites playlists so
 * their children point back here, and re-serves everything with open CORS.
 * The shared logic lives in `src/lib/streamProxy.ts`.
 */
import {
  CORS_HEADERS,
  ProxyError,
  proxyFetch,
  resolveTarget,
} from '../src/lib/streamProxy';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const target = resolveTarget(new URL(request.url).searchParams.get('url'));
    const proxyBase = `${origin}/api/stream`;
    const result = await proxyFetch(target, proxyBase);
    return new Response(result.body, {
      status: result.status,
      headers: { ...result.headers, ...CORS_HEADERS },
    });
  } catch (error) {
    if (error instanceof ProxyError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: error instanceof Error ? error.message : 'Proxy failed' },
      502,
    );
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
