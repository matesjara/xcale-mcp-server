import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Toteat authenticates with four **query-string** parameters — there is no header auth and no OAuth.
 * Only ONE of them is a secret:
 *
 *   xapitoken  the API token                      → the credential (this descriptor)
 *   xir        restaurant id                      → call context (see `context.ts`)
 *   xil        venue id                           → call context
 *   xiu        user id                            → call context
 *
 * Treating the three identifiers as context is not a workaround for the single-secret materializer —
 * it is what they are. They are not secret, they route the call, and the consumer already has a
 * channel for exactly that (`X-Provider-Metadata`). Declaring them here would claim they need
 * protection they do not, and would need a multi-material credential that does not exist.
 *
 * ⚠️ The credential therefore travels **in the URL**, which is a first for this server: the
 * credential boundary review reasons about a credential in a *header*. Every surface that could
 * serialize a URL — a log line, a stack trace, an error message, a tool result — is now a credential
 * surface. `sendRequest` redacts query values from the error text it produces; nothing here may
 * interpolate a request URL into anything it returns.
 */
export const toteatAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'xapitoken', label: 'API token', placement: 'query' }],
};
