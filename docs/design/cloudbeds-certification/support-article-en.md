# How to connect xcale with Cloudbeds

> **Publishing note (delete this block before publishing).**
> This is the support article Cloudbeds requires before certification. It must be **publicly
> hosted** on our own site or help center, **in English**, and it must cover the six sections
> below. Two things are still missing and only a human can supply them:
>
> 1. **Screenshots.** Every `[SCREENSHOT: …]` marker says exactly what to capture. Cloudbeds
>    explicitly asks for screenshots demonstrating the functionality.
> 2. **The support contact.** This draft uses `support@xcale.app`. Confirm the address actually
>    exists and is monitored before publishing — Cloudbeds' live SLA is same-working-day for urgent
>    issues and 24 hours for onboarding questions, and this is the address they will use.
>
> Optional but recommended by Cloudbeds: a 2–3 minute walkthrough video, and an FAQ section.
> Reference structure: the Sponteous article they link from the integration guide.

xcale is an AI assistant that talks to your guests on WhatsApp. Connected to Cloudbeds, it answers
availability questions, quotes real rates, creates and modifies reservations, keeps guest records up
to date, and sends payment links — all in the conversation, in your guest's language, around the
clock.

This article explains how to sign up, connect your Cloudbeds property, what the integration does, and
how to disconnect it.

---

## 1. Before you start

You will need:

- A Cloudbeds account with permission to install apps on the property (a property administrator).
  Users without that permission will not see the authorization screen.
- An xcale account (see below).
- A WhatsApp number for your property, connected in xcale. The Cloudbeds integration works without
  it, but your guests reach the assistant through WhatsApp, so this is what makes it useful.

---

## 2. Create your xcale account

1. Go to **https://xcale.app** and select **Sign up**.
2. Enter your name, work email and a password, then confirm your email address.
3. Complete the short onboarding: tell us about your property and pick a plan.

[SCREENSHOT: the xcale sign-up screen.]

---

## 3. Connect Cloudbeds

1. In the xcale dashboard, open **Tools & Integrations** from the left sidebar.
2. Find **Cloudbeds** — it is listed under the **Booking** category, in **Available to Connect**.
3. Select **Connect**. You will be redirected to Cloudbeds.
4. Sign in to Cloudbeds if you are not already signed in, choose the property you want to connect,
   and review the permissions xcale is asking for.
5. Select **Allow**. Cloudbeds returns you to xcale, and Cloudbeds appears in the **Connected**
   section.

That is the whole connection. There is nothing to copy, paste or configure by hand: xcale receives
the authorization from Cloudbeds, identifies your property automatically, and subscribes to the
property events it needs.

[SCREENSHOT: the Tools & Integrations page with the Cloudbeds card.]
[SCREENSHOT: the Cloudbeds authorization screen showing the requested permissions.]
[SCREENSHOT: the Cloudbeds card in the Connected section after a successful connection.]

**Multiple properties.** Connect them one at a time: select **Add another account** on the Cloudbeds
card and repeat the flow for the next property.

**Link the integration to your assistant.** Open your agent's configuration and, under
**Integrations**, select the Cloudbeds account it should use. An assistant that is not linked to an
account has no access to your property's data.

[SCREENSHOT: the agent configuration showing the Cloudbeds account selected.]

---

## 4. What the integration does

Once connected, your assistant can do the following on your property, on your behalf.

**Availability and rates**
- Check availability for a date range and party size.
- Read your rate plans and quote real prices, including taxes and fees as your property has them
  configured.

**Reservations**
- Create a reservation from the conversation.
- Look up an existing reservation and answer questions about it.
- Modify dates or details, and cancel when the guest asks.
- Add notes to a reservation so your front desk sees the context of the conversation.

**Guests**
- Find a guest record, keep contact details current, and assign a guest to a room.
- Add guest notes — preferences, requests, anything the conversation revealed.

**Groups and blocks**
- Read group bookings and their notes, and keep them updated.
- Read and manage room blocks and allotment blocks.

**Payments**
- Send a Cloudbeds Payments pay-by-link so the guest can pay from the chat, and check whether that
  link has been paid.
  *Requires Cloudbeds Payments with pay-by-link enabled on the property.*

**Staying in sync**
- xcale subscribes to your property's reservation events. When a booking changes outside the
  conversation — a cancellation at the front desk, for example — your guest is told, without anyone
  having to remember to write.

[SCREENSHOT: a WhatsApp conversation where the assistant quotes availability and confirms a booking.]

**What xcale never does:** it does not read or write your financial adjustments, and it does not send
email on your property's behalf. We only ask Cloudbeds for the permissions the features above
actually use.

---

## 5. How to disconnect

You can disconnect from either side. Both work, and both are permanent until you connect again.

### From xcale

1. Open **Tools & Integrations**.
2. On the **Cloudbeds** card, select **Disconnect**, and confirm.

### From Cloudbeds

Follow Cloudbeds' own instructions:
[Disconnect an app from myfrontdesk](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/219774407-Disconnect-an-app-from-myfrontdesk).

[SCREENSHOT: the disconnect confirmation dialog in xcale.]

---

## 6. What disconnecting does, on our side

We think you should know exactly what happens, in both directions.

**When you disconnect in xcale**, we immediately:

- stop every tool that uses Cloudbeds — your assistant can no longer read or write anything on the
  property, from that moment on;
- remove the event subscriptions we created on your property, so Cloudbeds stops sending us your
  data; and
- tell Cloudbeds the app is disabled, so xcale is removed from your property's **Manage Apps** list.
  You do not have to disconnect a second time on the Cloudbeds side.

**When you disconnect in Cloudbeds**, Cloudbeds notifies us and revokes our access. We verify the
change directly with Cloudbeds and then end every session for that property on our side. The
integration then shows in xcale as needing to be reconnected, so nothing is lost if you connect
again later.

**Your conversations stay yours.** Disconnecting stops the access; it does not delete the WhatsApp
conversation history stored in your xcale account. To have that data deleted as well, write to us at
the address below.

---

## 7. Limitations

- **One property per connection.** A Cloudbeds authorization is scoped to one property. For several
  properties, connect each one — the assistant works with the property it is linked to.
- **Payments.** Pay-by-link requires Cloudbeds Payments with pay-by-link enabled on the property.
  Refunds are handled in Cloudbeds, not through xcale.
- **Permissions.** If your property later restricts a permission, the features that depend on it stop
  working and xcale will ask you to reconnect.

---

## 8. Support

- **Email:** support@xcale.app
- **Response times:** urgent issues affecting a live property, the same working day. Onboarding and
  general questions, within 24 hours.
- If you are reporting a problem with the integration, tell us your property name and roughly when it
  happened — that is enough for us to find it.
