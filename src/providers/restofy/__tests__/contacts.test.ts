import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { createRestofyProvider } from '../provider';
import partyCreated from '../__fixtures__/partyCreated.json';
import partyFound from '../__fixtures__/partyFound.json';
import partyNull from '../__fixtures__/partyNull.json';
import { type Captured, ctx, fakeRestofy, sentBody } from './helpers';

const PHONE = '+573001112233';

describe('restofy contacts — S5 find_contact_by_phone', () => {
  it('finds the contact with exactly this phone and returns who they are, not their sub-lists', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'parties/get-party-by-phone': { body: partyFound } }, capture),
    });

    const r = await provider.callTool('mcp_restofy_find_contact_by_phone', { phone: PHONE }, ctx);

    expect(r).toMatchObject({
      kind: 'success',
      data: {
        found: true,
        contact: { id: 1, phone: PHONE, name: 'Comensal Prueba xcale', notes: null },
      },
    });
    expect((r as { data: { contact: object } }).data.contact).not.toHaveProperty('addresses');
    expect(sentBody(capture[0])).toEqual({ phone: PHONE });
  });

  it('nobody with that phone is { found: false }', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'parties/get-party-by-phone': { body: partyNull } }),
    });

    const r = await provider.callTool('mcp_restofy_find_contact_by_phone', { phone: PHONE }, ctx);

    expect(r).toMatchObject({ kind: 'success', data: { found: false } });
  });

  it.each(['3001112233', '573001112233', '+57 300 111 2233'])(
    'refuses %s: Restofy only finds a phone written exactly as stored, so E.164 end to end',
    async (phone) => {
      const capture: Captured[] = [];
      const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });

      const r = await provider.callTool('mcp_restofy_find_contact_by_phone', { phone }, ctx);

      expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
      expect(capture).toHaveLength(0);
    },
  );
});

describe('restofy contacts — S5 create_contact', () => {
  it('a phone already in Restofy returns that contact UNCHANGED and writes nothing', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'parties/get-party-by-phone': { body: partyFound } }, capture),
    });

    const r = await provider.callTool(
      'mcp_restofy_create_contact',
      { phone: PHONE, name: 'Otro Nombre' },
      ctx,
    );

    expect(r).toMatchObject({
      kind: 'success',
      data: { created: false, contact: { id: 1, name: 'Comensal Prueba xcale' } },
    });
    expect(capture.map((c) => c.url)).toEqual([
      'https://restofy.pro/api/parties/get-party-by-phone',
    ]);
  });

  it('a new phone creates the contact with its name and phone only', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        {
          'parties/get-party-by-phone': { body: partyNull },
          'parties/set-party': { body: partyCreated },
        },
        capture,
      ),
    });

    const r = await provider.callTool(
      'mcp_restofy_create_contact',
      { phone: '+573005556677', name: 'Nuevo Comensal' },
      ctx,
    );

    expect(r).toMatchObject({
      kind: 'success',
      data: {
        created: true,
        contact: { id: 2, phone: '+573005556677', name: 'Nuevo Comensal', notes: null },
      },
    });
    expect(sentBody(capture[1])).toEqual({ name: 'Nuevo Comensal', phone: '+573005556677' });
  });

  it('a failed lookup stops before any write', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        {
          'parties/get-party-by-phone': {
            status: 401,
            body: { success: false, message: 'Token de autorización no es válido', data: [] },
          },
        },
        capture,
      ),
    });

    const r = await provider.callTool(
      'mcp_restofy_create_contact',
      { phone: PHONE, name: 'X' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect(capture).toHaveLength(1);
  });
});

describe('restofy contacts — S5 identity', () => {
  it.each(['mcp_restofy_find_contact_by_phone', 'mcp_restofy_create_contact'])(
    '%s publishes that it acts on the person named by the phone',
    (name) => {
      const tool = createRestofyProvider()
        .listTools()
        .find((t) => t.name === name);
      expect(tool?.identityPolicy).toEqual({
        mode: 'subject-bound',
        identityFields: ['phone'],
        identityFieldKinds: { phone: 'phone' },
      });
    },
  );
});
