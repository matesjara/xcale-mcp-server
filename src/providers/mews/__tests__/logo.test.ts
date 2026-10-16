import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mewsManifest } from '../manifest';

describe('mews provider — logo', () => {
  it('advertises a logo the gateway actually serves, in the house tile', () => {
    expect(mewsManifest.logoUrl).toBe('/assets/mews.svg');
    // Served from the repo's assets/ folder by GET /assets/:filename (no auth).
    const file = join(process.cwd(), 'assets', 'mews.svg');
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, 'utf8');
    expect(svg).toContain('viewBox="0 0 35 35"');
    expect(svg).toContain('<rect width="35" height="35" rx="6" fill="#000000"/>');
    expect(svg).not.toMatch(/<script|on\w+=|javascript:/i);
  });
});
