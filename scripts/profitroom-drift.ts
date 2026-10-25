/**
 * Profitroom drift probe — does the live booking-engine API still have the shape the provider reads?
 *
 * Profitroom's engine API is internal, not a published contract (ADR credential-less-provider-auth), so
 * it can change without notice. The provider already fails closed on a changed response; this probe is
 * the early warning. It calls the five endpoints the provider uses on a real hotel and parses each with
 * the provider's OWN exported schemas (`src/providers/profitroom/schemas.ts`) — one definition of "the
 * shape we depend on", shared by runtime and probe, so the two can never disagree.
 *
 *   npx tsx scripts/profitroom-drift.ts   # exit 0 = no drift, 1 = drift, 2 = engine unreachable
 *
 * Run daily by `.github/workflows/profitroom-drift.yml`, which opens an issue on failure.
 * See docs/design/profitroom-read-only-provider/api-contract.md §E.
 */
import type { z } from 'zod';

import {
  availabilitySchema,
  calendarSchema,
  detailsSchema,
  offersSchema,
  roomsSchema,
} from '../src/providers/profitroom/schemas';
import { photosOf } from '../src/providers/profitroom/mappers';

/** The first Profitroom tenant's public engine (La Pausa) — public data, no credential. */
const HOTEL_KEY = 'hotellapausa';
const API_BASE = 'https://booking.profitroom.com/api/';
const DAY_MS = 86_400_000;

export interface DriftCheck {
  readonly resource: string;
  readonly ok: boolean;
  /** Why it failed: the shape changed (`drift`) or the engine did not answer 200 (`unreachable`). */
  readonly failure?: 'drift' | 'unreachable';
  readonly detail: string;
}

export interface DriftReport {
  readonly ok: boolean;
  /** True only when a response answered but no longer matches — an outage alone is not drift. */
  readonly drifted: boolean;
  readonly checks: readonly DriftCheck[];
}

export interface DriftProbeOptions {
  readonly fetchImpl?: typeof fetch;
  /** Today, `YYYY-MM-DD` (UTC). The probe looks 30 days ahead so the dates are always bookable. */
  readonly today?: string;
  /** How long one photo may take before the host counts as unreachable (default 10 s). */
  readonly photoTimeoutMs?: number;
}

export async function runDriftProbe(opts: DriftProbeOptions = {}): Promise<DriftReport> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const from = addDays(today, 30);

  const targets: [string, Record<string, string>, z.ZodTypeAny][] = [
    ['details', {}, detailsSchema],
    ['rooms', {}, roomsSchema],
    ['offers', { status: '1' }, offersSchema],
    ['calendar', { from, to: addDays(from, 14) }, calendarSchema],
    [
      'availability',
      { checkIn: from, checkOut: addDays(from, 2), 'occupancy[0][adults]': '2' },
      availabilitySchema,
    ],
  ];

  const checks: DriftCheck[] = [];
  let rooms: unknown;
  for (const [resource, query, schema] of targets) {
    const { result, data } = await check(fetchImpl, resource, query, schema);
    checks.push(result);
    if (resource === 'rooms' && result.ok) rooms = data;
  }
  checks.push(await checkPhoto(fetchImpl, rooms, opts.photoTimeoutMs ?? 10_000));
  return {
    ok: checks.every((c) => c.ok),
    drifted: checks.some((c) => c.failure === 'drift'),
    checks,
  };
}

async function check(
  fetchImpl: typeof fetch,
  resource: string,
  query: Record<string, string>,
  schema: z.ZodTypeAny,
): Promise<{ result: DriftCheck; data?: unknown }> {
  const qs = new URLSearchParams(query).toString();
  const url = `${API_BASE}${HOTEL_KEY}/${resource}${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!res.ok) {
      return {
        result: { resource, ok: false, failure: 'unreachable', detail: `HTTP ${res.status}` },
      };
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        result: {
          resource,
          ok: false,
          failure: 'drift',
          detail: issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown shape',
        },
      };
    }
    return { result: { resource, ok: true, detail: 'matches' }, data: parsed.data };
  } catch (e) {
    return {
      result: {
        resource,
        ok: false,
        failure: 'unreachable',
        detail: e instanceof Error ? e.message : 'request failed',
      },
    };
  }
}

/**
 * #145: the photos the provider derives must still be real images — one on each path it uses, the
 * featured photo (`images/rooms/`) and a gallery photo (`images/gallery/`). A 404 or a non-image (the
 * engine answers a 1x1 GIF on a wrong path) means Profitroom moved its photos: drift. A 5xx or no
 * answer (or none within the timeout) is an outage. Rooms that parse with no photo on a path are
 * drift too.
 */
async function checkPhoto(
  fetchImpl: typeof fetch,
  rooms: unknown,
  timeoutMs: number,
): Promise<DriftCheck> {
  const resource = 'photo';
  // The rooms check already reported a rooms failure; there is nothing to derive photos from.
  if (!Array.isArray(rooms))
    return { resource, ok: true, detail: 'rooms unavailable — not checked' };
  const photos = (rooms as Parameters<typeof photosOf>[0][]).flatMap((room) =>
    photosOf(room, HOTEL_KEY),
  );
  for (const path of ['/images/rooms/', '/images/gallery/']) {
    const url = photos.find((p) => p.url.includes(path))?.url;
    // The schema reads the gallery leniently (it never fails the room list), so a renamed gallery
    // shows up here, as rooms with no photo at all. La Pausa has dozens: none is drift.
    if (url === undefined) {
      return {
        resource,
        ok: false,
        failure: 'drift',
        detail: `rooms parsed but no photo on ${path}`,
      };
    }
    const failed = await fetchPhoto(fetchImpl, url, timeoutMs);
    if (failed) return { resource, ...failed };
  }
  return { resource, ok: true, detail: 'featured and gallery photos are images' };
}

async function fetchPhoto(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Omit<DriftCheck, 'resource'> | null> {
  try {
    // A hung photo host must not stall the daily job: it counts as unreachable, never as drift.
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel(); // only the status and type matter; do not download the image
    const type = res.headers.get('content-type') ?? '';
    if (res.status >= 500) {
      return { ok: false, failure: 'unreachable', detail: `HTTP ${res.status} at ${url}` };
    }
    if (!res.ok || !type.startsWith('image/') || type.includes('gif')) {
      return { ok: false, failure: 'drift', detail: `HTTP ${res.status} ${type} at ${url}` };
    }
    return null;
  } catch (e) {
    return {
      ok: false,
      failure: 'unreachable',
      detail: e instanceof Error ? e.message : 'request failed',
    };
  }
}

function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const report = await runDriftProbe();
  for (const c of report.checks) {
    console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.resource.padEnd(13)} ${c.detail}`);
  }
  if (report.drifted) {
    console.error(
      '\nProfitroom drift detected — the provider is failing closed for the changed endpoint(s).',
    );
    process.exit(1);
  }
  if (!report.ok) {
    // An outage (or a runner network failure) is not a schema change: fail the run, open no drift issue.
    console.error('\nProfitroom engine unreachable — no drift verdict for this run.');
    process.exit(2);
  }
}

if (process.argv[1]?.endsWith('profitroom-drift.ts')) void main();
