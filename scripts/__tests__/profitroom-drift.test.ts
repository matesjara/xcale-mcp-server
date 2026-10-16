import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDriftProbe } from '../profitroom-drift';

const FIXTURES = join(__dirname, '..', '..', 'src', 'providers', 'profitroom', '__fixtures__');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

/** A fake engine answering each resource from the live fixtures (or an override). */
function engine(overrides: Record<string, unknown> = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
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
      detail: 'dates.0.minLOS: Required',
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
});
