# Cloudbeds marketing submission — copy and asset checklist

Everything the Cloudbeds **Partner Marketing** Google Form asks for, drafted. Two things this
document cannot produce and a human must: the **images** and the **walkthrough video**.

Submit at: the Google Form linked from Cloudbeds' integration guide ("Submit your Marketing Material
Here"). It is a **separate submission** from the App Details page inside the Cloudbeds portal — one
does not cover the other.

---

## 1. App Details page (inside the Cloudbeds portal)

**App name:** xcale

**Category:** Guest Experience & Communication

**App summary** *(one line; Cloudbeds asks not to repeat the app name or the category)*

> Your guests book, ask and pay over WhatsApp — an AI assistant answers in seconds, in their
> language, with your real availability and rates.

**Feature bullets** *(user benefits, not technical features)*

- Answer every WhatsApp enquiry in seconds, day or night, without adding a night shift.
- Quote real availability and rates from your property — never a stale price.
- Turn a conversation into a confirmed reservation, with the payment link in the same chat.
- Keep guest records and reservation notes current without anyone retyping them.
- Serve guests in their own language, whoever writes.
- Tell guests when something changes — a cancellation at the front desk reaches them without a
  reminder to write.

**App description**

> Most enquiries arrive on WhatsApp, and most of them arrive when nobody is at the desk. xcale puts
> an AI assistant on your property's WhatsApp number: it reads your Cloudbeds availability and rate
> plans, answers what the guest actually asked, quotes a real price, creates the reservation, and
> sends a Cloudbeds Payments link so the guest can pay without leaving the chat. Everything it does
> lands in Cloudbeds — reservations, guest details, notes — so your front desk keeps working exactly
> as it does today, with the conversation already handled. Setup takes minutes: connect Cloudbeds,
> link your WhatsApp number, and the assistant is live.

**Languages supported:** English, Español

**Permission scopes:** the 22 the integration actually calls (17 read + 5 write). Trim the selection
to these before certification — Cloudbeds verifies that only required scopes are selected.

---

## 2. Landing page (partner-hosted, with lead capture)

Required by the marketing form: a page on our own site about the Cloudbeds integration, with a form
that captures leads. A ready-to-publish, self-contained page is in `landing-cloudbeds.html` next to
this file — it needs two things before it goes live:

1. **A form endpoint.** The form posts to a placeholder. Either point it at a form service or at an
   endpoint of ours; do not ship it pointing nowhere.
2. **A home.** The marketing site (xcale.app) is not in these repositories, so publishing is not
   something we can do from here. Suggested URL: `https://xcale.app/integrations/cloudbeds`.

### Copy — English

**Hero**
- Title: **Your Cloudbeds property, now answering on WhatsApp**
- Subtitle: xcale connects to Cloudbeds and turns guest messages into confirmed, paid reservations —
  automatically, at any hour, in your guest's language.
- Call to action: Request a demo

**How it works**
1. **Connect Cloudbeds.** One authorization, no configuration. xcale finds your property and its
   rates by itself.
2. **Link your WhatsApp number.** The number your guests already write to.
3. **Let it answer.** Availability, quotes, bookings, changes and payment links — in the
   conversation.

**What it does with your property**
- Real availability and real rates, read from Cloudbeds at the moment the guest asks.
- Reservations created, modified and cancelled directly in your PMS.
- Guest records and reservation notes kept up to date, so the front desk sees the context.
- Cloudbeds Payments pay-by-link sent in the chat.
- Out-of-band changes narrated to the guest — nobody has to remember to write.

**Closing**
- Title: See it on your own property
- Body: Tell us your property and we will show you the assistant answering with your real
  availability.

### Copy — Español

**Hero**
- Título: **Tu propiedad de Cloudbeds, respondiendo por WhatsApp**
- Subtítulo: xcale se conecta a Cloudbeds y convierte los mensajes de tus huéspedes en reservas
  confirmadas y pagadas — automáticamente, a cualquier hora y en el idioma del huésped.
- Llamada a la acción: Solicitar una demo

**Cómo funciona**
1. **Conecta Cloudbeds.** Una autorización, cero configuración. xcale reconoce tu propiedad y tus
   tarifas solo.
2. **Enlaza tu número de WhatsApp.** El mismo al que ya te escriben.
3. **Deja que responda.** Disponibilidad, cotizaciones, reservas, cambios y links de pago — dentro de
   la conversación.

**Qué hace con tu propiedad**
- Disponibilidad y tarifas reales, leídas de Cloudbeds en el momento en que el huésped pregunta.
- Reservas creadas, modificadas y canceladas directamente en tu PMS.
- Fichas de huésped y notas de reserva al día, para que la recepción vea el contexto.
- Link de pago de Cloudbeds Payments enviado en el chat.
- Los cambios que ocurren fuera de la conversación se le avisan al huésped, sin que nadie tenga que
  acordarse.

**Cierre**
- Título: Míralo con tu propia propiedad
- Cuerpo: Cuéntanos cuál es tu hotel y te mostramos al asistente respondiendo con tu disponibilidad
  real.

---

## 3. Assets still to produce (human)

| Asset | Requirement | Status |
|---|---|---|
| App icon | Per Cloudbeds' spec on the App Details page | Uploaded by Mateo — confirm it meets the spec |
| Directory / featured images | High quality | Uploaded by Mateo — confirm |
| Screenshots | Must demonstrate usability | **Missing** — see the list below |
| Walkthrough video | 2–3 min, hosted on YouTube / Vimeo / Wistia | **Missing** |
| Marketing page link | Our site | Have it |
| Landing page with lead capture | Partner-hosted | Draft ready, needs publishing |
| Pricing | Optional | Decide whether to include |

**Screenshots worth capturing** (they double as the support article's images):
1. Tools & Integrations page with the Cloudbeds card.
2. The Cloudbeds authorization screen with the requested permissions.
3. Cloudbeds connected, in the Connected section.
4. The agent configuration with the Cloudbeds account linked.
5. A WhatsApp conversation: guest asks → assistant quotes → booking confirmed.
6. A WhatsApp conversation with a payment link.

**Video outline** (2–3 minutes): connect Cloudbeds (30s) → link WhatsApp (20s) → a real conversation
that ends in a booking (60s) → the reservation appearing in Cloudbeds (20s) → disconnect (15s).
That last beat matters more than it looks: certification asks us to show disconnection, and having it
on video means the reviewer has seen it work before the call.
