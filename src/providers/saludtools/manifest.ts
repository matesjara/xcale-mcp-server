import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'saludtools';

/**
 * SaludTools — cloud clinical-records and scheduling software for Colombian clinics and private
 * practices, by CareCloud S.A.S. The SECOND `credential_exchange` provider (after Siigo): a durable
 * `key`+`secret` mints a short-lived JWT; see `auth.ts`.
 *
 * ## Evidence status — READ THIS BEFORE TRUSTING A SHAPE HERE
 *
 * Every wire fact in this module is **Documented**, from the vendor's own developer portal
 * (`developer.saludtools.com`) and the Postman collection it publishes, read 2026-09-21. **None of it
 * is Observed**: no call has ever been made against SaludTools, because no credential exists yet
 * (`docs/design/saludtools-provider/grill-notes.md` §6 Q1). The fixtures are the vendor's own
 * published examples, not recordings, and they say so in their own headers.
 *
 * So this adapter is written to be *verified fast*, not to be trusted yet: the round-trip proof
 * (`server/discover` → `tools/list` → `tools/call` against the QA host, plus a forced auth failure)
 * has NOT been run, and the api-contract is deliberately unwritten until it can be.
 *
 * ## No `connectionProbe`
 *
 * Same reason as Siigo's: a `credential_exchange` provider proves its credential by MINTING once at
 * connect, and a mint-200 is the fail-closed gate. Routing a pasted `key`+`secret` through the generic
 * probe path would forward it as a bearer token, which SaludTools rejects.
 *
 * ## No `contextSchema` / `accountContextKeys` / `contextDiscovery`
 *
 * An appointment names its clinic with a numeric `clinic` id, and `parametric/clinics` lists them — so
 * a credential plausibly spans several clinics. That is **Q7, unresolved**. Until it is answered,
 * `clinic` travels as an EXPLICIT tool argument (Explicit Context, ADR 0009): the agent lists clinics
 * and passes one. Explicit is the reversible choice — promoting an argument to ambient context later is
 * additive, while demoting ambient context to an argument breaks every consumer that stored it.
 */
export const saludtoolsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'SaludTools',
  category: 'healthcare',
  logoUrl: '/assets/saludtools.svg',
  schemaVersion: '2026-09-21',
  providerVersion: '0.1.0',
  capabilities: {
    pagination: true,
    // The vendor supports webhooks, but only as a MANUAL setup inside the clinic's own SaludTools UI,
    // with no API to register or list them and no documented payload (grill-notes §2.11, Q5). Declaring
    // `webhooks: true` would tell a consumer it can subscribe one, which it cannot. Left false until a
    // receiver exists and a payload has been seen.
    webhooks: false,
  },
};
