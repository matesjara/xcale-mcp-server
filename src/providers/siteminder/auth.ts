import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * The Direct Booking API authenticates with one header, `x-sm-api-key`, on every request. SiteMinder:
 * the key "must never be exposed in query parameters or client-side"; keys do not expire and are
 * revoked by hand ("Revoke Access"), after which the property generates a new one.
 *
 * `forwarded`: the API is read-only — property facts, rates and prices a guest would see on the
 * hotel's own website. Nothing here moves money or holds personal data (ADR 0003 › Constraint).
 */
export const siteminderAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'x-sm-api-key', label: 'Direct Booking API key', placement: 'header' }],
};
