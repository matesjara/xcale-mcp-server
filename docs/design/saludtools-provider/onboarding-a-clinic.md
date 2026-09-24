# Onboarding a clinic on SaludTools

What has to be true before a clinic's agent can do anything useful. Written because **connecting is
not enough**: a clinic that pastes its ApiKey and configures nothing gets an agent that can read its
agenda and cannot book a single appointment.

Provider knowledge, so it lives here rather than in the backend (`xcale-mcp-server/CLAUDE.md`). The
tracker is [xcale-backend#1054](https://github.com/matesjara/xcale-backend/issues/1054).

---

## 1. The clinic generates its own ApiKey

Inside SaludTools: **Configuración › Integraciones › ApiKey › Crear ApiKey**.

- The **Key** starts with `STAKOA` and is 30 characters.
- The **Secret** is shown **once**. If they lose it they create another key.
- It is the clinic's key, revocable by them from the same screen. We are the integrator; we do not
  resell SaludTools access and we never hold a key of our own. (Same model HiMed's grill settled on
  2026-09-15.)

**Tell them what they are handing over.** SaludTools issues `role_admin` / `role_superadmin` and
offers **no read-only scope** — the credential can do anything their staff can. What keeps an agent
away from the destructive half is the gateway withdrawing those operations from the tool menu, not the
credential. A clinic is entitled to know that before it pastes.

The connect card says where to click and which value is shown once. If a clinic still gets it wrong,
the rejection message names the screen.

## 2. The clinic gives us its doctors' identity documents

**This is the one that blocks booking, and it is not optional.**

`create_appointment` takes `doctorDocumentType` + `doctorDocumentNumber`, and SaludTools refuses an
unknown one. **There is no doctor directory in the API** — no endpoint lists professionals, and the
only other place a doctor's document appears is on an appointment that already exists. So we cannot
discover them; the clinic has to tell us.

Per professional the agent may book with:

| What                   | Where it comes from                                               |
| ---------------------- | ----------------------------------------------------------------- |
| `doctorDocumentType`   | the `documentTypes` catalog (1 = cédula de ciudadanía)            |
| `doctorDocumentNumber` | the clinic                                                        |
| name, specialty        | the clinic — so the agent can talk about them, not just book them |

Put it in the tenant's agent instructions or knowledge base. It is configuration, not code: we do not
decide which doctors a clinic offers. Tracked as
[#1062](https://github.com/matesjara/xcale-backend/issues/1062).

**Check it the day they hire someone.** A doctor missing from the configuration is invisible to the
agent, and the failure looks like "the agent won't book with Dr. X" rather than like missing data.

## 3. The tenant configures when the clinic is open

SaludTools publishes **no availability endpoint**. It knows what is booked; it does not know opening
hours, consultation length, which doctors take new patients, or which days they work.

The provider gives the agent the booked agenda (`get_agenda`). Everything else is the tenant's:

- opening hours per site and per professional
- how long a consultation takes
- how far ahead bookings are accepted, and any cut-off
- what to do when nothing is free

That is deliberate. Two clinics would answer every one of those differently and both be right, so
they belong in that tenant's instructions, not in our code. **Say this in the demo**: it is the
difference between "it books" and "it knows when you are free", and it is better said early than
discovered on a call.

## 4. Which axis the agent runs

The agent's **vertical** must be `health`. A clinic left on `booking` binds nothing and fails closed —
deliberately, because the booking axis speaks of reservations and rooms.

If the tenant has only the SaludTools connection, the axis resolves on its own. Declare it explicitly
when the tenant also has a store or a property connected, or the resolver refuses to guess.

## 5. Webhooks — later, and by hand

SaludTools can push patient and scheduling events, but **only if a human configures it in the clinic's
own SaludTools UI**: Configuración › Integraciones › WebHooks, per event (Paciente / Agendamiento,
each with create / update / delete), choosing the HTTP method, the URL, and optional params and
headers. There is no API to register or list one.

Not part of onboarding yet — we have no receiver, because the payload has never been observed
([#1060](https://github.com/matesjara/xcale-backend/issues/1060)). Phases 1–4 are pull-only and work
without it. When it arrives, this becomes a twelve-step section.

## 6. Verify it actually works

After connecting, in this order. Each step tells you which of the above is missing:

1. **`get_catalog` → `clinics`.** Returns the clinic's sites. Empty or an auth error ⇒ the key is
   wrong or was revoked.
2. **`get_catalog` → `appointmentStates`.** Note which value means cancelled; the agent needs it,
   since cancelling is an update to that state and never a delete.
3. **`get_agenda`** over the next two weeks. **An empty agenda is a real answer and worth pausing
   on** — the clinic we tested against had zero appointments across three years, which means it does
   not use the scheduling module. If that is the case, the integration has nothing to work with and
   the conversation is a different one.
4. **`get_patient`** with a document the clinic gives you. `{found: false}` is an answer, not an
   error — it means that person is not registered, and the agent's next move is to offer to register
   them. Registering is safe to retry: SaludTools refuses a document it already holds, and the tool
   reports that as `{created: false, alreadyExists: true, patientId}` rather than as a failure, so a
   dropped connection cannot leave the clinic with two records for one person.
5. **Book one appointment end to end**, with a real doctor document from step 2 of this runbook, at a
   time the clinic is happy to have occupied — then cancel it by updating the state. This is the step
   that proves the configuration, and it is the only one that writes.

## What to promise, and what not to

| Yes                                                      | No                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recognize a patient by document, register a new one      | Tell a patient when the clinic is free, unless the hours are configured                                                                                                                     |
| Tell them their appointments                             | Reschedule in one step — it is a read plus a full update                                                                                                                                    |
| Book, move and cancel against the real agenda            | Anything clinical: history, prescriptions, results (built later, and gated on [#1055](https://github.com/matesjara/xcale-backend/issues/1055))                                              |
| Respect `habeasData`, the clinic's own record of consent | Discover doctors, or work without their documents                                                                                                                                           |
| Register a patient twice by accident — the API refuses   | **Record or change consent on a patient's behalf** — possible through `update_patient`, and pending the Ley 1581 decision ([#1055](https://github.com/matesjara/xcale-backend/issues/1055)) |
