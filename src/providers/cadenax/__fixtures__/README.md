# Cadenax fixtures — Documented, not recorded

No Cadenax key has been issued to this server yet, so none of these is a recording. Each one is the
response shape Cadenax's own source declares on `main` of `CofinetCol/cofinet-backend` at `bf7ce56`
(2026-11-23), with visibly fake values:

| Fixture                                  | Source of the shape                                                                                                                |
| :--------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `whoami.json`, `whoami-two-offices.json` | `src/services/apiKeyService.ts` › `getPrincipalProfile`, and the assertions of `src/controllers/authMe.apiKey.integration.test.ts` |
| `staff-by-phone.json`                    | the OpenAPI block of `GET /users/by-phone` in `src/routes/userRoutes.ts`                                                           |
| `lots-search.json`, `reservation.json`   | the list and detail envelopes in `docs/openapi/cofinet-api.json`; the rows carry only the fields the spec names                    |

The tools return Cadenax's payload untouched, so the tests assert the envelope and the request, never
the fields of a row. Replace every file with an anonymized recording at the first call made with a
`cof_dev_` key (`docs/design/cadenax-provider/feature-design.md` §9, Q-1).
