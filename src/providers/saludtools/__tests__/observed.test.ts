import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { saludtoolsAuth } from '../auth';
import { AGENT_CATALOGS, REFERENCE_CATALOGS } from '../catalogs';
import { createSaludtoolsProvider } from '../provider';

import observedAppointmentSearchEmpty from '../__fixtures__/observed-appointmentSearchEmpty.json';
import observedAttentionModalities from '../__fixtures__/observed-attentionModalityCatalog.json';
import observedClinics from '../__fixtures__/observed-clinicsCatalog.json';
import observedSpecialtiesPage from '../__fixtures__/observed-specialtiesPagedCatalog.json';
import observedPageSizeTooLarge from '../__fixtures__/errors/observed-pageSizeTooLarge412.json';
import observedPatientNotFound from '../__fixtures__/observed-patientNotFound200.json';
import observedStates from '../__fixtures__/observed-statesCatalog.json';

/**
 * OBSERVED, 2026-09-21 — the only tests in this module backed by real responses.
 *
 * Every fixture imported here was recorded against SaludTools **production** with a live clinic
 * ApiKey. They exist because the vendor's published documentation was wrong about four things, and
 * three of those four would have shipped as defects.
 *
 * They are also the guard against re-introducing them: each test below names the documented claim it
 * contradicts, so a future "cleanup" that restores the tidier-looking documented version goes red.
 */

const JWT = 'eyJhbGciOi.header.signature.minted-saludtools-jwt';
const CTX: ProviderCallContext = { credential: { secret: new SecretString(JWT) } };
const BASE_URL = 'https://saludtools.qa.carecloud.com.co';

function provider(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return {
    provider: createSaludtoolsProvider({
      fetchImpl: impl as unknown as typeof globalThis.fetch,
      baseUrl: BASE_URL,
    }),
    calls,
  };
}

function successData(result: ToolResult): Record<string, unknown> {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data as Record<string, unknown>;
}

describe('observed — the mint response carries an expiry the docs never mentioned', () => {
  it('declares `expires_in`', () => {
    /*
     * The portal documents `{"access_token": "<JWT>"}` and nothing else, so the descriptor first
     * shipped with no expiry and a comment explaining why that was fine. A real mint returns
     * `{access_token, token_type, refresh_token, expires_in, scope, jti}`.
     *
     * It matters more than one field: the token lives ~6 days (`exp - iat` = 518400s), so a
     * 401-driven re-mint would have been rare enough to look like it was working, and Rail A would
     * have been caching nothing for a week at a time.
     */
    expect(saludtoolsAuth.type).toBe('credential_exchange');
    if (saludtoolsAuth.type === 'credential_exchange') {
      expect(saludtoolsAuth.responseFields).toEqual({
        token: 'access_token',
        expiry: 'expires_in',
      });
    }
  });

  it('does not reach for the undocumented refresh_token', () => {
    // The mint response includes one. Using it would put a second credential into Rail A's custody
    // to save re-minting from the ApiKey that Rail A already holds. Not a trade worth making.
    expect(JSON.stringify(saludtoolsAuth)).not.toContain('refresh_token');
  });
});

describe('observed — `modality` is not the three-value enum the docs describe', () => {
  it('accepts a modality the documentation never listed', async () => {
    /*
     * The portal documents CONVENTIONAL / TELEMEDICINE / DOMICILIARY. The live catalog returns
     * TWELVE values and `DOMICILIARY` is not one of them.
     *
     * The first version of this adapter had that documented enum, which means it would have rejected
     * `EXTRAMURAL_HOME` — a real modality for a real home visit — with an input error of our own
     * making. The cost of that lands on a patient who cannot be booked, so the tie goes to the
     * booking: the catalog is the source of truth and an unknown value fails at the provider, with
     * the provider's reason.
     */
    const { provider: p, calls } = provider(observedAppointmentSearchEmpty);
    const result = await p.callTool(
      'mcp_saludtools_create_appointment',
      {
        startAppointment: '2026-10-01 09:00',
        endAppointment: '2026-10-01 09:30',
        patientDocumentType: 1,
        patientDocumentNumber: '123456789',
        doctorDocumentType: 1,
        doctorDocumentNumber: '987654321',
        modality: 'EXTRAMURAL_HOME',
        clinic: 17688,
      },
      CTX,
    );

    // It reached the provider instead of being refused here — which is the whole point.
    expect(calls).toHaveLength(1);
    expect(result.kind).not.toBe('error');
  });

  it('pins the catalog that proved it: twelve values, and no DOMICILIARY', () => {
    const values = (observedAttentionModalities as Array<{ value: string }>).map((m) => m.value);
    expect(values).toHaveLength(12);
    expect(values).toContain('EXTRAMURAL_HOME');
    expect(values).not.toContain('DOMICILIARY');
  });
});

describe('observed — a paged catalog has no envelope, and the first unwrap rejected it', () => {
  it('reads the flattened page a paged catalog actually returns', async () => {
    /*
     * REGRESSION. `treatmenareatype` answers with a bare `{content, pageNumber, pageSize,
     * totalElements, totalPages}` — no `code`, and not the full Spring page the event searches use.
     * `unwrapSaludtools` requires a numeric envelope `code`, so it classified this as
     * PROVIDER_ERROR: every paged catalog read failed. Hence `unwrapSaludtoolsCatalog`.
     */
    const { provider: p } = provider(observedSpecialtiesPage);
    const data = successData(
      await p.callTool('mcp_saludtools_get_catalog', { catalog: 'specialties', page: 1 }, CTX),
    );
    expect(data).toEqual(observedSpecialtiesPage);
    expect(data.totalElements).toBe(92);
  });

  it('keeps `value`-keyed catalogs exactly as the vendor sends them', async () => {
    /*
     * `documents` and `genders` key on a numeric `id`; `states` and `attentionModality` key on a
     * STRING `value`. The docs imply one shape. Unifying them would mean inventing ids that no
     * appointment accepts — Fidelity over Unification, and here it is also correctness.
     */
    const { provider: p } = provider(observedStates);
    const data = await p.callTool(
      'mcp_saludtools_get_catalog',
      { catalog: 'appointmentStates' },
      CTX,
    );
    if (data.kind !== 'success') throw new Error('expected success');
    expect(data.data).toEqual(observedStates);
    expect((data.data as Array<Record<string, unknown>>)[0]).toHaveProperty('value');
  });

  it('shows there IS a cancelled state — so cancelling is an update, not a delete', () => {
    /*
     * Q4 answered. The live state catalog carries `CANCELLED`, `CANCELLED_BY_DOCTOR` and
     * `RESCHEDULED`. A cancellation can therefore be recorded rather than erased, which is why
     * `delete_appointment` stays off the agent's menu: a deleted appointment is a fact the clinic
     * can no longer audit, and it never needed to be the way to cancel.
     */
    const values = (observedStates as Array<{ value: string }>).map((s) => s.value);
    expect(values).toContain('CANCELLED');
    expect(values).toContain('RESCHEDULED');
  });
});

describe('observed — the agenda read works with a date window and nothing else', () => {
  it('searches by window alone, with the nested pageable the collection uses', async () => {
    /*
     * Q8 and Q9, both answered against production, and D3 stands or falls on them:
     * - a window with NO doctor and NO patient is accepted, so `get_agenda` is possible at all;
     * - pagination goes in a nested `pageable`, not as top-level `page`/`size`. The vendor's own
     *   *Buscar citas* page documents the top-level form; its Postman collection uses the nested one.
     *   The collection was right.
     */
    const { provider: p, calls } = provider(observedAppointmentSearchEmpty);
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_agenda',
        { startAppointment: '1990-01-01 00:00', endAppointment: '1990-01-02 00:00' },
        CTX,
      ),
    );

    const sent = JSON.parse(String(calls[0]?.init?.body)) as {
      body: Record<string, unknown>;
    };
    expect(sent.body).toHaveProperty('pageable');
    expect(sent.body).not.toHaveProperty('size');
    expect(data.items).toEqual([]);
    expect(data.totalResults).toBe(0);
  });

  it('a clinic id is a real five-digit id, not the docs’ example `8`', () => {
    // Worth a test only because a reviewer reading the docs would expect a small number, and a
    // hard-coded `8` would look plausible right up to the point a booking lands in nobody's diary.
    expect((observedClinics as Array<{ id: number }>)[0]?.id).toBeGreaterThan(1000);
  });
});

describe('observed — statuses the documentation does not have', () => {
  it('treats 429 as rate limiting', async () => {
    /*
     * The portal's status table lists 200/400/401/404/405/500 and no 429. Seven catalog reads in
     * quick succession returned `429` with an empty body. The shared map already handles it; this
     * test records that the ceiling exists, because nothing in the vendor's docs says so and an
     * agent that fans out reads per turn will meet it.
     */
    const { provider: p } = provider('', 429);
    const result = await p.callTool('mcp_saludtools_get_catalog', { catalog: 'clinics' }, CTX);
    if (result.kind !== 'error') throw new Error('expected an error');
    expect(result.code).toBe(ProviderErrorCode.RATE_LIMITED);
  });
});

describe('observed — the round-trip proof found three defects the unit tests could not', () => {
  it('clamps the page size to 20, because 25 is refused', async () => {
    /*
     * The gateway's default page size is 25 (`core/pagination`). SaludTools answers
     * `{"code": 412, "message": "La cantidad maxima de elementos a consultar debe ser menor a 20"}`,
     * so EVERY paginated call failed with the default — get_agenda, list_patient_appointments, the
     * lot. Nothing in the vendor's documentation mentions a ceiling.
     *
     * The message is also off by one: `size: 20` is accepted. The clamp is 20 because that was
     * measured, not because the sentence says 20.
     */
    const { provider: p, calls } = provider(observedAppointmentSearchEmpty);
    await p.callTool(
      'mcp_saludtools_get_agenda',
      {
        startAppointment: '1990-01-01 00:00',
        endAppointment: '1990-01-02 00:00',
        pageSize: 25,
      },
      CTX,
    );
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { body: Record<string, unknown> };
    expect(sent.body.pageable).toEqual({ page: 0, size: 20 });
  });

  it('leaves a page size the provider accepts alone', () => {
    // A clamp that also rewrote smaller pages would be inventing a limit of its own.
    expect(observedPageSizeTooLarge.code).toBe(412);
  });

  it('does not clamp below the ceiling', async () => {
    const { provider: p, calls } = provider(observedAppointmentSearchEmpty);
    await p.callTool(
      'mcp_saludtools_get_agenda',
      { startAppointment: '1990-01-01 00:00', endAppointment: '1990-01-02 00:00', pageSize: 5 },
      CTX,
    );
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { body: Record<string, unknown> };
    expect(sent.body.pageable).toEqual({ page: 0, size: 5 });
  });

  it('reads "no such patient" as an ANSWER, even though it arrives as a success with no body', async () => {
    /*
     * The decisive one. Production answers an unregistered document with **HTTP 200**, `code: 200`
     * and `body: null` — not the `412` the vendor's docs show, and with a different sentence
     * ("No se encontro un paciente…" vs "…no se ha encontrado un paciente…").
     *
     * So the prose marker written from the documentation never fired, `project(null)` returned null,
     * and the tool reported PROVIDER_ERROR: the agent would be told SaludTools had malfunctioned when
     * it had in fact answered the question. The signal is structural now — a success with an empty
     * body — and the prose is the fallback.
     */
    const { provider: p } = provider(observedPatientNotFound);
    const result = await p.callTool(
      'mcp_saludtools_get_patient',
      { documentType: 1, documentNumber: '000000000' },
      CTX,
    );
    expect(result.kind).toBe('success');
    expect(successData(result)).toEqual({ found: false });
  });

  it('applies the same reading to an appointment id that matches nothing', async () => {
    const { provider: p } = provider({ ...observedPatientNotFound, message: 'no existe' });
    const result = await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX);
    expect(result.kind).toBe('success');
    expect(successData(result)).toEqual({ found: false });
  });

  it('still reports a genuinely broken payload as an error', async () => {
    // "Nothing came back" and "something unusable came back" are different, and only one is an answer.
    const { provider: p } = provider({ code: 200, eventId: 'x', body: 'not-a-record' });
    const result = await p.callTool('mcp_saludtools_get_appointment', { id: '1' }, CTX);
    expect(result.kind).toBe('error');
  });
});

describe('observed — read-only exploration of the catalogs and the clinical eventTypes', () => {
  /*
   * All 32 documented catalog paths and every clinical eventType were called against production on
   * 2026-09-22, with identifiers that cannot match a record. No patient data was read and nothing
   * was written; the dispatcher's own error text is the whole answer.
   */

  it.each(['encountercommonid', 'remissioncontainerid', 'antecedentspersonal'])(
    'does not publish %s as a catalog — it is a per-patient read wearing a catalog URL',
    (name) => {
      /*
       * Each sits on `/integration/parametric/` and reads like reference data. Each answers
       * `412 "Required String parameter 'documentType' is not present"`. An encounter belongs to
       * somebody; so does a personal-history entry. Left in the enum they would have been dead
       * options offered to an agent, every call a 412.
       */
      const names = Object.values({ ...AGENT_CATALOGS, ...REFERENCE_CATALOGS }).map((c) => c.name);
      expect(names).not.toContain(name);
    },
  );

  it('publishes only catalogs that answered 200', () => {
    // 8 agent-facing + 21 reference = 29, which is what production served. The other three are the
    // per-patient reads above, and `atcconcentration` needs its filter (next test).
    expect(Object.keys(AGENT_CATALOGS)).toHaveLength(8);
    expect(Object.keys(REFERENCE_CATALOGS)).toHaveLength(21);
  });

  it('refuses a concentration lookup with no active principle, without a round trip', async () => {
    // Production answers `412 "Required Long parameter 'principleact' is not present"`. Correct, and
    // a network round trip to learn something the tool already knew — and the caller gets a message
    // naming the field instead of the provider's.
    const { provider: p, calls } = provider([]);
    const result = await p.callTool(
      'mcp_saludtools_get_reference_catalog',
      { catalog: 'atcConcentrations' },
      CTX,
    );
    if (result.kind !== 'error') throw new Error('expected an error');
    expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(result.message).toContain('principleAct');
    expect(calls).toHaveLength(0);
  });

  it('still calls the concentration catalog when the principle is given', async () => {
    const { provider: p, calls } = provider([{ id: 1, name: '500mg' }]);
    await p.callTool(
      'mcp_saludtools_get_reference_catalog',
      { catalog: 'atcConcentrations', principleAct: 10 },
      CTX,
    );
    expect(calls[0]?.url).toContain('principleact=10');
  });
});
