import { describe, expect, it } from 'vitest';

import { himedSchedulingProvider } from '../index';

/**
 * A consumer receives a name, a description and a schema — none of which say that a tool returns a
 * patient's records. So the provider says it, and `tools/list` carries it (under `_meta`).
 *
 * Both patient-exposing reads are `subject-scoped`, not `subject-bound`: HiMed identifies a patient by
 * `idPaciente` (a document number), which is NOT the WhatsApp Subject (phone/BSUID). A `subject-bound`
 * policy would compare the document against the writer's phone and never match, blocking even a
 * legitimate self-lookup. Until a phone→patient reconciliation exists, the honest guard under `strict`
 * on a patient channel is to reject the call (subject-scoped), not to field-compare. See
 * xcale-backend docs/design/himed-connect (QB3 / #1174) and mcp-server #109.
 */
describe('himed-scheduling publishes whose data each tool can reach', () => {
  const byName = new Map(himedSchedulingProvider.listTools().map((t) => [t.name, t]));

  it('marks the patient-exposing reads as subject-scoped', () => {
    expect(byName.get('mcp_himed-scheduling_patient_exists')?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
    expect(byName.get('mcp_himed-scheduling_list_patient_appointments')?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
  });

  it('leaves the directory and availability reads unmarked — they name nobody', () => {
    // Absent is the default and must stay cheap: a locations read carries no policy, so the consumer
    // short-circuits before reading anything.
    expect(byName.get('mcp_himed-scheduling_list_locations')?.identityPolicy).toBeUndefined();
    expect(byName.get('mcp_himed-scheduling_get_availability')?.identityPolicy).toBeUndefined();
  });
});
