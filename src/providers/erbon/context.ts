import { z } from 'zod';

/**
 * Erbon call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * **`hotelID` is the account identity, not the credential.** One Erbon credential is account-scoped
 * (the mint JWT carries an account GUID + role, NOT a hotel — Observed, `sandbox-evidence.md` §1), and
 * every data endpoint is `/hotel/{hotelID}/…`. So the hotel is named per call, exactly like Cloudbeds
 * `propertyID`. A consumer keys its connection on `hotelID`; the same credential + a different
 * `hotelID` is a different connection, not a duplicate.
 *
 * It is a string on the wire even though it is a GUID — kept opaque; the core never interprets it.
 */
export const erbonContext = z.object({ hotelID: z.string().min(1) }).strict();

export type ErbonContext = z.infer<typeof erbonContext>;
