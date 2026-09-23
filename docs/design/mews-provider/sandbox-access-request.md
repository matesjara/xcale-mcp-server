# Demo access request — Mews Connector API

Draft for epic [xcale-backend#1043](https://github.com/matesjara/xcale-backend/issues/1043). **Not sent.**
Review it, fill in the sender's name and company details, then send.

## Why ask when a public demo already works

Mews publishes a public demo enterprise and its tokens (`docs.mews.com/connector-api/guidelines/environments`).
We used them for read-only probes on 2026-09-23, and every call answered (configuration, services,
categories, availability, rates, pricing, age categories). The public demo has three limits, and each one
blocks work we still need to do:

1. **It is shared.** Every partner in the world uses the same `AccessToken`, and its budget is
   200 requests per 30 s. On 2026-09-23 we got `429 Too many requests` on our third call, because of
   other partners' traffic. An automated suite cannot run against a budget other people are spending.
2. **It is written to by everyone.** It has 36 bookable services and dozens of test categories and rates
   left by other partners, so a fixture recorded there is noise, not a hotel.
3. **We have no `ClientToken` of our own.** The `ClientToken` identifies the integration to Mews. Mews
   issues it through the partner programme, and certification and the production tokens are issued against
   that same identity.

## Where to send it

| Step | Where                                                             | Source                                |
| ---- | ----------------------------------------------------------------- | ------------------------------------- |
| 1    | Partner form: `https://www.mews.com/en/partners/new-partnerships` | Mews docs, _Your integration journey_ |
| 2    | Email: `partnersuccess@mews.com`                                  | same page — partner success team      |

**Fill in the form first.** It is the documented entry point: it creates the partner record, and the demo
access comes from it as a password-reset email for `app.mews-demo.com`. The email below goes to partner
success **after** the form, so the request carries a partner record and does not sit unanswered in a
general inbox.

**Form fields to have ready:**

- Company: xcale (legal entity: Nevatal S.A.S., Colombia)
- Website: `https://xcale.app`
- Integration type: guest messaging / booking engine (AI agent on WhatsApp that quotes and books)
- Markets: Colombia and LATAM
- Contact: the sender's work email

## Subject

> Demo property and ClientToken request — xcale (WhatsApp AI booking agent), Connector API integration

## Body

The body is in **English**: Mews is a European company and its partner team works in English.

Hello Mews Partner Success team,

I'm writing from **xcale**, a platform of AI agents that answer hotel guests on WhatsApp. The agent sees a
property's real availability and rates, quotes a stay, and books it straight into the hotel's PMS. We
serve hotels in Colombia and across Latin America, and we already run in production against another PMS.

We have just submitted the new-partnership form, and we are building our Mews integration on the
Connector API. We have already verified the read path against the public demo enterprise, "API Hotel Gross
Pricing": `configuration/get`, `services/getAll`, `resourceCategories/getAll`,
`services/getAvailability/2024-01-22`, `rates/getAll`, `rates/getPricing`, `reservations/price` and
`ageCategories/getAll`.

To finish the integration and prepare for certification, we would like to request:

1. **Our own `ClientToken`** for the demo environment, under the name `xcale`.
2. **A dedicated demo property** (one enterprise with an accommodation service, a few resource categories,
   a public rate and adult and child age categories) with its `AccessToken`, plus a user for
   `app.mews-demo.com`.

We need them for three things:

- **An automated test suite.** The public demo token is shared, and we already hit `429` on it from other
  partners' traffic, so we cannot run repeatable tests there.
- **The write path.** We want to exercise `customers/add`, `reservations/add` and `reservations/cancel`
  without touching data other partners depend on.
- **Certification.** We would like to learn early which operations and flows you expect us to cover for
  our use case (a guest-facing booking agent), so we build for them from the start.

Some context that may help place the request:

- **Each hotel owns its connection.** The hotel authorizes the integration and holds its `AccessToken`. We
  store it encrypted, per hotel, and use it only for that hotel's guests.
- **Our write scope is small.** Our agent creates customers and reservations, and cancels reservations
  when a guest asks. It does not touch billing, payments, housekeeping or configuration.
- **We follow your rate-limit guidance:** `Retry-After` on `429`, exponential backoff and paginated reads.

If there is a better route for this (a specific programme, a call, or an agreement to sign first), please
point us to it and we will follow it. We are happy to provide any further company details you need.

Thank you,

**[Name]**
xcale — [role]
[email] · [phone]
