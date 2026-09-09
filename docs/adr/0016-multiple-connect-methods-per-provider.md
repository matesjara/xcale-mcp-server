# ADR 0016: A provider may publish more than one way to CONNECT, but only one way to AUTHENTICATE

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision makers:** Juan José
- **Tags:** contract, catalog, auth, cloudbeds

## Context

Cloudbeds can be reached with two different credentials:

| | How the credential is obtained | How it is applied on the wire |
| :-- | :-- | :-- |
| OAuth 2.0 | authorize → callback → token exchange | `Authorization: Bearer <access_token>` |
| API key | the property mints a `cbat_…` key in its own Cloudbeds account and pastes it | `Authorization: Bearer <cbat_…>` |

Today `IProvider.auth` is a single `ProviderAuthDescriptor` and `CatalogEntry.authDescriptor` is a
single value, so a provider can only advertise one of these. The consumer's registration
(`xcale-backend`, `mcp-bootstrap.ts`) branches with `if (authType === 'oauth2') … else if …` — one
descriptor in, one connect method out.

That is a real limit, not a cosmetic one. Cloudbeds' OAuth path is gated by their partner
certification — _"Before certification, your app can only connect to your test account"_ — while the
API-key path is not gated at all. A hotel that cannot use the first can use the second **today**.
With one descriptor per provider, offering both is impossible.

**The measurement that shaped this decision.** Probed against Bio Habitat's real property key
(`20064`, 2026-08-20, read-only):

- `Authorization: Bearer <cbat_…>` → `200`. `x-api-key: <cbat_…>` → `200`. **Both placements work.**
- The full booking read path answers: `getAvailableRoomTypes`, `getRatePlans`, `getRoomTypes`,
  `getReservations`, `getGuestList`, `getRooms`, `getItems`, `getDashboard`, `getTaxesAndFees`.
- `getAppState` → HTTP **200** with `{"success":false,"message":"This call is restricted to
  third-party integrations."}`.

The first line is the one that matters here: **the two credentials materialize identically.** The
difference between them is entirely upstream of the wire.

## Decision

**Split the two questions the descriptor was conflating.**

1. **`IProvider.auth` remains singular and remains the ONLY input to materialization.**
   `authentication-materializer.ts` is untouched, `providers/cloudbeds/client.ts` is untouched, and
   every `tools/call` produces the same bytes it produced before. A pasted `cbat_` key and an OAuth
   access token arrive at the materializer as the same `ResolvedCredential` and leave as the same
   `Authorization: Bearer …` header.

2. **A provider MAY publish additional descriptors that describe how to CONNECT**, via
   `IProvider.additionalAuth?: readonly ProviderAuthDescriptor[]`, surfaced on the catalog as
   `additionalAuthDescriptors`. Purely additive (ADR `additive-contract-versioning`): the field is
   optional, `authDescriptor` keeps its exact meaning, and a consumer that reads only
   `authDescriptor` behaves as it does today.

3. **The invariant that makes this safe, enforced by a test, not by a comment:**

   > Every descriptor a provider publishes — primary and additional — MUST materialize a given
   > secret into a byte-identical `HttpRequest`.

   `__tests__/auth-materialization-parity.test.ts` walks the registry, materializes the same secret
   through every published descriptor, and fails if any two differ. A provider whose second method
   genuinely needs a different placement is therefore a **compile-and-test failure**, not a silent
   mis-signed request — it needs a per-connection descriptor selector, which is a different design
   and a different ADR.

   This is why Cloudbeds' additional descriptor is declared as `type: 'bearer'` and **not** as
   `api_key` with `placement: 'header'` on `x-api-key`. Cloudbeds accepts both — that is measured
   above — so the choice is free, and `bearer` is the one that satisfies the invariant.

4. **A `connectionProbe` is now mandatory for Cloudbeds' credential method.** The consumer's
   `buildCredentialConfig()` returns `null` without one and refuses to register the method — _"a
   credential we cannot verify is one we do not store"_. `mcp_cloudbeds_list_properties` is the
   probe — **not** `get_hotel_details`, which every other read reaches only once `propertyID` is
   known. The probe runs BEFORE the connection exists, so no `propertyID` has been discovered yet;
   `list_properties` is the one published read that takes no context, which is why
   `contextDiscovery` already leans on it. Verified against a real property key (`20064`,
   2026-08-20): `getHotels` → `200`, `success: true`.

   **Caveat — fixed-probe design, same as Toteat:** the probe needs `read:hotel`, so a key minted
   WITHOUT that scope fails connect as _"credential invalid"_ rather than _"scope missing"_.

## Consequences

- **The rail does the rest.** `buildConnectDescriptor` already merges OAuth and credential methods
  for one slug (Shopify ships two methods today), and the frontend already renders a method selector
  when `methods.length > 1` — OAuth first, so it stays the default. No frontend change.
- **ADR-0051 keeps working and now works in our favour.** `isProviderConnectable()` is true for a
  slug with *any* usable method, so Cloudbeds reappears in the prod catalog on the credential method
  alone, with the OAuth secrets still absent. The provider is offered because something about it can
  actually be connected — which is precisely what that ADR asked for.
- **What this does NOT do:** it does not make Cloudbeds' OAuth work in production, and it does not
  shorten certification. `getAppState`/`postAppState` are refused on a property key, so the
  connect/disconnect state machine — a mandatory certification point — does not exist on this lane.
  Webhook echo suppression identifies our own writes by the OAuth client id, which this lane has no
  equivalent of, so push notifications stay off and that is **stated to the customer** rather than
  discovered by them.
- **A property key authenticates as the human who minted it** and dies with that user. That is a
  property of Cloudbeds' lane, not of this contract, but it is the operational risk that survives.

## References

- `docs/design/cloudbeds-certification/2026-08-02-informe-certificacion.md` — the certification track
- `xcale-backend` ADR-0051 `unconfigured-providers-are-not-offered`
- ADR `additive-contract-versioning` · ADR `credential-delivery-strategies`
- Cloudbeds: [Integration Guide](https://developers.cloudbeds.com/docs/integration-guide) ·
  [API keys for technology partners](https://developers.cloudbeds.com/docs/api-keys-authentication-guide-for-technology-partners)
