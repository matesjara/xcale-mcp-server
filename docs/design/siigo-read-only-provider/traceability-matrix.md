# Siigo — Provider Traceability Matrix

> **Purpose.** The single view that answers *"is this Observed fact captured in the contract,
> implemented, and tested?"* The API contract is descriptive; the implementation plan is operational;
> **neither answers traceability — this does.** Rows are seeded from official-doc *hypotheses*
> (confidence-tagged); **nothing here is authoritative** until the `Observed?` column is checked in B1.
>
> **Flow:** B1 fills `Observed value` + flips `Observed?` → B2 fills `Contract §` → B3 fills
> `Code` + `Test` → each row reaches ✅ only when implemented **and** tested against the Observed fact.
> A row that stays `Observed? ⬜` **blocks** its downstream cells.
>
> **Confidence legend** (from `sandbox-verification.md`): **O** Observed · **S** SDK-confirmed ·
> **D** Officially documented · **I** Inferred.

## Auth & transport

| Fact needed | Hypothesis (conf.) | Observed value | Observed? | Contract § | Code | Test |
|:--|:--|:--|:--:|:--|:--|:--|
| API flavor / base URL | `services.siigo.com/alliances/api` (S) **vs** `api.siigo.com` (D) — **conflict** | — | ⬜ | — | `siigo/auth.ts` `client.ts` | conformance |
| Auth endpoint + method | `POST .../siigoapi-users/v1/sign-in` (S) vs `POST /auth` (D) | — | ⬜ | — | `siigo/auth.ts` | — |
| Auth body field names | `userName`/`accessKey` (S) vs `username`/`access_key` (D) | — | ⬜ | — | `siigo/auth.ts` (`bodyFields`) | — |
| Token response field | `access_token` (D/I) | — | ⬜ | — | `siigo/auth.ts` (`responseFields.token`) | — |
| Token expiry field + TTL | `expires_in`? · TTL 24h (D) | — | ⬜ | — | `siigo/auth.ts` (`responseFields.expiry`) | — |
| `Partner-Id` value | integrator app name, 3–100 alnum (D); xcale's = **assigned** | — | ⬜ | — | deployment config + `staticHeaders` | — |
| Token placement | `Authorization: Bearer` (D) | — | ⬜ | — | descriptor `tokenPlacement` | materializer test (exists) |

## Pagination & errors

| Fact needed | Hypothesis (conf.) | Observed value | Observed? | Contract § | Code | Test |
|:--|:--|:--|:--:|:--|:--|:--|
| Pagination request params | `page`, `page_size` (D/S) | — | ⬜ | — | `siigo/tools.ts` (page/pageSize → wire) | pagination test |
| Pagination response shape | `{ pagination: { page, page_size, total_results }, results: [] }` (D/S) | — | ⬜ | — | `siigo/tools.ts` (list unwrap) | list test |
| Error envelope shape | `Manejo de errores` w/ `Detail`; exact shape unknown (I) | — | ⬜ | — | `siigo/tools.ts`/`errors.ts` | error test |
| Rate limits | unknown (—) | — | ⬜ | — | — | — |

## Read tools (curated set — locked in B0-internal)

| Tool | Endpoint hypothesis (conf.) | Observed path | Observed? | Contract § | Code | Test |
|:--|:--|:--|:--:|:--|:--|:--|
| `mcp_siigo_list_customers` | `GET /v1/customers` (D/S) | — | ⬜ | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_get_customer` | by-id path (I) | — | ⬜ | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_list_invoices` | `GET /v1/invoices` (D/S) | — | ⬜ | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_get_invoice` | by-id path (I) | — | ⬜ | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_list_products` | `GET /v1/products` (D/S) | — | ⬜ | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_get_product` | by-id path (I) | — | ⬜ | — | `siigo/tools.ts` | `siigo.test.ts` |

> **Fidelity over Unification:** the `data` each tool returns is Siigo's response **verbatim** — there
> is no per-field mapping to trace (no mapper/DTO). Only the *envelope* (list unwrap + error mapping)
> and the *request* (path, params, filters) are provider-specific and traced above.
