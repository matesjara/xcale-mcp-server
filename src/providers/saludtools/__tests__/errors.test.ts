import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import {
  classifySaludtoolsStatus,
  isPatientNotFound,
  patientAlreadyExists,
  unwrapSaludtools,
} from '../errors';

import patientNotFound412 from '../__fixtures__/errors/patientNotFound412.json';
import patientRead from '../__fixtures__/patientRead.json';

const ok200 = (data: unknown): RequestResult => ({ ok: true, status: 200, data });

const failed = (status: number, body = ''): RequestResult => ({
  ok: false,
  status,
  errorCode: ProviderErrorCode.PROVIDER_ERROR,
  body,
});

describe('classifySaludtoolsStatus', () => {
  it('sends 412 to INVALID_INPUT — the one thing the shared map cannot know', () => {
    // The vendor uses 412 for every input problem: missing eventType, wrong actionType, absent
    // pagination, unsupported verb. PROVIDER_ERROR would tell the caller to give up on a call it
    // could have fixed.
    expect(classifySaludtoolsStatus(412)).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it.each([
    [401, ProviderErrorCode.AUTH_EXPIRED],
    [403, ProviderErrorCode.AUTH_EXPIRED],
    [429, ProviderErrorCode.RATE_LIMITED],
    [500, ProviderErrorCode.PROVIDER_UNAVAILABLE],
    [400, ProviderErrorCode.INVALID_INPUT],
    [404, ProviderErrorCode.PROVIDER_ERROR],
  ])('defers to the shared policy for %i', (status, expected) => {
    // Everything else is the universal map. A provider does not get its own opinion about 401.
    expect(classifySaludtoolsStatus(status)).toBe(expected);
  });
});

describe('unwrapSaludtools', () => {
  it('returns the envelope body on a documented success', () => {
    const result = unwrapSaludtools(ok200(patientRead), 'get patient');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).documentNumber).toBe('177400432');
    }
  });

  it('passes a bare array through: a catalog has no envelope to check', () => {
    const catalog = [{ id: 1, name: 'Masculino' }];
    const result = unwrapSaludtools(ok200(catalog), 'get catalog');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(catalog);
  });

  it('fails a 200 whose envelope carries a rejection code', () => {
    const result = unwrapSaludtools(ok200(patientNotFound412), 'get patient');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('fails a 200 with no envelope code rather than guessing it worked', () => {
    const result = unwrapSaludtools(ok200({ body: { id: 1 } }), 'get patient');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('fails a 200 that is not an object at all', () => {
    const result = unwrapSaludtools(ok200('surprise'), 'get patient');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('classifies a transport failure on its own status', () => {
    const result = unwrapSaludtools(failed(412), 'get patient');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('carries the vendor message as `detail` and keeps it out of `message`', () => {
    const result = unwrapSaludtools(ok200(patientNotFound412), 'get patient');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toBe(patientNotFound412.message);
      // `message` is what a caller sees: the operation, the code and the correlation id. Never prose.
      expect(result.message).not.toContain('no se ha encontrado');
      expect(result.message).toContain('662878c34dea4b9cada70f105479de07');
    }
  });
});

describe('isPatientNotFound', () => {
  it("recognizes the vendor's documented sentence, verbatim", () => {
    /*
     * This test exists to pin a STRING the vendor controls, and that is on purpose: the whole
     * distinction between "no such patient" and "your request was malformed" hangs off it, because
     * SaludTools reports both as 412 and the closed error set has no NOT_FOUND code.
     *
     * If the vendor rewords the message this test goes red — which is the point. A silent regression
     * here means an agent told "invalid input" about a perfectly good lookup, and an agent that
     * believes it made a bad call will either retry it or invent an explanation for the patient.
     */
    const result = unwrapSaludtools(ok200(patientNotFound412), 'get patient');
    expect(patientNotFound412.message).toContain('no se ha encontrado un paciente');
    expect(isPatientNotFound(result)).toBe(true);
  });

  it('matches when the failure arrives as a REAL HTTP 412, not inside a 200', () => {
    /*
     * REGRESSION. The first version of `unwrapSaludtools` returned early on a transport failure and
     * never parsed the body — because the core hands a non-2xx back as an unparsed `body` string
     * rather than `data`. SaludTools answers an unknown patient with a real HTTP 412 carrying the
     * envelope, so the marker had nothing to match and `get_patient` reported PROVIDER_INVALID_INPUT
     * for a lookup that was fine. Two tests went red and that is the only reason it was found.
     */
    const result = unwrapSaludtools(failed(412, JSON.stringify(patientNotFound412)), 'get patient');
    expect(isPatientNotFound(result)).toBe(true);
    if (!result.ok) expect(result.message).toContain('662878c34dea4b9cada70f105479de07');
  });

  it('survives an error body that is not an envelope at all', () => {
    // The documented 401 body is a bare JSON string; a gateway may answer with HTML; the core
    // truncates an error body at 500 characters. None of those may throw.
    for (const body of ['"No tiene permisos para acceder al servidor"', '<html>502</html>', '']) {
      const result = unwrapSaludtools(failed(401, body), 'get patient');
      expect(result.ok).toBe(false);
      expect(isPatientNotFound(result)).toBe(false);
    }
  });

  it('matches regardless of case and accents', () => {
    const result = unwrapSaludtools(
      ok200({ code: 412, message: 'No sé ha encontrado un paciénte en la base', eventId: 'x' }),
      'get patient',
    );
    expect(isPatientNotFound(result)).toBe(true);
  });

  it('stays narrow: another 412 is not a missing patient', () => {
    // A real input error dressed up as "no such patient" would have the agent cheerfully offering to
    // register somebody who is already there.
    const result = unwrapSaludtools(
      ok200({ code: 412, message: 'No se ha enviado un tipo de evento valido', eventId: 'x' }),
      'get patient',
    );
    expect(isPatientNotFound(result)).toBe(false);
  });

  it('is false for a success', () => {
    expect(isPatientNotFound(unwrapSaludtools(ok200(patientRead), 'get patient'))).toBe(false);
  });

  it('is false for a failure that carries no vendor message', () => {
    expect(isPatientNotFound(unwrapSaludtools(failed(500), 'get patient'))).toBe(false);
  });
});

describe('patientAlreadyExists', () => {
  const refusal = (message: string) =>
    unwrapSaludtools(ok200({ id: null, code: 412, message, body: null }), 'create patient');

  it('recognizes the sentence production actually sends, and lifts the id out of it', () => {
    expect(
      patientAlreadyExists(
        refusal('Ya existe un paciente con el tipo y numero de documento enviado. Id:6929503'),
      ),
    ).toEqual({ patientId: 6929503 });
  });

  it('matches the CLASS of sentence, not the one example', () => {
    /*
     * The vendor has already reworded a message once during this integration, and it accents
     * inconsistently ("numero" here, "informacion" elsewhere, both unaccented — but nothing
     * guarantees the next release is). Spacing around the colon varies across their messages too.
     *
     * Pinning the exact string would mean the day SaludTools tidies its Spanish, every duplicate
     * create silently goes back to being reported as bad input.
     */
    for (const message of [
      'Ya existe un paciente con el tipo y numero de documento enviado. Id: 41',
      'YA EXISTE UN PACIENTE REGISTRADO. Id:41',
      'Ya existe un paciente con ese número de documento. id : 41',
    ]) {
      expect(patientAlreadyExists(refusal(message)), message).toEqual({ patientId: 41 });
    }
  });

  it('still reports the fact when the message carries no id', () => {
    // An empty object, not undefined: "they exist" is the answer even without the id, and the
    // caller finds them with the document it already holds.
    expect(patientAlreadyExists(refusal('Ya existe un paciente con esos datos'))).toEqual({});
  });

  it('stays narrow — a real input error is not a duplicate', () => {
    expect(patientAlreadyExists(refusal('No se ha enviado un tipo de evento valido'))).toBe(
      undefined,
    );
  });

  it('is undefined for a success and for a failure with no vendor message', () => {
    expect(patientAlreadyExists(unwrapSaludtools(ok200(patientRead), 'get patient'))).toBe(
      undefined,
    );
    expect(patientAlreadyExists(unwrapSaludtools(failed(500), 'create patient'))).toBe(undefined);
  });
});

describe('classifySaludtoolsStatus — 402, observed and undocumented', () => {
  it('treats 402 as a caller-fixable input error, not a provider malfunction', () => {
    /*
     * Observed 2026-09-24 against production: `EXAMS_RESULTS`/`READ` with no id answers
     * `HTTP 402 {"code": 402, "message": "Se esperaba un id"}`. 402 appears in no SaludTools
     * documentation, exactly like the 429 production also emits.
     *
     * The shared map sends it to PROVIDER_ERROR, which tells a caller to give up on a call it could
     * fix by adding one field. That is the same defect 412 had, on a status nobody knew existed.
     */
    expect(classifySaludtoolsStatus(402)).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('classifies it the same way whether it arrives on the transport or in the envelope', () => {
    // The envelope reuses HTTP's numbers, so a 402 inside a 200 has to land in the same place --
    // otherwise the same condition would read as fixable or fatal depending on where it was written.
    const inEnvelope = unwrapSaludtools(
      ok200({ id: null, code: 402, message: 'Se esperaba un id', body: null }),
      'read exam results',
    );
    const onTransport = unwrapSaludtools(failed(402), 'read exam results');

    expect(inEnvelope.ok).toBe(false);
    expect(onTransport.ok).toBe(false);
    if (!inEnvelope.ok && !onTransport.ok) {
      expect(inEnvelope.code).toBe(ProviderErrorCode.INVALID_INPUT);
      expect(onTransport.code).toBe(ProviderErrorCode.INVALID_INPUT);
    }
  });

  it('leaves the statuses around it alone', () => {
    // 402 is carved out because it was observed, not because a range was guessed at.
    expect(classifySaludtoolsStatus(401)).toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(classifySaludtoolsStatus(404)).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(classifySaludtoolsStatus(405)).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(classifySaludtoolsStatus(429)).toBe(ProviderErrorCode.RATE_LIMITED);
    expect(classifySaludtoolsStatus(500)).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
  });
});
