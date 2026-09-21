import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import { SALUDTOOLS_PRODUCTION_BASE_URL } from './auth';

/** Executes an authenticated request; the core reveals the minted JWT and applies `Bearer`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export type QueryParams = Readonly<Record<string, string | number | undefined>>;

/**
 * The `eventType` values that dispatch SaludTools' single event endpoint.
 *
 * **Every one of these is transcribed from a request body in the vendor's published Postman
 * collection.** None is inferred from a module's name, a URL or a menu label, because the vendor's
 * own naming does not follow one: the disability module is `INABILITYWORK` (no underscore), patient
 * documents are `PATIENT_FILES`, the gynaecological history is `GYNECOOBS_HISTORY` and the family
 * history is `FAMILY_HISTORY`. A plausible guess is wrong for four of the twelve.
 *
 * Two are the vendor's inconsistencies, kept as it published them rather than unified (Q10):
 * - `EXAM_RESULTS` (singular) appears on the exam-result READ; `EXAMS_RESULTS` (plural) on its
 *   SEARCH. One of the two is probably a typo in the collection. Until a call proves which, both are
 *   here and each is used exactly where the vendor used it.
 *
 * `ANTECEDENT_PERSONAL` is deliberately ABSENT: the personal-history module has documentation pages
 * but **no entry in the collection**, so its `eventType` string is unknown. Guessing it would be
 * guessing the one thing this type exists to pin down (Q11).
 */
export type EventType =
  | 'PATIENT'
  | 'APPOINTMENT'
  | 'MEDICINE'
  | 'CLINIC_HISTORY'
  | 'EXAMS_PRESCRIPTION'
  | 'EXAM_RESULTS'
  | 'EXAMS_RESULTS'
  | 'PARACLINICS'
  | 'INABILITYWORK'
  | 'PATIENT_FILES'
  | 'GYNECOOBS_HISTORY'
  | 'FAMILY_HISTORY';

/**
 * The five documented actions. There is **no `READ_LAST`**: "read the patient's last medicine" is
 * `MEDICINE`/`READ` with a different BODY (`{search: {documentType, documentNumber}}` instead of
 * `{id}`) — a body variant, not a sixth action. Modelling it as an action would have invented a value
 * the endpoint rejects.
 */
export type ActionType = 'CREATE' | 'READ' | 'UPDATE' | 'SEARCH' | 'DELETE';

export interface SaludtoolsClientDeps {
  /**
   * Base host. Production by default. A deployment may point a non-production environment at
   * `https://saludtools.qa.carecloud.com.co` — a DEPLOYMENT value, never a per-tenant or
   * catalog-sourced one, because the same host is pinned in xcale-backend for the mint and a
   * network-sourced host is precisely the repointing attack that pinning exists to stop.
   */
  readonly baseUrl?: string;
}

export interface SaludtoolsClient {
  /**
   * The one call almost everything goes through: `POST /integration/sync/event/v1/` with
   * `{eventType, actionType, body}`.
   */
  event(
    eventType: EventType,
    actionType: ActionType,
    body: Readonly<Record<string, unknown>>,
    request: AuthedRequest,
  ): Promise<RequestResult>;
  /**
   * Document UPLOAD only — the single operation the vendor puts on its own path
   * (`/integration/sync/event/documents/v1/`). Document search and download use `event()`.
   */
  documentUpload(
    body: Readonly<Record<string, unknown>>,
    request: AuthedRequest,
  ): Promise<RequestResult>;
  /** A reference catalog: `GET /integration/parametric/{name}/v1/`. */
  parametric(name: string, request: AuthedRequest, params?: QueryParams): Promise<RequestResult>;
}

const EVENT_PATH = '/integration/sync/event/v1/';
const DOCUMENT_UPLOAD_PATH = '/integration/sync/event/documents/v1/';

function buildQuery(params: QueryParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `?${query}` : '';
}

/**
 * A thin request builder. No auth, no secret, no cache, no business logic: the core's authentication
 * materializer adds `Authorization: Bearer <jwt>` on top of whatever this returns.
 *
 * Note what is NOT here: nothing derives a free slot, a clinic's opening hours or a next available
 * appointment. SaludTools publishes no availability endpoint, and computing availability would mean
 * this adapter inventing a clinic's working hours — a rule two clinics would answer differently and
 * both be right. The provider returns the booked agenda; the tenant's own instructions hold the rule
 * (grill-notes D3).
 */
export function createSaludtoolsClient(deps: SaludtoolsClientDeps = {}): SaludtoolsClient {
  const baseUrl = (deps.baseUrl ?? SALUDTOOLS_PRODUCTION_BASE_URL).replace(/\/+$/, '');

  const post = (
    path: string,
    body: Readonly<Record<string, unknown>>,
    request: AuthedRequest,
  ): Promise<RequestResult> =>
    request({
      method: 'POST',
      url: `${baseUrl}${path}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    event: (eventType, actionType, body, request) =>
      post(EVENT_PATH, { eventType, actionType, body }, request),

    documentUpload: (body, request) => post(DOCUMENT_UPLOAD_PATH, body, request),

    parametric: (name, request, params) =>
      request({
        method: 'GET',
        // The name is an internal constant from `catalogs.ts`, never caller-supplied — but encoded
        // anyway, because the next person to add a catalog should not have to know that.
        url: `${baseUrl}/integration/parametric/${encodeURIComponent(name)}/v1/${buildQuery(params)}`,
      }),
  };
}
