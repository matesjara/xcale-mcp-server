import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createSaludtoolsProvider } from '../provider';

import appointmentRead from '../__fixtures__/appointmentRead.json';
import appointmentSearch from '../__fixtures__/appointmentSearch.json';
import gendersCatalog from '../__fixtures__/gendersCatalog.json';
import patientRead from '../__fixtures__/patientRead.json';
import invalidEventType412 from '../__fixtures__/errors/invalidEventType412.json';
import patientNotFound412 from '../__fixtures__/errors/patientNotFound412.json';
import unauthorized401 from '../__fixtures__/errors/unauthorized401.json';

/**
 * The fixtures are the vendor's PUBLISHED examples, not recordings — see `__fixtures__/README.md`.
 * These tests therefore prove what OUR code does with the documented shapes. They are not the
 * round-trip proof, which needs a credential (grill-notes Q1).
 */

/** The minted JWT that reaches the provider already resolved (the `reference` path ran upstream). */
const JWT = 'eyJhbGciOi.header.signature.minted-saludtools-jwt';
const CTX: ProviderCallContext = { credential: { secret: new SecretString(JWT) } };

const BASE_URL = 'https://saludtools.qa.carecloud.com.co';

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return { provider: createSaludtoolsProvider({ fetchImpl: impl, baseUrl: BASE_URL }), calls };
}

function successData(result: ToolResult): Record<string, unknown> {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data as Record<string, unknown>;
}

function errorOf(result: ToolResult): { code: ProviderErrorCode; message: string } {
  if (result.kind !== 'error') throw new Error('expected an error result');
  return { code: result.code, message: result.message };
}

/** The JSON body the adapter sent on the Nth call. */
function sentBody(calls: Array<{ init: RequestInit | undefined }>, n = 0): Record<string, unknown> {
  const raw = calls[n]?.init?.body;
  if (typeof raw !== 'string') throw new Error('expected a JSON string body');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('saludtools provider — conformance', () => {
  it('satisfies the generic provider contract', async () => {
    await runProviderConformance(createSaludtoolsProvider());
  });
});

describe('saludtools provider — published surface', () => {
  it('publishes a credential_exchange descriptor with the documented mint wire', () => {
    const p = createSaludtoolsProvider();
    expect(p.auth.type).toBe('credential_exchange');
    if (p.auth.type === 'credential_exchange') {
      // PHI provider: the durable ApiKey must never reach this server (ADR 0003's hard gate).
      expect(p.auth.credentialDelivery).toBe('reference');
      expect(p.auth.tokenEndpoint).toBe(
        'https://saludtools.carecloud.com.co/integration/authenticate/apikey/v1/',
      );
      expect(p.auth.method).toBe('POST');
      // logical == wire — the cross-repo `credentialSecret` JSON-shape contract with xcale-backend.
      expect(p.auth.bodyFields).toEqual({ key: 'key', secret: 'secret' });
      expect(p.auth.tokenPlacement).toBe('bearer_header');
      /*
       * `expires_in` is OBSERVED (2026-09-21, production), not documented — the portal shows only
       * `access_token`. This assertion started life as its own opposite: it pinned the ABSENCE of an
       * expiry and said that whoever added one after seeing a real mint response would be changing a
       * decision rather than filling a gap. A real mint came back with
       * `{access_token, token_type, refresh_token, expires_in, scope, jti}`, this test went red, and
       * that is how the descriptor got corrected instead of quietly staying wrong for a week at a
       * time — the token lives ~6 days, so nothing would have looked broken. See `observed.test.ts`.
       */
      expect(p.auth.responseFields).toEqual({
        token: 'access_token',
        expiry: 'expires_in',
      });
      expect(p.auth.staticHeaders).toBeUndefined();
    }
  });

  it('declares no call context, so a clinic travels as an explicit argument', () => {
    // Q7 is open: if one ApiKey spans several clinics, `clinic` must stay an argument until we know.
    expect(createSaludtoolsProvider().contextSchema).toBeUndefined();
  });

  it('does not claim a connectionProbe or webhook support it cannot honour', () => {
    const p = createSaludtoolsProvider();
    // A credential_exchange provider proves its credential by minting, like Siigo.
    expect(p.manifest.connectionProbe).toBeUndefined();
    // The vendor has webhooks, but only as a manual UI setup with no API to subscribe one (Q5).
    expect(p.manifest.capabilities?.webhooks).toBe(false);
  });
});

describe('saludtools provider — the agent menu and the control plane', () => {
  const p = createSaludtoolsProvider();
  const published = p.listTools().map((t) => t.name);
  const routable = p.routableToolNames();

  it('publishes the agenda loop', () => {
    expect(published).toEqual(
      expect.arrayContaining([
        'mcp_saludtools_get_patient',
        'mcp_saludtools_create_patient',
        'mcp_saludtools_update_patient',
        'mcp_saludtools_get_agenda',
        'mcp_saludtools_list_patient_appointments',
        'mcp_saludtools_get_appointment',
        'mcp_saludtools_create_appointment',
        'mcp_saludtools_update_appointment',
        'mcp_saludtools_get_catalog',
      ]),
    );
  });

  it.each([
    'mcp_saludtools_search_patients',
    'mcp_saludtools_delete_patient',
    'mcp_saludtools_delete_appointment',
    'mcp_saludtools_get_reference_catalog',
  ])('withdraws %s from the agent menu but keeps it callable', (name) => {
    /*
     * The point of `controlPlane`: a tool that never appears in `tools/list` cannot be chosen by a
     * model, hallucinated into a plan, or reached through prompt injection — while a consumer that
     * knows its name can still run it. Walking the clinic's patient list and deleting a medical
     * record are not conversational moves under any tenant's rules.
     */
    expect(published).not.toContain(name);
    expect(routable).toContain(name);
  });
});

describe('saludtools provider — identity policy reaches the wire', () => {
  /*
   * Asserted on the PUBLISHED tool, never on the source definition. That is the lesson of
   * xcale-mcp-server#101: `definePaginatedList` re-declares its own parameter type, so a paginated
   * tool once declared an `identityPolicy` and published none — silently, with every test green. A
   * field that is declared and not published is worse than one nobody declared, and on a provider
   * whose every record is somebody's medical data it is the difference between a gate that runs and
   * one that does not.
   */
  const publishedTools = createSaludtoolsProvider().listTools();
  const policyOf = (name: string) => publishedTools.find((t) => t.name === name)?.identityPolicy;

  it.each([
    ['mcp_saludtools_get_patient', 'documentNumber'],
    ['mcp_saludtools_create_patient', 'documentNumber'],
    ['mcp_saludtools_update_patient', 'documentNumber'],
    ['mcp_saludtools_list_patient_appointments', 'patientDocumentNumber'],
    ['mcp_saludtools_create_appointment', 'patientDocumentNumber'],
    ['mcp_saludtools_update_appointment', 'patientDocumentNumber'],
  ])('%s is subject-bound on %s', (name, field) => {
    expect(policyOf(name)).toEqual({ mode: 'subject-bound', identityFields: [field] });
  });

  it('get_appointment is subject-scoped — an id names no person, but the answer is one', () => {
    expect(policyOf('mcp_saludtools_get_appointment')).toEqual({ mode: 'subject-scoped' });
  });

  it('get_agenda declares NO policy, because after projection it reaches nobody', () => {
    // If this ever fails, either AGENDA_FIELDS grew a patient field or the tool grew a patient
    // filter. Both turn an anonymous calendar into a read of other patients' records.
    expect(policyOf('mcp_saludtools_get_agenda')).toBeUndefined();
    expect(policyOf('mcp_saludtools_get_catalog')).toBeUndefined();
  });
});

describe('saludtools provider — get_patient tells "not registered" apart from "bad request"', () => {
  it('returns the projected patient when one holds the document', async () => {
    const { provider: p, calls } = provider(patientRead);
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_patient',
        { documentType: 1, documentNumber: '177400432' },
        CTX,
      ),
    );

    expect(data.found).toBe(true);
    const patient = data.patient as Record<string, unknown>;
    expect(patient.firstName).toBe('Prueba');
    expect(patient.documentNumber).toBe('177400432');
    // `habeasData` is surfaced: an agent that cannot see the consent flag cannot respect it.
    expect(patient.habeasData).toBe(true);

    // The projection is an allow-list, so what the vendor returns beyond the list does not travel.
    // `address` is the proof it works: the vendor's own attribute table never mentions it, and it
    // arrived anyway. Nothing had to anticipate it.
    expect(patient).not.toHaveProperty('address');
    expect(patient).not.toHaveProperty('id');
    expect(patient).not.toHaveProperty('pageable');

    expect(calls[0]?.url).toBe(`${BASE_URL}/integration/sync/event/v1/`);
    expect(sentBody(calls)).toEqual({
      eventType: 'PATIENT',
      actionType: 'READ',
      body: { documentType: 1, documentNumber: '177400432' },
    });
  });

  it('answers found:false — not an error — when nobody holds the document', async () => {
    /*
     * SaludTools reports an unknown patient with `412`, the same code it uses for a malformed
     * request. Left alone that surfaces as PROVIDER_INVALID_INPUT, which tells the agent it built a
     * bad call — and the right next move is the opposite one: offer to register the person.
     */
    const { provider: p } = provider(patientNotFound412, 412);
    const result = await p.callTool(
      'mcp_saludtools_get_patient',
      { documentType: 1, documentNumber: '000000000' },
      CTX,
    );

    expect(result.kind).toBe('success');
    expect(successData(result)).toEqual({ found: false });
  });

  it('still fails on a 412 that is NOT the not-found case', async () => {
    // The narrow marker has to stay narrow: a real input error must not be dressed up as "no such
    // patient", which would have the agent cheerfully offering to register somebody.
    const { provider: p } = provider(invalidEventType412, 412);
    expect(
      errorOf(
        await p.callTool(
          'mcp_saludtools_get_patient',
          { documentType: 1, documentNumber: '177400432' },
          CTX,
        ),
      ).code,
    ).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

describe('saludtools provider — the agenda carries nobody', () => {
  it('drops every patient field, and the two free-text fields that leak identities', async () => {
    const { provider: p } = provider(appointmentSearch);
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_agenda',
        { startAppointment: '2021-04-30 00:00', endAppointment: '2021-05-05 00:00' },
        CTX,
      ),
    );

    const items = data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);

    for (const slot of items) {
      // What a calendar needs.
      expect(slot).toHaveProperty('startAppointment');
      expect(slot).toHaveProperty('endAppointment');
      expect(slot).toHaveProperty('stateAppointment');
      expect(slot).toHaveProperty('clinic');

      // Who it is: gone.
      expect(slot).not.toHaveProperty('patientDocumentNumber');
      expect(slot).not.toHaveProperty('patientDocumentType');
      expect(slot).not.toHaveProperty('notificationState');

      /*
       * And the two that look harmless. `comment` is a receptionist's free text — the vendor's own
       * example is "el paciente viene acompañado de su hijo". `appointmentType` is free text too,
       * and the vendor's own examples are "Pruebas Luis" and "CITADEPRUEBA": the first is a person's
       * name. A field whose published sample leaks an identity cannot ride on an anonymous calendar.
       */
      expect(slot).not.toHaveProperty('comment');
      expect(slot).not.toHaveProperty('appointmentType');
    }
  });

  it('keeps the whole appointment for the patient it belongs to', async () => {
    const { provider: p } = provider(appointmentSearch);
    const data = successData(
      await p.callTool(
        'mcp_saludtools_list_patient_appointments',
        { patientDocumentType: 1, patientDocumentNumber: '1414141' },
        CTX,
      ),
    );

    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]?.patientDocumentNumber).toBe('1414141');
    expect(items[0]?.appointmentType).toBe('CITADEPRUEBA');
    expect(items[0]).toHaveProperty('comment');
  });

  it("reports the provider's totals, even when the page carries fewer records", async () => {
    const { provider: p } = provider(appointmentSearch);
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_agenda',
        { startAppointment: '2021-04-30 00:00', endAppointment: '2021-05-05 00:00' },
        CTX,
      ),
    );
    expect(data.totalPages).toBe(1);
    expect(data.totalResults).toBe(3);
  });
});

describe('saludtools provider — pagination is translated, not passed through', () => {
  it("turns the gateway's 1-based page into SaludTools' 0-based pageable", async () => {
    /*
     * The gateway publishes 1-based pages for every provider; SaludTools is Spring and counts from 0.
     * Getting this backwards silently skips the first page of every search — a bug that presents as
     * "the clinic has no appointments tomorrow", which is a sentence a patient would believe.
     */
    const { provider: p, calls } = provider(appointmentSearch);
    await p.callTool(
      'mcp_saludtools_get_agenda',
      {
        startAppointment: '2021-04-30 00:00',
        endAppointment: '2021-05-05 00:00',
        page: 1,
        pageSize: 20,
      },
      CTX,
    );
    expect((sentBody(calls).body as Record<string, unknown>).pageable).toEqual({
      page: 0,
      size: 20,
    });
  });

  it('sends the caller-facing page 3 as pageable page 2', async () => {
    const { provider: p, calls } = provider(appointmentSearch);
    await p.callTool(
      'mcp_saludtools_get_agenda',
      {
        startAppointment: '2021-04-30 00:00',
        endAppointment: '2021-05-05 00:00',
        page: 3,
        pageSize: 20,
      },
      CTX,
    );
    expect((sentBody(calls).body as Record<string, unknown>).pageable).toEqual({
      page: 2,
      size: 20,
    });
  });
});

describe('saludtools provider — catalogs', () => {
  it('passes a catalog through verbatim: a bare array, not an envelope', async () => {
    const { provider: p, calls } = provider(gendersCatalog);
    const result = await p.callTool('mcp_saludtools_get_catalog', { catalog: 'genders' }, CTX);
    expect(successData(result)).toEqual(gendersCatalog);
    expect(calls[0]?.url).toBe(`${BASE_URL}/integration/parametric/genders/v1/`);
  });

  it('sends `page` only to the catalogs the vendor documents as paged', async () => {
    // A `page` on a catalog that does not expect one is a 412 waiting to happen.
    const { provider: p, calls } = provider(gendersCatalog);
    await p.callTool('mcp_saludtools_get_catalog', { catalog: 'genders', page: 2 }, CTX);
    expect(calls[0]?.url).toBe(`${BASE_URL}/integration/parametric/genders/v1/`);

    const paged = provider(gendersCatalog);
    await paged.provider.callTool('mcp_saludtools_get_catalog', { catalog: 'eps', page: 2 }, CTX);
    expect(paged.calls[0]?.url).toBe(`${BASE_URL}/integration/parametric/eps/v1/?page=1`);
  });

  it('uses the vendor spellings, typos included', async () => {
    // `treatmenareatype` is the vendor's own path. Tidying it to `treatmentareatype` 404s.
    const { provider: p, calls } = provider(gendersCatalog);
    await p.callTool('mcp_saludtools_get_catalog', { catalog: 'specialties' }, CTX);
    expect(calls[0]?.url).toContain('/parametric/treatmenareatype/v1/');
  });
});

describe('saludtools provider — errors', () => {
  it('maps a 401 to AUTH_EXPIRED, even though its body is a bare string', async () => {
    // The vendor answers 401 with `"No tiene permisos para acceder al servidor"` — a JSON string,
    // not the envelope every other response uses.
    const { provider: p } = provider(unauthorized401, 401);
    expect(
      errorOf(
        await p.callTool(
          'mcp_saludtools_get_patient',
          { documentType: 1, documentNumber: '177400432' },
          CTX,
        ),
      ).code,
    ).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('maps 412 to INVALID_INPUT — the shared status map sends it elsewhere', async () => {
    const { provider: p } = provider(invalidEventType412, 412);
    expect(errorOf(await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX)).code).toBe(
      ProviderErrorCode.INVALID_INPUT,
    );
  });

  it('classifies a failure reported INSIDE an HTTP 200', async () => {
    /*
     * The whole reason this provider needs an `errors.ts`: `code` is a field in the body. A client
     * that trusts `res.ok` reports this as a successful call with a null payload.
     */
    const { provider: p } = provider(invalidEventType412, 200);
    expect(errorOf(await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX)).code).toBe(
      ProviderErrorCode.INVALID_INPUT,
    );
  });

  it('refuses to call a 200 with no envelope code a success', async () => {
    // "We cannot tell whether that worked" is not the same as "that worked".
    const { provider: p } = provider({ body: { id: 1 } }, 200);
    expect(errorOf(await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX)).code).toBe(
      ProviderErrorCode.PROVIDER_ERROR,
    );
  });

  it('treats a 500 on a DATA call as an outage, never as a dead credential', async () => {
    /*
     * The vendor's MINT endpoint answers 500 for a wrong key/secret — but that endpoint is Rail A's,
     * never this server's. Carrying the quirk over to data calls would tell a clinic to reconnect a
     * perfectly good ApiKey every time SaludTools has a bad minute.
     */
    const { provider: p } = provider({ error: 'boom' }, 500);
    expect(errorOf(await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX)).code).toBe(
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    );
  });

  it("never leaks the vendor's Spanish prose into an error a caller sees", async () => {
    /*
     * `message` interpolates record ids ("Se consulta la informacion de el paciente id: 215178") and
     * reaches the agent's prompt and the patient's chat. `eventId` is the opaque correlation id that
     * identifies the call in the vendor's logs and carries nothing about anybody.
     */
    const { provider: p } = provider(invalidEventType412, 412);
    const { message } = errorOf(
      await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX),
    );
    expect(message).not.toContain('No se ha enviado un tipo de evento valido');
    expect(message).toContain('fe645e7a430c40bb946d221fb688351d');
  });

  it('rejects a malformed datetime before it reaches the provider', async () => {
    // SaludTools wants `yyyy-MM-dd HH:mm`, and a 412 from it does not say which field it disliked.
    const { provider: p, calls } = provider(appointmentSearch);
    expect(
      errorOf(
        await p.callTool(
          'mcp_saludtools_get_agenda',
          { startAppointment: '2021-04-30T08:00:00Z', endAppointment: '2021-05-05 00:00' },
          CTX,
        ),
      ).code,
    ).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });
});

describe('saludtools provider — the credential never reaches the adapter', () => {
  it('sends the minted JWT as a bearer header and nowhere else', async () => {
    const { provider: p, calls } = provider(appointmentRead);
    await p.callTool('mcp_saludtools_get_appointment', { id: '2593842' }, CTX);

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${JWT}`);
    // Not in the URL, and not smuggled into the body the adapter built.
    expect(calls[0]?.url).not.toContain(JWT);
    expect(JSON.stringify(sentBody(calls))).not.toContain(JWT);
  });
});
