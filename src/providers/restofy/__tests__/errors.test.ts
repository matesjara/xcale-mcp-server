import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { createRestofyProvider } from '../provider';
import { ctx, fakeRestofy, type Scripted } from './helpers';

/** Calls the cheapest read with Restofy answering `answer`. */
async function profileAnswering(answer: Scripted) {
  const provider = createRestofyProvider({
    fetchImpl: fakeRestofy({ 'business-profile/get-business-profile': answer }),
  });
  return provider.callTool('mcp_restofy_get_business_profile', {}, ctx);
}

describe('restofy errors — S2', () => {
  it('a rejected token is PROVIDER_AUTH_EXPIRED: a fresh mint fixes it', async () => {
    const r = await profileAnswering({
      status: 401,
      body: { success: false, message: 'Token de autorización no es válido', data: [] },
    });
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it("a business refusal is PROVIDER_INVALID_INPUT carrying Restofy's own sentence", async () => {
    const r = await profileAnswering({
      status: 400,
      body: {
        success: false,
        message: 'La fecha de la reserva debe ser futura',
        data: [],
      },
    });
    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'La fecha de la reserva debe ser futura',
    });
  });

  it('a missing permission (403) is PROVIDER_ERROR: a reconnect cannot fix it', async () => {
    const r = await profileAnswering({
      status: 403,
      body: { success: false, message: 'No tienes permiso para esta acción', data: [] },
    });
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  it('a throttled call (429) is PROVIDER_RATE_LIMITED, never retried here', async () => {
    const r = await profileAnswering({
      status: 429,
      body: { success: false, message: 'x', data: [] },
    });
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.RATE_LIMITED });
  });

  it('a Restofy outage (5xx) is PROVIDER_UNAVAILABLE', async () => {
    const r = await profileAnswering({ status: 503, body: 'Service Unavailable' });
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_UNAVAILABLE });
  });

  it('a 200 that says success: false is PROVIDER_ERROR with its message, not a success', async () => {
    const r = await profileAnswering({
      body: { success: false, message: 'No se pudo completar la operación', data: [] },
    });
    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'No se pudo completar la operación',
    });
  });

  it.each([
    ['a URL', 'Falló https://restofy.pro/api/x?token=abc'],
    ['braces', 'Error {"apiKey":"k"}'],
    ['a bearer', 'Bearer eyJhbGciOi no válido'],
    ['a key pair', 'clave key=123 inválida'],
    ['too long', 'x'.repeat(301)],
  ])('a message carrying %s is replaced by a generic one, never forwarded', async (_label, raw) => {
    const r = await profileAnswering({
      status: 400,
      body: { success: false, message: raw, data: [] },
    });
    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Restofy refused the request',
    });
  });
});
