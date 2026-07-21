import type { IProvider } from '../core/provider-port';
import { cloudbedsProvider } from './cloudbeds';
import { echoProvider } from './echo';

/**
 * The single explicit provider list (no auto-discovery).
 *
 * Adding a provider = create `src/providers/{slug}/` and add ONE line here. This is the only
 * registration touchpoint, and it lives under `src/providers/**` — so onboarding never edits the
 * core, the protocol, or any consumer (Provider Self-Containment).
 */
export const PROVIDERS: readonly IProvider[] = [echoProvider, cloudbedsProvider];
