import { describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { buildSaludtoolsClinicalWriteTools } from '../clinical-writes';
import { createSaludtoolsClient } from '../client';
import { createSaludtoolsProvider } from '../provider';

/**
 * PHASE 4 — the clinical writes.
 *
 * **None of these has ever been executed against any environment**, and these tests do not change
 * that: they drive a stubbed transport. Nine of the ten surfaces have no delete, so the phase cannot
 * be exercised against a clinic that treats patients (xcale-backend#1057). What is tested here is
 * everything that can be known without running them — that they are unreachable by an agent, that
 * they send the body the vendor documents, and that the one silent-corruption case is refused.
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

function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

const WRITES = buildSaludtoolsClinicalWriteTools(createSaludtoolsClient({ baseUrl: BASE_URL }));

/**
 * The agent-facing surface, in full. Phases 1 and 2 — the agenda loop, the patient lookup and the
 * catalogs — and nothing else.
 */
const PUBLISHED = [
  'mcp_saludtools_create_appointment',
  'mcp_saludtools_create_patient',
  'mcp_saludtools_get_agenda',
  'mcp_saludtools_get_appointment',
  'mcp_saludtools_get_catalog',
  'mcp_saludtools_get_patient',
  'mcp_saludtools_list_patient_appointments',
  'mcp_saludtools_update_appointment',
  'mcp_saludtools_update_patient',
];

describe('the published surface is a CLOSED list', () => {
  it('publishes exactly the agenda loop, the patient lookup and the catalogs', async () => {
    /*
     * The strongest guard this provider has, and the reason phases 3 and 4 could be built at all.
     *
     * An `expect(...).toEqual(list)` on the whole published surface fails for ANY tool that becomes
     * agent-visible — a new one written without `controlPlane`, or an existing one whose flag is
     * dropped in a refactor. A per-tool check only catches the tools someone remembered to check.
     *
     * If this goes red, do not update the list to make it pass. Find out what became visible: on
     * this provider that is a patient's medical record reaching a model's context window.
     */
    const { provider: p } = provider([]);
    const published = (await p.listTools()).map((tool) => tool.name).sort();
    expect(published).toEqual(PUBLISHED);
  });

  it('adding the clinical phases changed nothing about what an agent can see', async () => {
    // Twenty-seven clinical tools exist; the agent's menu is still nine.
    const { provider: p } = provider([]);
    expect((await p.listTools()).length).toBe(9);
    expect(WRITES.length).toBeGreaterThan(10);
  });

  it('withdraws every clinical write, with no exception list', () => {
    const exposed = WRITES.filter((tool) => tool.controlPlane !== true).map((tool) => tool.name);
    expect(exposed).toEqual([]);
  });

  it('declares an identity policy on every clinical write', () => {
    for (const tool of WRITES) {
      expect(tool.identityPolicy, `${tool.name} declares no identity policy`).toBeDefined();
    }
  });
});

describe('the family-history write refuses the one case the provider corrupts silently', () => {
  /*
   * The vendor documents that `diagnosticText` and `diagnosticType` are mutually exclusive and that
   * sending both makes it **pick one**. It does not reject the call.
   *
   * So a caller with two different intentions gets an arbitrary one of them written into a medical
   * history, with no error to notice — the exact shape of defect that only surfaces months later
   * when somebody reads the record. This is the one place in phase 4 where validating harder than
   * the provider is correct, because the provider's own behaviour is the bug.
   */
  const base = {
    documentType: 1,
    documentNumber: '123456789',
    familiarRelationshipType: 5,
  };

  it('rejects both at once', async () => {
    const { provider: p, calls } = provider({ id: 1, code: 200, body: null });
    const result = await p.callTool(
      'mcp_saludtools_create_family_history',
      { ...base, diagnosticText: 'Detalles', diagnosticType: 'A000' },
      CTX,
    );
    expect(result.kind).toBe('error');
    // And it never reached the clinic.
    expect(calls).toHaveLength(0);
  });

  it('rejects neither', async () => {
    const { provider: p, calls } = provider({ id: 1, code: 200, body: null });
    const result = await p.callTool('mcp_saludtools_create_family_history', { ...base }, CTX);
    expect(result.kind).toBe('error');
    expect(calls).toHaveLength(0);
  });

  it('accepts exactly one, either way round', async () => {
    for (const diagnosis of [{ diagnosticText: 'Detalles' }, { diagnosticType: 'A000' }]) {
      const { provider: p } = provider({ id: 77, code: 200, body: null });
      const result = await p.callTool(
        'mcp_saludtools_create_family_history',
        { ...base, ...diagnosis },
        CTX,
      );
      expect(result.kind, JSON.stringify(diagnosis)).toBe('success');
      expect(successData(result)).toEqual({ created: true, familyHistoryId: 77 });
    }
  });
});

describe('the writes send the body the vendor documents', () => {
  it("flattens our readability nesting back onto the vendor's flat body", async () => {
    /*
     * `create_gyneco_history` groups the obstetric fields under `history` so the schema is readable.
     * The vendor's body is flat — the patient's document alongside the history's own fields — and
     * the wire stays the vendor's (ADR 0009). If this nesting reached SaludTools it would be a 412
     * that says nothing about which field it disliked.
     */
    const { provider: p, calls } = provider({ id: 5, code: 200, body: null });
    await p.callTool(
      'mcp_saludtools_create_gyneco_history',
      {
        documentType: 1,
        documentNumber: '123456789',
        history: { pregnancies: 2, births: 1, currentlyPregnant: false },
      },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as { body: Record<string, unknown> };
    expect(body.body).toHaveProperty('pregnancies', 2);
    expect(body.body).toHaveProperty('documentNumber', '123456789');
    expect(body.body).not.toHaveProperty('history');
  });

  it('posts a document upload to the separate path, not the event endpoint', async () => {
    // The single operation the vendor puts on its own URL. Search and download go through the
    // ordinary event endpoint; only the upload does not, and sending it to the wrong one fails in a
    // way that looks like a permissions problem.
    const { provider: p, calls } = provider({ id: 9, code: 200, body: null });
    await p.callTool(
      'mcp_saludtools_upload_patient_file',
      { documentType: 1, documentNumber: '123456789', files: { fileName: 'doc.pdf' } },
      CTX,
    );
    expect(calls[0]?.url).toContain('/integration/sync/event/documents/v1/');
    expect(calls[0]?.url).not.toMatch(/\/event\/v1\/$/);
  });

  it("keeps the vendor's own capitalisation of PatientId", async () => {
    // `PatientId`, not `patientId`. Ours to reproduce, not to tidy: a renamed key is a field the
    // provider never sees, and on a prescription that is a medicine attached to nobody.
    const { provider: p, calls } = provider({ id: 11, code: 200, body: null });
    await p.callTool(
      'mcp_saludtools_create_prescription',
      {
        doctorDocumentType: 1,
        doctorDocumentNumber: 1111111,
        PatientId: 12800,
        prescriptedMedicine: [{ medicinePrescriptionType: 'ACTIVE_PRINCIPLE' }],
      },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as { body: Record<string, unknown> };
    expect(body.body).toHaveProperty('PatientId', 12800);
    expect(body.body).not.toHaveProperty('patientId');
  });

  it('forwards a clinical block verbatim instead of filtering it', async () => {
    /*
     * The asymmetry that makes phase 4 safe under imperfect documentation: projections on the way
     * OUT are allow-lists, inputs on the way IN are not. A schema stricter than the provider rejects
     * a clinical record the clinic was entitled to file, with OUR error rather than the provider's —
     * and this API has already been documented wrong in both directions.
     */
    const { provider: p, calls } = provider({ id: 3, code: 200, body: null });
    await p.callTool(
      'mcp_saludtools_create_clinic_history',
      {
        patientDocumentType: 1,
        documentNumber: '123456789',
        patientVitalSignsRecord: { weight: 70, someFieldTheDocsNeverListed: 42 },
      },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as {
      body: { patientVitalSignsRecord: Record<string, unknown> };
    };
    expect(body.body.patientVitalSignsRecord).toEqual({
      weight: 70,
      someFieldTheDocsNeverListed: 42,
    });
  });

  it("validates the paraclinic's odd date format rather than converting it", async () => {
    // `DD-MM-AAAA` on this surface and only this one. Rejected early so the caller gets a typed
    // error naming the field, instead of a 412 that does not say which field it disliked.
    const { provider: p, calls } = provider({ id: 1, code: 200, body: null });
    const result = await p.callTool(
      'mcp_saludtools_create_paraclinic',
      { patientDocumentType: 1, documentNumber: '123', examDate: '2022-02-12' },
      CTX,
    );
    expect(result.kind).toBe('error');
    expect(calls).toHaveLength(0);
  });
});

describe('write outcomes say which thing happened', () => {
  it('reports a create with the id the envelope carries', async () => {
    const { provider: p } = provider({
      id: 4242,
      code: 200,
      message: 'Se registra',
      body: null,
    });
    const data = successData(
      await p.callTool(
        'mcp_saludtools_create_disability',
        {
          documentType: 1,
          documentNumber: '123456789',
          diagnosticCIE10ID: 'A010',
          startInabilityDate: '2022-09-30',
          endInabilityDate: '2022-10-05',
        },
        CTX,
      ),
    );
    expect(data).toEqual({ created: true, disabilityId: 4242 });
  });

  it('reports a delete as a delete, on the one surface that has one', async () => {
    const { provider: p } = provider({ code: 200, message: 'Se elimina' });
    const data = successData(
      await p.callTool('mcp_saludtools_delete_prescription', { id: 99 }, CTX),
    );
    expect(data).toEqual({ deleted: true });
  });
});
