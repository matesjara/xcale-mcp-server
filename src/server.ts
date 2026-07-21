import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyHopB } from './auth/hop-b';
import { extractProviderMetadata, extractProviderToken } from './auth/token';
import { type Config, loadConfig } from './config';
import { buildCatalog } from './core/catalog';
import { createRegistry } from './core/registry';
import { loggerOptions } from './logger';
import { handleMcpRequest } from './protocol/http-mcp';
import { PROVIDERS } from './providers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '..', 'assets');

const LOGO_CACHE = new Map<string, { data: Buffer; type: string }>();

async function serveAsset(reply: import('fastify').FastifyReply, filename: string): Promise<void> {
  const cached = LOGO_CACHE.get(filename);
  if (cached) {
    await reply.header('content-type', cached.type).send(cached.data);
    return;
  }
  try {
    const filePath = resolve(ASSETS_DIR, filename);
    const ext = filename.split('.').pop()?.toLowerCase();
    const mime: Record<string, string> = {
      svg: 'image/svg+xml',
      png: 'image/png',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      webp: 'image/webp',
    };
    const data = await readFile(filePath);
    LOGO_CACHE.set(filename, { data, type: mime[ext ?? ''] ?? 'application/octet-stream' });
    await reply.header('content-type', mime[ext ?? ''] ?? 'application/octet-stream').send(data);
  } catch {
    await reply.code(404).send({ error: 'not found' });
  }
}

export function buildApp(config: Config = loadConfig()): FastifyInstance {
  const registry = createRegistry(PROVIDERS);
  const app = Fastify({ logger: loggerOptions(config.logLevel) });

  // Public health/readiness — no auth.
  app.get('/health', async () => ({ status: 'ok' }));

  // Public asset serving — provider logos (no auth required).
  app.get('/assets/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      await reply.code(400).send({ error: 'invalid filename' });
      return;
    }
    await serveAsset(reply, filename);
  });

  // Hop B guard for every non-public route (single isolated point).
  app.addHook('onRequest', async (request, reply) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path === '/health' || path.startsWith('/assets/')) {
      return;
    }
    if (!verifyHopB(request.headers.authorization, config.serverSecret)) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // Pillar: server/discover — the capability catalog. Hop B only; NEVER carries a provider token.
  app.get('/discover', async () => ({ providers: buildCatalog(registry) }));

  // Pillars: tools/list + tools/call over MCP (Streamable HTTP, stateless).
  app.post('/mcp', async (request, reply) => {
    reply.hijack();
    const rawToken = request.headers['x-provider-token'];
    const token = extractProviderToken(typeof rawToken === 'string' ? rawToken : undefined);
    const rawMeta = request.headers['x-provider-metadata'];
    const metadata = extractProviderMetadata(typeof rawMeta === 'string' ? rawMeta : undefined);
    try {
      await handleMcpRequest({
        registry,
        ctx: { token, metadata },
        req: request.raw,
        res: reply.raw,
        body: request.body,
      });
    } catch (err) {
      // After hijack(), Fastify will not respond — never leave the request hanging.
      request.log.error({ err }, 'MCP request handling failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'Internal error' },
          }),
        );
      } else {
        reply.raw.end();
      }
    }
  });

  return app;
}

async function start(): Promise<void> {
  const config = loadConfig();
  if (config.serverSecret.length === 0) {
    console.error('FATAL: MCP_SERVER_SECRET is not set (Hop B). Refusing to start.');
    process.exit(1);
  }
  const app = buildApp(config);

  // Graceful shutdown — DO App Platform sends SIGTERM on deploy/scale.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Auto-start only when run as the entrypoint (not under tests).
if (process.env.VITEST === undefined) {
  void start();
}
