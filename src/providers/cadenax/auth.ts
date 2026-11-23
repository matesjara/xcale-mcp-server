import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Cadenax authenticates an integration with one API key in the `X-API-Key` header (`cof_live_…`,
 * `cof_dev_…`). The key is a principal of its own (Cadenax ADR 0026): it carries a role, the offices
 * it reaches and a purpose (`agent` writes on behalf of a named person, `sync` never writes), all
 * resolved by Cadenax when the key authenticates. Nothing about that scope is declared here — this
 * server never narrows or widens what the key may do; Cadenax answers.
 *
 * A key is minted by a signed-in Cadenax administrator and never by another key, so there is no
 * exchange and no refresh: a dead key is replaced by pasting a new one.
 *
 * `forwarded`: a non-financial provider whose credential is scoped to one office (the standard risk
 * Toteat and Cloudbeds already run). The key travels in a header, never in a URL.
 */
export const cadenaxAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'X-API-Key', label: 'API key', placement: 'header' }],
};
