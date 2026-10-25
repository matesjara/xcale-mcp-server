import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDriftProbe } from '../profitroom-drift';

const FIXTURES = join(__dirname, '..', '..', 'src', 'providers', 'profitroom', '__fixtures__');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

/**
 * A fake engine answering each resource from the live fixtures (or an override). The photo host
 * answers a JPEG unless `photo` overrides it with a status and content type.
 */
type PhotoReply = { status: number; type: string };

function engine(
  overrides: Record<string, unknown> & {
    photo?: PhotoReply | ((url: string) => PhotoReply);
  } = {},
) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (new URL(url).hostname === 'r.profitroom.pl') {
      const o = overrides.photo ?? { status: 200, type: 'image/jpeg' };
      const photo = typeof o === 'function' ? o(url) : o;
      return new Response('x', { status: photo.status, headers: { 'content-type': photo.type } });
    }
    const resource = new URL(url).pathname.split('/')[3] ?? '';
    const body = resource in overrides ? overrides[resource] : fixture(resource);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe('profitroom drift probe', () => {
  it('passes when every live response still matches the provider schemas', async () => {
    const { urls, fetchImpl } = engine();
    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });

    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.resource)).toEqual([
      'details',
      'rooms',
      'offers',
      'calendar',
      'availability',
      'photo',
    ]);
    // +30 days, a 14-day calendar window and a 2-night, 2-adult stay (contract §E).
    expect(urls).toContain(
      'https://booking.profitroom.com/api/hotellapausa/calendar?from=2026-11-13&to=2026-11-27',
    );
    expect(urls).toContain(
      'https://booking.profitroom.com/api/hotellapausa/availability?checkIn=2026-11-13&checkOut=2026-11-15&occupancy%5B0%5D%5Badults%5D=2',
    );
  });

  it('passes on an empty availability — no rooms that night is not drift', async () => {
    const { fetchImpl } = engine({ availability: [] });
    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });
    expect(report.ok).toBe(true);
  });

  it('fails and names the field when a response drifts', async () => {
    const drifted = structuredClone(fixture('calendar')) as { dates: Record<string, unknown>[] };
    delete drifted.dates[0]?.minLOS;
    const { fetchImpl } = engine({ calendar: drifted });

    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });

    expect(report.ok).toBe(false);
    expect(report.drifted).toBe(true);
    expect(report.checks.find((c) => c.resource === 'calendar')).toMatchObject({
      ok: false,
      failure: 'drift',
      detail: 'dates.0.minLOS: Invalid input: expected number, received undefined',
    });
  });

  it('fails without calling it drift when the engine does not answer 200', async () => {
    const fetchImpl = (async () =>
      new Response('down', { status: 503 })) as unknown as typeof fetch;
    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });
    expect(report.ok).toBe(false);
    expect(report.drifted).toBe(false);
    expect(report.checks[0]).toMatchObject({
      resource: 'details',
      ok: false,
      failure: 'unreachable',
      detail: 'HTTP 503',
    });
  });

  // #145: the provider derives photo URLs from file names; if Profitroom moves its photos, the links
  // the agent sends break silently. One gallery photo is fetched daily to catch it.
  it('fetches one gallery photo and calls a non-image answer drift', async () => {
    const { urls, fetchImpl } = engine({
      photo: (url) =>
        url.includes('/images/gallery/')
          ? { status: 200, type: 'image/gif' }
          : { status: 200, type: 'image/jpeg' },
    });
    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });

    expect(urls).toContain(
      'https://r.profitroom.pl/hotellapausa/images/gallery/thumbs/1134x0/d2715b30-47f6-4f5d-b2f1-35a5ba483a6c.jpg',
    );
    expect(report.drifted).toBe(true);
    expect(report.checks.find((c) => c.resource === 'photo')).toMatchObject({
      ok: false,
      failure: 'drift',
    });
  });

  it('calls a photo that is no longer found drift, not an outage', async () => {
    const { fetchImpl } = engine({ photo: { status: 404, type: 'text/html' } });
    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });
    expect(report.checks.find((c) => c.resource === 'photo')).toMatchObject({
      ok: false,
      failure: 'drift',
    });
  });

  // Review of #145: the rooms schema reads the gallery leniently (.catch(null)) so a reshaped gallery
  // never breaks the room list — which means the rooms check cannot see it. The photo check must.
  it('calls rooms with no photo at all drift — a renamed gallery must not pass silently', async () => {
    const rooms = (fixture('rooms') as Record<string, unknown>[]).map((r) => ({
      ...r,
      gallery: { photos: [] }, // Profitroom renamed `images`/`featured`
    }));
    const report = await runDriftProbe({
      fetchImpl: engine({ rooms }).fetchImpl,
      today: '2026-10-14',
    });

    expect(report.checks.find((c) => c.resource === 'rooms')?.ok).toBe(true);
    expect(report.drifted).toBe(true);
    expect(report.checks.find((c) => c.resource === 'photo')).toMatchObject({
      ok: false,
      failure: 'drift',
    });
  });

  // Review of #145: the featured photo lives on another path (images/rooms/) — it is checked too.
  it('checks the featured photo as well, and calls it drift when only that path breaks', async () => {
    const { urls, fetchImpl } = engine({
      photo: (url) =>
        url.includes('/images/rooms/')
          ? { status: 404, type: 'text/html' }
          : { status: 200, type: 'image/jpeg' },
    });
    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14' });

    expect(urls).toContain(
      'https://r.profitroom.pl/hotellapausa/images/rooms/thumbs/1134x0/e51137b9-1229-424e-8727-ec3073cbcda9.jpg',
    );
    expect(report.drifted).toBe(true);
    expect(report.checks.find((c) => c.resource === 'photo')).toMatchObject({
      ok: false,
      failure: 'drift',
    });
  });

  // Review of #146: a photo host that never answers must not stall the daily job.
  it('gives up on a photo host that hangs and calls it unreachable, not drift', async () => {
    const { fetchImpl: engineFetch } = engine();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (new URL(url).hostname !== 'r.profitroom.pl') return engineFetch(url);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const report = await runDriftProbe({ fetchImpl, today: '2026-10-14', photoTimeoutMs: 20 });

    expect(report.drifted).toBe(false);
    expect(report.checks.find((c) => c.resource === 'photo')).toMatchObject({
      ok: false,
      failure: 'unreachable',
    });
  });
});
