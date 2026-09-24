import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'siteminder';

/**
 * SiteMinder — through its **Direct Booking API**, the one SiteMinder API a property can open to us
 * without a SiteMinder partnership: the hotel's Admin generates the key itself (SiteMinder Platform ›
 * Direct Booking › Configuration › API Integration, or Little Hotelier's API integration tab). It is
 * how a hotel on **Little Hotelier** reaches us at all: SMX does not deliver availability or rates for
 * Little Hotelier, and Channels Plus needs a partnership and books as an OTA
 * (`docs/design/siteminder-provider/design-notes.md` §1).
 *
 * The API is **read-only by SiteMinder's own contract** — it prices and describes, it never creates,
 * reads, changes or cancels a reservation. The booking itself happens in the property's own booking
 * engine, which is why `mcp_siteminder_build_booking_link` exists.
 *
 * The context (`propertyUuid`) is PASTED, not discovered: a property-level key cannot list properties
 * (`GET /properties` is for group keys only), and SiteMinder shows the Property ID on the same screen
 * as the key. So the probe is a read that needs only that pasted id.
 */
export const siteminderManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'SiteMinder',
  category: 'hospitality',
  schemaVersion: '2026-09-24',
  providerVersion: '0.1.0',
  capabilities: { pagination: true },
  connectionProbe: { tool: `mcp_${SLUG}_get_property` },
  // One key may open one property (property key) or a whole group (group key): the account is the
  // property, never the key — rotating a key must not look like a second hotel.
  accountContextKeys: ['propertyUuid'],
};
