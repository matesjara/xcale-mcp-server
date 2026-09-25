import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Autoagendamiento authenticates with two static values HiMed issues per clinic: `token` (the secret,
 * described in HiMed's docs as "Código de seguridad") and `codigo_servicio` (a service identifier,
 * "Código" — not secret; leaking it alone grants nothing).
 *
 * So only `token` is the credential the materializer injects (placement:'body'). `codigo_servicio`
 * travels as non-secret metadata (see `context.ts`) and the handler puts it in the body. Both are
 * static (not computed per request), so this is a plain secret-in-body, not imperative auth.
 */
export const himedSchedulingAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'token', label: 'Token', placement: 'body' }],
};
