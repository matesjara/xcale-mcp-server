# Siigo — Pre-Sandbox Fact Discovery & Verification Checklist

> **Template candidate (extract at N=2).** This artifact's *process* — the confidence tiers, source
> precedence, per-datum promotion, and evidence citation — is Siigo-specific for now. When the second
> provider (ePayco) exercises it, extract the reusable parts into a shared verification template/reference,
> using two real cases to tell the universal parts from Siigo's particularities. Until then it stays here,
> **not** a cross-cutting standard. The *principle* it embodies — a contract carries only Observed facts —
> is already promoted to the `api-contract-authoring` skill (both repos).

> **Purpose.** Reduce the uncertainty space *before* touching the sandbox by extracting hypotheses from
> official docs and SDKs, then arrive at the sandbox with a **minimal confirmation checklist**. This is
> **not** the API contract. Nothing here is authoritative for implementation.
>
> **Confidence discipline (binding).** Every datum is tagged. Only **Observed** data may enter
> `api-contract.md`.
>
> | State | Meaning | May enter the API contract |
> |:--|:--|:--:|
> | **Observed** | Verified by a real sandbox/test-env call | ✅ Yes |
> | **SDK-confirmed** | Present in the provider's own maintained SDK, but not exercised by us | ❌ No (strong hypothesis) |
> | **Officially documented** | In official docs, but not exercised | ❌ No (hypothesis) |
> | **Inferred** | Deduced from examples or behavior | ❌ No (weak hypothesis) |
>
> **Source precedence (for conflicts).** When sources disagree and the datum is **not yet Observed**,
> prefer the higher tier as the *leading hypothesis to test first*:
> `Observed > SDK-confirmed > Officially documented > Examples > Inferred`. **Observed always supersedes
> every other tier** — the actual system behavior wins, even over the provider's own docs (which is how
> we caught `/auth` vs `/sign-in`). No one decides "by feel" which source to believe.
>
> **Promotion is per-datum, not per-question.** Each *field* the contract will carry (URL, auth path,
> each body key, token field, expiry field, TTL, each pagination param, each error code) is promoted
> **independently**. A question is not "done" while any of its sub-data is still a hypothesis — e.g.
> Q-1 alone has ≥4 independent data (body keys, token field, expiry field, TTL), and `expires_in` can
> lag even when the auth path is Observed. The unit of validation is the datum, not the question.
>
> **Evidence citation (auditability).** Every Observed value must cite the exact evidence that produced
> it — the request/response capture or test-run log — so months later the contract can answer *"where
> was this observed?"* even if Siigo changes. An Observed value with no citable evidence is not Observed.

---

## 0. The core ambiguity — two API "flavors"

Siigo exposes (at least) two surfaces that differ in base URL, auth path, and field casing. xcale must
confirm **which one it is provisioned for** — this decides Q-1 and Q-2 together.

| | **Flavor A — Public API** | **Flavor B — Alliance/Partner API** |
|:--|:--|:--|
| Base URL | `https://api.siigo.com` | `https://services.siigo.com/alliances/api` |
| Auth path | `POST /auth` | `POST /siigoapi-users/v1/sign-in` |
| Body field casing | `username`, `access_key` (snake) | `userName`, `accessKey` (camel) |
| Source | apiary / developers.siigo.com | official SiigoSAS JS SDK README |
| Confidence | Officially documented | **SDK-confirmed** (higher — see precedence) |

**Working hypothesis (to confirm, not freeze):** xcale is a **Partner/Alliance** integrator (it is
assigned a `Partner-Id`), which *leans* toward Flavor B. **But** the public portal also documents
`Partner-Id` as required, so the header alone does **not** disambiguate. → **Sandbox decides.**

---

## 1. Per-question findings & promotion test

### Q-1 — Auth body field names + token response

- **Hypothesis (Officially documented / Inferred):** Flavor B → `{ "userName": "...", "accessKey": "..." }`; response is a Bearer JWT (fields likely `access_token` / `expires_in`, unconfirmed).
- **Competing (Officially documented):** Flavor A → `{ "username": "...", "access_key": "..." }`.
- **Promote to Observed when:** a real `sign-in`/`auth` call returns a usable JWT; record the **exact accepted body keys** and the **exact response keys** (token field + expiry field + TTL).

### Q-2 — Base URL + auth endpoint path

- **Hypothesis (Officially documented, SDK):** base `https://services.siigo.com/alliances/api`, auth `POST /siigoapi-users/v1/sign-in`.
- **Competing:** base `https://api.siigo.com`, auth `POST /auth`.
- **Promote to Observed when:** a **successful live call** confirms which base + auth path xcale's credentials work against (not which page documents it). Data reads must succeed against the **same** base.

### Q-3 — `Partner-Id`

- **Officially documented:** required header on **all** requests; value = xcale's integrator app name, **3–100 alphanumerics, camelCase** (e.g. `xcaleContabilidad`); non-secret institutional identifier.
- **Unknown:** the actual value assigned to xcale (administrative).
- **Promote to Observed when:** Siigo assigns/authorizes xcale's `Partner-Id` **and** it is verified working on **both** the auth call **and** a data endpoint.

### Q-4 — Pagination + rate limits

- **Inferred:** responses are paginated (`GenericPageListModel` / `PageListModel` in the SDK); param names likely `page` / `page_size` (or `pageSize`) — **not confirmed**.
- **Unknown:** rate limits (requests/sec or /min, 429 behavior) — **not found in official docs**.
- **Promote to Observed when:** real paginated calls (>1 page) reveal the actual request param names and the response envelope (page/size/total/links fields); and observed rate-limit behavior (headers, 429s) or its documented absence.

### Read resource paths (for the tool set)

- **Officially documented (SDK):** `GET /v1/customers`, `GET /v1/invoices`, `GET /v1/products` (paginated). Single-item GET-by-id paths and reference-data paths (`/v1/account-groups`, `/v1/taxes`, `/v1/document-types`) to be confirmed alongside Q-4.

### Functional surface from official docs (hypothesis-grade — [developers.siigo.com](https://developers.siigo.com/docs/siigoapi/))

Extracted to prepare B3 and seed the traceability matrix. **None of this is Observed; none enters the
contract until B1.**

- **Resources documented (Officially documented):** `products`, `customers`, `invoices` (sales),
  `purchases`, `credit-notes`, `vouchers` (cash receipts), `payment-receipts`, `journals`,
  `quotations`, `purchase-support-documents`. **Our read-first scope stays: customers, invoices,
  products.**
- **Pagination (Officially documented / SDK):** request query `page` + `page_size`; response envelope
  `{ pagination: { page, page_size, total_results }, results: [ … ] }`. → our uniform `page`/`pageSize`
  maps to `page`/`page_size`; the list unwrap reads `results` + `pagination.total_results`. **Confirm in B1.**
- **Per-endpoint pages exist** (e.g. `…/invoice/3-get-invoices`, `…/customer/…`, `…/productos/consultar-producto`)
  with request/response examples, but are JS-rendered (not machine-extractable) — the shapes are
  Observed from real captures in B1, not scraped.

### New questions for the sandbox (do not resolve by assumption)

| # | Question | Confidence now |
|:--|:--|:--|
| Q-6 | Exact **error envelope** shape (a "Manejo de errores" section + a `Detail` field are documented; the JSON structure — `Errors[]`? `code`/`message`/`detail`? — is unconfirmed). | Inferred |
| Q-7 | The **GET-by-id path** for customers/invoices/products (does `get_*` exist as a dedicated endpoint, and what shape). | Inferred |
| Q-8 | Whether the **list response** is uniform across customers/invoices/products (same `pagination`/`results` envelope). | Officially documented (assumed uniform) |
| Q-9 | **Company/NIT cardinality (blocks the `contextSchema` decision — Feature Design AD-7).** Does one Siigo access key authenticate to **exactly one** company/NIT, or does `/auth` **enumerate** companies, or does any data endpoint **accept or require** a `companyId`/NIT selector? **Falsifier:** if a single key reaches multiple NITs or any endpoint takes a company selector, Siigo is **Cloudbeds-shaped** and needs a company-key `contextSchema` + `accountContextKeys` (like `propertyID`), **not** the current no-`contextSchema` shape. On a fiscal provider a cross-company answer is a real leak, so this must be **Observed**, not assumed. | Hypothesis (assumed 1→1, **unverified**) |

---

## 2. Minimal sandbox checklist (ordered)

Run in this order; fill the **Observed** column and only then feed `api-contract.md`.

| # | Step | What to record | Observed |
|:--|:--|:--|:--:|
| 1 | Obtain sandbox/test credentials + confirm xcale's assigned `Partner-Id` | the `Partner-Id` value | ⬜ |
| 2 | Auth call (try Flavor B first per hypothesis; fall back to A) | winning base URL + auth path + **exact accepted body keys** | ⬜ |
| 3 | Read the auth response | token field name, expiry field name, **actual TTL** | ⬜ |
| 4 | `GET` customers with the token + `Partner-Id` | that reads work against the **same base**; response envelope shape | ⬜ |
| 5 | Page through customers (>1 page) | **exact pagination param names** + response page/size/total fields | ⬜ |
| 6 | `GET` a single customer/invoice/product by id | the by-id path shape | ⬜ |
| 7 | Trigger/observe error paths (bad token; if feasible, burst for 429) | provider error body shape + status codes + any rate-limit headers | ⬜ |
| 8 | **Company/NIT cardinality (Q-9):** check the `/auth` response for a single vs list company context; make one data call and check for a `companyId`/NIT param; if possible, test whether one key returns records spanning **>1 NIT** | single-vs-multi-company evidence (live capture — same bar as Q-1..Q-4) | ⬜ |

> **Correction 2026-08-12 (drift grill):** added the company/NIT cardinality question + checklist step 8
> to stop `contextSchema` being asserted-settled while every sibling fact is still B1-pending (Feature
> Design **AD-7** downgraded to hypothesis; traceability-matrix gains a cardinality row). Numbered **Q-9**
> — the drift-grill instruction named it "Q-6", but `Q-6`/`Q-7`/`Q-8` were already assigned here (error
> envelope / GET-by-id / list uniformity) and are referenced from `handoff-2026-07-09.md`, so the new
> question takes the next free number to avoid a collision. Evidence bar = **Observed** (live capture),
> identical to Q-1..Q-4.

**Exit criterion:** every datum Observed **and** each Observed value citing its exact evidence
(request/response capture or test-run log) → the four questions are frozen → `api-contract.md` may be
authored (descriptive, not speculative, auditable).

---

## 3. Sources (all pre-sandbox — hypothesis-grade)

- Official SiigoSAS JS SDK — https://github.com/SiigoSAS/siigo_sdk_javascript (Flavor B base/auth/fields)
- Siigo API reference (apiary) — https://siigoapi.docs.apiary.io/ (Flavor A; JS-rendered, not machine-extractable)
- Siigo developer portal — https://developers.siigo.com/
- Siigo Nube portal — Partner-Id requirement & format; API-credential generation (`Partnerships → My API Credential`)
- Community PHP SDK — https://github.com/saulmoralespa/siigo-api-php (auth via `userName`+`accessKey`, `getAccessToken()`)
