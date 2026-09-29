import { err, ok, type ToolOutcome } from '../../core/tool';
import type { unwrapSaludtools } from './errors';

/*
 * How a SaludTools call becomes a tool result.
 *
 * Extracted from `tools.ts` so `clinical-writes.ts` can use the same `written()` rather than growing
 * a second copy that drifts. One definition, and both callers import it — the alternative is two
 * helpers that agree today and disagree the first time one of them learns something.
 */

export function toOutcome(result: ReturnType<typeof unwrapSaludtools>): ToolOutcome {
  return result.ok ? ok(result.data) : err(result.code, result.message);
}

/**
 * The outcome of a WRITE. Observed 2026-09-22: SaludTools answers a create with the new id in the
 * ENVELOPE (`{"id": 6923470, …, "body": null}`) — the mirror image of a read, where the record is in
 * `body` and the envelope id is null.
 *
 * Projecting `body` here, as the reads do, turned a successful registration into `PROVIDER_ERROR`
 * with the patient already created — and an agent told its call failed creates a duplicate on retry.
 * So a write reports what a write actually produces: WHICH thing happened (`created` / `updated`)
 * and the id when there is one. Not `{ok: true}` — the result envelope already says the call
 * succeeded, and a second `ok` nested inside the payload invites an agent to read meaning into a
 * field that has none.
 *
 * The id is informational, not a handle: `create_appointment` identifies a patient by DOCUMENT, not
 * by the id a create returns, so nothing needs to thread it through. It is there for a human reading
 * a log.
 *
 * **Resolved 2026-09-24, and in our favour:** SaludTools enforces uniqueness on (documentType,
 * documentNumber). A create that repeats a document is refused with `412 "Ya existe un paciente con
 * el tipo y numero de documento enviado. Id:6929503"` — so an agent that retries after a timeout
 * cannot duplicate a patient in a live clinic. `create_patient` reads that refusal as an answer
 * rather than an error; see its handler.
 *
 * **A delete answers with no body and no envelope id at all** — observed on the same run:
 * `{"code": 200, "message": "Se elimina el paciente id: 6929503"}`. Passed through the read-shaped
 * path that returns `body`, that is a success carrying `null`: technically correct, and useless to
 * whoever called it, who cannot tell a completed deletion from an empty one. `{deleted: true}` says
 * what happened. If a delete ever does carry a body, dropping it loses nothing — nobody needs the
 * contents of a record that no longer exists.
 */
export function written(
  result: ReturnType<typeof unwrapSaludtools>,
  outcome: 'created' | 'updated' | 'deleted',
  idKey: string,
): ToolOutcome {
  if (!result.ok) return err(result.code, result.message);
  return ok({
    [outcome]: true,
    ...(result.recordId !== undefined ? { [idKey]: result.recordId } : {}),
  });
}
