import { ProviderErrorCode } from '../../core/errors';
import type { ClientResult } from './client';
import type { Details, Offers, Rooms } from './schemas';

/**
 * Projections of the engine's resources into tool output (contract §C.3).
 *
 * Fidelity over Unification (ADR 0009): fields keep Profitroom's names and values. The only reshaping is
 * flattening ONE locale out of `translations[]` — `translations[locale].messages[fieldName]` becomes
 * `fieldName` — and dropping fields the agent does not need. Nothing is renamed or re-coded.
 */

type Translations = Details['translations'];

/** `fieldName → value` for the requested locale, else the hotel's default locale, else the first one. */
export function translated(
  translations: Translations,
  locale: string,
  defaultLocale: string,
): Record<string, string> {
  const pick =
    translations.find((t) => t.locale === locale) ??
    translations.find((t) => t.locale === defaultLocale) ??
    translations[0];
  const out: Record<string, string> = {};
  for (const m of pick?.messages ?? []) {
    if (m.value !== null) out[m.fieldName] = m.value;
  }
  return out;
}

/** The locale a call answers in: the requested one if the hotel has it live, else `defaultLocale`. */
export function resolveLocale(details: Details, requested?: string): ClientResult<string> {
  if (requested === undefined) return { ok: true, data: details.defaultLocale };
  const live = details.locales.filter((l) => l.isLive).map((l) => l.locale);
  if (!live.includes(requested)) {
    return {
      ok: false,
      code: ProviderErrorCode.INVALID_INPUT,
      message: `locale "${requested}" is not offered by this hotel (live: ${live.join(', ')})`,
    };
  }
  return { ok: true, data: requested };
}

const CONFIG_KEYS = [
  'Hotel.CheckinAfter',
  'Hotel.CheckoutBefore',
  'be.taxesPresentationMode',
  'be.maxRoomsPerReservation',
] as const;

export function toHotel(details: Details, locale: string, hotelKey: string) {
  const text = translated(details.translations, locale, details.defaultLocale);
  const config: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = details.config[key];
    if (typeof value === 'string') config[key] = value;
  }
  return {
    name: text.name ?? '',
    ...(text.description !== undefined ? { description: text.description } : {}),
    defaultCurrency: details.defaultCurrency,
    timeZone: details.timeZone,
    locales: details.locales.filter((l) => l.isLive),
    defaultLocale: details.defaultLocale,
    ...(details.address !== null ? { address: details.address } : {}),
    personTypes: details.personTypes,
    config,
    bookingEngineUrl: `https://booking.profitroom.com/${locale}/${hotelKey}`,
    // Derived (contract §C.3): the hotel's identity, read by a consumer as `contextDiscovery`.
    hotelKey,
  };
}

export function toRoom(room: Rooms[number], locale: string, defaultLocale: string) {
  const text = translated(room.translations, locale, defaultLocale);
  return {
    id: room.id,
    name: text.name ?? '',
    ...pickText(text, ['description', 'bedsDescription', 'sight']),
    attributes: {
      ...(room.attributes.area !== null ? { area: room.attributes.area } : {}),
      ...(room.attributes.maxOccupancy !== null
        ? { maxOccupancy: room.attributes.maxOccupancy }
        : {}),
    },
    limits: room.limits,
    totalRooms: room.totalRooms,
    offerIds: room.offerIds,
  };
}

export function toOffer(offer: Offers[number], locale: string, defaultLocale: string) {
  const text = translated(offer.translations, locale, defaultLocale);
  return {
    id: offer.id,
    type: offer.type,
    name: text.name ?? '',
    ...pickText(text, ['description', 'intro']),
    roomIds: offer.roomIds,
    profiles: offer.profiles,
    restrictions: offer.restrictions,
  };
}

/** The listed translated fields that exist, under their own names. */
function pickText(text: Record<string, string>, fields: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (text[f] !== undefined) out[f] = text[f];
  }
  return out;
}
