# SaludTools — PR bodies, ready to open

Two PRs, one per repo, opened when Mateo can review (his instruction, 2026-09-21: one PR with
everything, not a slice at a time). Written ahead because **each carries a dependency's diff**, and a
reviewer who opens them cold will not be able to tell which files are ours.

Copy the body verbatim into `gh pr create --body-file`. Precedent: `siigo-read-only-provider/pr-bodies.md`.

---

## 1. xcale-mcp-server — `docs/saludtools-integration` → `dev`

**Title:** `feat(saludtools): the SaludTools provider — clinics book against their real agenda`

**Body:**

> Epic: matesjara/xcale-backend#1054 · Blocked on matesjara/xcale-backend#1055 before any clinic uses it.
>
> SaludTools is CareCloud's clinical-records and scheduling product for Colombian clinics, and the
> third clinical integration on the board (#1053 HiMed, #1039 Dentalink). Its whole API is two POST
> endpoints — a `key`+`secret` exchange that mints a JWT, and one RPC endpoint dispatched by
> `eventType` and `actionType` — which makes it `credential_exchange` + `reference`, the shape Siigo
> already proved. It lands inside the `add-provider` golden rule with one deliberate exception, below.
>
> ### Read this first: what is in the diff that is not mine
>
> **This branch merges xcale-mcp-server#101** (`identityPolicy`), because it could not wait for that
> PR to merge and a PHI provider shipping ahead of it publishes declarations nobody enforces. Merged
> rather than copied, so the two branches share ancestry and reconcile automatically whichever lands
> first. **Review #101 there.** Ours is `src/providers/saludtools/`, one line in
> `src/providers/index.ts`, `assets/saludtools.svg`, the optional config field, the docs — and one line
> in `src/protocol/mcp-server.ts`.
>
> ### The protocol line, stated plainly
>
> It touches `src/protocol/`, against the golden rule. #101 added `identityPolicy` to `ToolDefinition`,
> forwarded it through `provider-factory` and `definePaginatedList`, and pinned it with tests that read
> `provider.listTools()` — the in-process object. **The wire mapping dropped it**, so every declaration
> was true and none of it left the building: exactly the failure #101's own commit message warns
> about. This is the other half of that PR, and it took the same exception #101 took for `src/core`,
> recorded in a commit rather than an ADR. A protocol test now asserts the wire shape over raw
> JSON-RPC — the SDK's typed client strips unknown fields, so a test written through it would report
> the field absent even once it is present.
>
> ### What the provider does
>
> Nine agent tools — patient lookup and registration, the agenda, a patient's appointments, booking and
> rescheduling, the catalogs — and four control-plane operations withdrawn from `tools/list`: the
> patient-list walk and the three destructive ones.
>
> Three decisions worth a reviewer's attention:
>
> - **We publish the agenda, never "availability".** SaludTools knows what is booked and nothing about
>   when the clinic is open or how long a consultation runs. Computing free slots would mean inventing
>   all of that inside a thin adapter and fixing a rule two clinics would answer differently and both
>   be right. The tenant's instructions hold the hours.
> - **That agenda read carries nobody.** Its projection drops every patient field, and also `comment`
>   and `appointmentType` — both free text whose own published examples contain a person's name. So
>   "when could I come in?" is not a read of other patients' records and needs no refusal in a patient
>   channel.
> - **A patient who does not exist is an answer, not an error.** `{found: false}`, so the agent offers
>   to register them instead of believing it made a bad call.
>
> ### Evidence
>
> The round-trip proof passes against **production**: `server/discover` → `tools/list` → `tools/call`
> with real calls, plus both forced auth-failure paths. Transcript and caveats in
> `docs/design/saludtools-provider/production-evidence.md`.
>
> **Zero patient records were read and nothing was written.** The key is a live clinic's with
> `role_admin` and #1055 is open, so verification stayed to a catalog, a paged catalog, an agenda
> window in 1990 and a lookup for a document nobody holds.
>
> The vendor's documentation contradicted production in **ten places, five of which would have shipped
> as defects** — a documented three-value enum the live catalog answers with twelve, a page-size
> ceiling nobody documents that broke every paginated call, a "not found" that arrives as a success
> with an empty body. The comparison table is in `grill-notes.md` §6. Do not design the next CareCloud
> integration from the portal alone.
>
> ### Not in this PR, and why
>
> Phases 3–4 (clinical reads and writes) are designed and unbuilt: their response shapes cannot be
> observed without reading real clinical records. Phase 5 (webhooks) waits on a payload nobody has
> seen. `tools.ts` says so where the next person will look.
>
> ### Verification
>
> 381 tests green · `tsc --noEmit` clean · Prettier clean · no credential in the diff.

---

## 2. xcale-backend — `feat/saludtools-connect` → `dev`

**Title:** `feat(saludtools): enroll SaludTools — catalog entry, pinned mint, and the identity chain`

**Body:**

> Epic: #1054 · Provider: matesjara/xcale-mcp-server `docs/saludtools-integration` · Blocked on #1055.
>
> The consumer half of the SaludTools integration. Small by design — the machinery was already generic.
>
> ### Read this first: what is in the diff that is not mine
>
> **This branch merges #1020** (the identity gate). SaludTools publishes an `identityPolicy` on every
> tool that reaches a patient and nothing in `dev` reads one, so shipping ahead of #1020 would mean
> declarations nobody enforces — and #1020 could not merge on our timetable. Merged rather than
> reimplemented, so the branches share ancestry. **Review #1020 there.**
>
> Ours is four files:
>
> - `src/modules/mcp/toolboxes.ts` — one catalog entry, deliberately **not** `featured`.
> - `src/modules/connections/credential-exchange-providers.ts` — the pinned mint descriptor. That file
>   said in its own header that the machinery was generic and waiting for a second
>   `credential_exchange` provider; this is it, and the prediction held.
> - `src/infrastructure/i18n/locales/{en,es}.json` — the credential-rejected message, naming the screen
>   where a clinic mints its own ApiKey.
> - two test blocks — the cross-repo policy pin and the 412 connect path.
>
> ### Two things the vendor's docs got wrong, and what each cost
>
> - **The mint returns `expires_in`**, not just `access_token`. The descriptor first shipped without it,
>   with a test pinning the absence and saying whoever added one would be changing a decision. A real
>   mint turned that test red. Worth noting the token lives ~6 days: re-minting on a 401 once a week
>   would have passed for working indefinitely.
> - **A wrong key answers 412, not the documented 500.** This needed no special handling, which is
>   stated in the file so nobody adds some: `mintToken` raises `CredentialExchangeError` for any
>   non-2xx and the connect path turns every one into the credential-rejected message. A test pins it,
>   because the day someone narrows that catch to 401/403 a wrong key starts reading as an outage and a
>   clinic waits for a recovery that is not coming.
>
> ### The cross-repo pin
>
> `mcp-tool-loader.test.ts` gains a block built from a real `tools/list` over raw JSON-RPC: every
> SaludTools tool that reaches a patient arrives `subject-bound` on the field that names them, the
> appointment read arrives `subject-scoped`, the agenda and catalogs arrive unmarked, and the four
> control-plane tools never register. Until yesterday the gateway published none of that and both
> repos' tests passed, because each asserted its own half.
>
> ### Why the catalog entry is not featured
>
> Nothing has ever called this provider on a patient's behalf. Listing it is what lets us connect the
> first clinic; promoting it beside the proven integrations would advertise a scheduling integration we
> have not seen schedule anything.
>
> ### Verification
>
> 412 tests green across mcp + connections + i18n (parity included) · `tsc` clean · changed-lines lint
> clean.

---

## Before opening either

- [ ] #1055 answered, or the PR says explicitly that merging is not enabling
- [ ] Re-run both suites against a freshly fetched `dev`
- [ ] If #101 or #1020 merged meanwhile, merge `dev` in first — the diff shrinks to ours and most of
      the "what is not mine" section can be deleted
- [ ] Confirm no `HANDOFF.md` is in either branch (working policy: none merges into `dev`)
