import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Credential-less (ADR credential-less-provider-auth): the booking engine's API takes no secret. The
 * hotel is named by the call context's `bookingEngineUrl`, never by a credential.
 */
export const profitroomAuth = { type: 'none' } as const satisfies ProviderAuthDescriptor;
