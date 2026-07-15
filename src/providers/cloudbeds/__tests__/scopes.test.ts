import { describe, expect, it } from 'vitest';

import { unionToolScopes } from '../../../core/scopes';
import { REGISTERED_SCOPES, cloudbedsAuthBase } from '../auth';
import { createCloudbedsClient } from '../client';
import { createCloudbedsProvider } from '../provider';
import { buildCloudbedsTools } from '../tools';

const tools = buildCloudbedsTools(createCloudbedsClient({}));

describe('cloudbeds scopes — derived from tools, bounded by the app registration', () => {
  it('THE GUARD: no tool may require a scope the app is not registered for', () => {
    // A scope declared here lands in the authorize URL. An UNREGISTERED one can break the connect flow
    // for EVERY consumer — one bad tool, a whole-provider outage. This is the cheap mechanical stop.
    const unregistered = unionToolScopes(tools).filter((s) => !REGISTERED_SCOPES.includes(s));
    expect(
      unregistered,
      `not registered in Cloudbeds App Details: ${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('every tool declares requiredScopes — silence must not read as "needs nothing"', () => {
    // `[]` is a real answer (authenticates, no scope — the webhook methods). Omitting the field is not:
    // it would silently drop that tool's scope from the derived union and the call would 403 in prod.
    const undeclared = tools.filter((t) => t.requiredScopes === undefined).map((t) => t.name);
    expect(undeclared).toEqual([]);
  });

  it('publishes the union of its tools, deduplicated and sorted', () => {
    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('cloudbeds must publish an oauth2 descriptor');

    // Pinned deliberately. This list is what every hotel is asked to consent to, so it must never move
    // by accident — a diff here means the consent screen changed for real users. Updating it is a
    // decision, not a chore: consent is binary, so a hotel cannot decline one line of it.
    expect(auth.scopes).toEqual([
      'read:allotmentBlock',
      'read:appPropertySettings',
      'read:communication',
      'read:currency',
      'read:customFields',
      'read:dashboard',
      'read:guest',
      'read:hotel',
      'read:item',
      'read:payment',
      'read:rate',
      'read:reservation',
      'read:room',
      'read:roomblock',
      'read:taxesAndFees',
      'read:user',
      'write:guest',
      'write:reservation',
      'write:roomblock',
    ]);
  });

  it('derives rather than declares — the base descriptor carries no scope list', () => {
    // The regression this guards: someone "helpfully" re-adds a literal `scopes` array to the base and
    // the two sources drift apart in silence, which is exactly the failure the derivation removes.
    expect('scopes' in cloudbedsAuthBase).toBe(false);
  });

  it('keeps the rest of the auth blueprint intact', () => {
    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    expect(auth.authorizationUrl).toBe('https://hotels.cloudbeds.com/api/v1.3/oauth');
    expect(auth.tokenUrl).toBe('https://hotels.cloudbeds.com/api/v1.3/access_token');
    expect(auth.supportsRefresh).toBe(true);
    expect(auth.tokenPlacement).toBe('bearer_header');
  });

  it('the webhook tools authenticate but need no scope (spec: `OAuth2: []`)', () => {
    const webhookTools = tools.filter((t) => t.name.includes('webhook_subscription'));
    expect(webhookTools.length).toBeGreaterThan(0);
    for (const t of webhookTools) expect(t.requiredScopes).toEqual([]);
  });
});
