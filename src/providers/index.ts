import type { IProvider } from '../core/provider-port';
import { cloudbedsProvider } from './cloudbeds';
import { echoProvider } from './echo';
import { erbonProvider } from './erbon';
import { himedProvider } from './himed';
import { profitroomProvider } from './profitroom';
import { siigoProvider } from './siigo';
import { lobbypmsProvider } from './lobbypms';
import { siteminderProvider } from './siteminder';
import { toteatProvider } from './toteat';
import { wompiProvider } from './wompi';
import { woocommerceProvider } from './woocommerce';

/**
 * The single explicit provider list (no auto-discovery).
 *
 * Adding a provider = create `src/providers/{slug}/` and add ONE line here. This is the only
 * registration touchpoint, and it lives under `src/providers/**` — so onboarding never edits the
 * core, the protocol, or any consumer (Provider Self-Containment).
 */
export const PROVIDERS: readonly IProvider[] = [
  echoProvider,
  cloudbedsProvider,
  erbonProvider,
  lobbypmsProvider,
  toteatProvider,
  siigoProvider,
  woocommerceProvider,
  himedProvider,
  profitroomProvider,
  siteminderProvider,
  wompiProvider,
];
