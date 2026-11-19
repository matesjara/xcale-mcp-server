import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext } from '../../../core/types';

export interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** One scripted answer: the HTTP status and the JSON body Restofy sends. */
export interface Scripted {
  status?: number;
  body: unknown;
}

/**
 * A fake `fetch` routed by Restofy's `module/action` path. Every Restofy call is a POST to
 * `https://restofy.pro/api/{module}/{action}`, so the path is the route. A route given an array answers
 * its entries in order (one per call). An unscripted path fails the test loudly.
 */
export function fakeRestofy(
  routes: Record<string, Scripted | Scripted[]>,
  capture: Captured[] = [],
): typeof fetch {
  const queues = new Map(
    Object.entries(routes).map(([path, s]) => [path, Array.isArray(s) ? [...s] : [s]]),
  );
  return (async (url: string, init: Captured['init']) => {
    capture.push({ url, init });
    const path = url.replace(/^https:\/\/restofy\.pro\/api\//, '');
    const queue = queues.get(path);
    if (!queue || queue.length === 0) throw new Error(`unscripted Restofy call: ${path}`);
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/** The parsed JSON body of a captured request. */
export function sentBody(c: Captured | undefined): Record<string, unknown> {
  return JSON.parse(c?.init.body ?? '{}') as Record<string, unknown>;
}

/** A header of a captured request, whatever its case. */
export function sentHeader(c: Captured | undefined, name: string): string | undefined {
  const headers = c?.init.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

/** The resolved credential the core hands a provider: the JWT Rail A minted. */
export const ctx: ProviderCallContext = {
  credential: { secret: new SecretString('minted-jwt') },
};
