import type { Connect, Plugin } from 'vite';
import {
  CORS_HEADERS,
  ProxyError,
  proxyFetch,
  resolveTarget,
} from '../src/lib/streamProxy';

/**
 * Serves `/api/stream` during `vite dev`, so the player and the downloader work
 * locally exactly as they do on Vercel. Without this, `npm run dev` would hit a
 * 404 and every stream would look broken.
 *
 * The handler is intentionally a thin adapter: all of the rewriting and header
 * logic lives in `src/lib/streamProxy.ts`, shared with the deployed function.
 */
export function streamProxyPlugin(): Plugin {
  return {
    name: 'nyanime-stream-proxy',
    configureServer(server) {
      server.middlewares.use('/api/stream', async (req, res) => {
        const respond = (
          status: number,
          body: BodyInit | null,
          headers: Record<string, string>,
        ) => {
          res.writeHead(status, { ...CORS_HEADERS, ...headers });
          if (body === null) res.end();
          else res.end(body);
        };

        if (req.method === 'OPTIONS') {
          respond(204, null, {});
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          respond(405, JSON.stringify({ error: 'Method not allowed' }), {
            'Content-Type': 'application/json',
          });
          return;
        }

        try {
          const origin = `http://${req.headers.host ?? 'localhost'}`;
          const target = resolveTarget(
            new URL(req.url ?? '', origin).searchParams.get('url'),
          );
          const result = await proxyFetch(target, `${origin}/api/stream`);

          // A streamed body is piped rather than buffered, so a large segment
          // never has to fit in the dev server's memory.
          res.writeHead(result.status, { ...CORS_HEADERS, ...result.headers });
          if (result.body instanceof ReadableStream) {
            const reader = result.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
            res.end();
          } else {
            res.end(result.body);
          }
        } catch (error) {
          const status = error instanceof ProxyError ? error.status : 502;
          const message = error instanceof Error ? error.message : 'Proxy failed';
          respond(status, JSON.stringify({ error: message }), {
            'Content-Type': 'application/json',
          });
        }
      });
    },
  };
}

export type { Connect };
