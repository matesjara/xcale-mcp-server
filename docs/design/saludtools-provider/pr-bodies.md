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
> already proved, and it lands **entirely inside the `add-provider` golden rule** — no exception.
>
> ### The scope, and the exception that went away
>
> Ours is `src/providers/saludtools/`, one line in `src/providers/index.ts`,
> `assets/saludtools.svg`, the optional config field and the docs. **Nothing in `src/core`,
> `src/protocol` or `src/auth`.**
>
> An earlier version of this branch did touch `src/protocol/mcp-server.ts`. #101 had added
> `identityPolicy` to `ToolDefinition` and pinned it with tests that read `provider.listTools()` — the
> in-process object — while the wire mapping dropped it, so every declaration was true and none of it
> left the building. A PHI provider's round-trip proof is what noticed, and this branch carried the
> one-line fix.
>
> **That is now `dev`'s, and better.** #101 merged with ADR 0019: the policy travels in `_meta`, a
> field the MCP spec names, so the SDK's own typed client preserves it instead of stripping it. On
> merging `dev` the line was dropped in favour of that, and the raw-JSON-RPC test written to work
> around the SDK's stripping was deleted — `dev` covers the same ground with four tests through the
> ordinary client. The provider needed no change: it declares `identityPolicy` and the new mapping
> publishes it.
>
> ### What the provider does
>
> **Nine agent tools** — patient lookup and registration, the agenda, a patient's appointments, booking
> and rescheduling, the catalogs — and **thirty-one control-plane operations withdrawn from
> `tools/list`**: the patient-list walk, the three destructive ones, and the twenty-seven clinical
> tools of phases 3 and 4 (fifteen reads, twelve writes).
>
> **The whole SaludTools API is covered**, which was this integration's definition of done: every
> `eventType` and every parametric catalog has a home here, as an agent tool or as a control-plane
> operation the consumer drives and the agent never sees.
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
> ### The clinical phases are built AND invisible — read this before approving
>
> Twenty-seven clinical tools ship in this PR and **not one of them is on the agent's menu.** The
> published surface is still the nine above, and the test suite asserts it as a **closed list**, so any
> tool that becomes agent-visible — including one written later without the flag — turns the suite red.
>
> - **Phase 3, the clinical reads: withdrawn TEMPORARILY.** The rule they were waiting on was my own
>   ("#1055 is answered before phase 3 is _written_"), and its purpose was that no clinical PHI reaches
>   a model before a human decided it may. Withdrawal serves that purpose exactly, while "do not write
>   it" only delays the work. When #1055 answers, exposing a tool is deleting one line. Decision D10.
> - **Phase 4, the clinical writes: withdrawn PERMANENTLY** (D5). Prescribing, recording a diagnosis or
>   filing a disability certificate is not an agent's move under any tenant's rules. They exist so the
>   provider is completely covered and a consumer can drive a sync.
> - **No clinical write has ever been executed, against any environment.** Nine of the ten surfaces
>   have no delete, so the phase cannot be exercised against a clinic that treats real patients
>   (#1057). Their schemas are _Documented_, never _Observed_, and the code says so.
>
> Two asymmetries a reviewer should check on purpose, because they look like inconsistencies and are
> not:
>
> - **Outputs are strict allow-lists; inputs are deliberately loose.** A projection's failure mode is
>   omission, which is what makes an allow-list safe against documentation that has been wrong seven
>   times. On the way in there is no leak to prevent, and a schema stricter than the provider rejects a
>   clinical record the clinic was entitled to file — with our error instead of theirs.
> - **`documentType` and `patientDocumentType` are both used, per surface, and never unified.** Six
>   surfaces name it one way and four the other. A helper that normalised them would hide the exact
>   difference that made three surfaces look unreachable for a week.
>
> ### Not in this PR, and why
>
> - **`CLINIC_HISTORY`'s read.** Its response nests ~80 vital-sign fields; a hand-transcribed allow-list
>   of eighty names is a list with a typo in it. It is also unreachable from a patient document, so no
>   agent path to it exists regardless.
> - **Phase 5, the webhooks.** Confirmed blocked by reading the vendor's page, not assumed: twelve UI
>   steps and zero words about the payload. Only an observed delivery unblocks it (#1060).
> - **The booking write is unproven.** Not for lack of permission or effort — the clinic has no
>   appointments across three years and the API publishes no doctor directory, so there is no doctor
>   document to book with (#1062).
>
> ### Verification
>
> 567 tests green across the whole repo (the branch is merged up to date with `dev`) · `tsc --noEmit` clean · Prettier clean · no credential in the diff.

---

## 2. xcale-backend — `feat/saludtools-connect` → `dev` — **MERGED as #1020**

> Kept for the record: this is the body it shipped with. The frontend half merged as
> xcale-frontend#161. Only the mcp-server PR above is still to open.

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
