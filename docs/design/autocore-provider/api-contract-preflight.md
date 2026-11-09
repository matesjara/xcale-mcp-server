# Autocore Hotels — Contract preflight: `mcp_autocore_get_transaction_status`

> **Last updated**: 2026-11-09 · **Retires when** the tool enters [`api-contract.md`](./api-contract.md)
>
> The architecture of this tool is closed (feature design AD-6, grill D-10): one status read per link by its `code`,
> and, only when `applied`, the voucher for the amount and currency paid. What is missing is primary evidence of the
> paid path: Autocore's Staging checkout fails with "Pago fallido — Not found content type" before sending any
> payment (`sandbox-evidence.md` › Pagos), so no link has been paid. This file separates what is verified from what
> is not, and names the evidence that lifts the deferral. It does not restate the design.

## Verified wire facts (Staging, 2026-11-09)

| Fact                                                                                                                                                                                                                               | Evidence                                                   |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `GET /v2/common/transaction-status?hotel_id=<id>&ref_number=<code>&transaction_type=payment_link` with the link's `code` → `200`                                                                                                   | Link `vlxcvpqhcjc8`                                        |
| Our `external_ref_id` as `ref_number` → `404` `"Link de pago no identificado"`                                                                                                                                                     | Same link, `xcale-spike-001`                               |
| An unpaid link → `{ voucher_url: null, redirect_url: null, details: { type: "charge", id: <code>, external_ref_id, status_code: "pending", status_detail: "Pendiente", comments: "", transaction_id: "", transaction_date: "" } }` | Same link, before and after failed checkout attempts       |
| Without a transaction, `transaction_id` and `transaction_date` are empty strings, not `null`                                                                                                                                       | Same                                                       |
| The endpoint answers the same without `Auth-Token` (public)                                                                                                                                                                        | Same                                                       |
| A cancelled link → `status_code: "cancelled"`, `status_detail: "Cancelado"`, `transaction_id: ""`                                                                                                                                  | `gmoiew13h8zz`, after `DELETE /v2/bookings/chatbot/<code>` |
| A failed checkout attempt leaves the link `pending` with no transaction                                                                                                                                                            | `vlxcvpqhcjc8`, `uw1098c1q0vi`, `32h6qurm204j`             |

## Pending wire evidence

| #   | What                                                                                                                                                                                                                                  | Why the contract needs it                                                   |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------- |
| E-1 | The status of a paid link: `status_code` (`applied`?), `transaction_id`, `transaction_date` format, `voucher_url`                                                                                                                     | The tool's success shape and the trigger for the voucher read               |
| E-2 | `GET /v2/transactions/vouchers/detail?…` for that payment: which query parameter takes the status's `transaction_id` (the docs show `transaction_id=` and `internal_id=` + `operation_type=`), and the `amount` and `currency` fields | The amount the consumer settles against (`mismatch`)                        |
| E-3 | A declined payment: `status_code` (`rejected` or `invalid_card`) and whether it carries a `transaction_id`                                                                                                                            | The declined outcome                                                        |
| E-4 | The pending test cards: `in_process` and its final state                                                                                                                                                                              | The intermediate outcome                                                    |
| E-5 | Paying the same link a second time after an approved payment, and cancelling a paid link (`DELETE /v2/bookings/chatbot/<code>`)                                                                                                       | P-1: whether the consumer must expect two payments on one link              |
| E-6 | One webhook delivery to a URL we control (a dev tunnel), its body and headers                                                                                                                                                         | The consumer's webhook ingress and the confirmation it makes with this tool |

## What lifts the deferral

Autocore fixes the Staging checkout for hotel 5. Then, with the Staging keys in Doppler (`xcale` / `dev_sara`): pay
one link with each of the four Autocore test cards (by hand, in a browser), pay the approved one again, point one
link's `temp_webhook_url` at a dev tunnel, and record every response in `sandbox-evidence.md`. The tool enters
`api-contract.md` with only those observed values, and this file is deleted in the same commit.
