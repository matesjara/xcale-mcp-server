import { ProviderErrorCode } from '../../core/errors';
import { err, ok, type ToolOutcome } from '../../core/tool';
import type { ClientResult, ProfitroomClient, SendRequest } from './client';
import { buildBookingUrl } from './booking-url';
import { translated } from './mappers';
import {
  type AvailabilityResponse,
  availabilitySchema,
  type Details,
  type Offers,
  offersSchema,
  type Rooms,
  roomsSchema,
} from './schemas';

/** One stay request — v1 quotes exactly one room (contract §C, `rooms` max 1). */
export interface StayRequest {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly rooms: readonly { readonly adults: number; readonly childrenAges?: readonly number[] }[];
}

export interface StayScope {
  readonly request: SendRequest;
  /** The clock; "today" is read in the hotel's own time zone (`details.timeZone`). */
  readonly now: () => number;
  readonly hotelKey: string;
  readonly details: Details;
  readonly locale: string;
}

/**
 * The shared pipeline behind `check_availability` and `get_stay_prices` (contract §C.4): ask the engine
 * for live proposals, then nest the room, offer and payment profile each one names. Money never leaves
 * here unless the caller is the backend-only price tool.
 */
export async function runStay(
  client: ProfitroomClient,
  scope: StayScope,
  stay: StayRequest,
  withPrices: boolean,
): Promise<ToolOutcome> {
  const room = stay.rooms[0] as StayRequest['rooms'][number];
  const childrenAges = [...(room.childrenAges ?? [])];

  const today = hotelToday(scope.now(), scope.details.timeZone);
  if (stay.checkIn < today) {
    return err(
      ProviderErrorCode.INVALID_INPUT,
      `checkIn ${stay.checkIn} is in the past at the hotel (today there is ${today})`,
    );
  }

  // The engine re-classifies a child it does not price as an adult and re-splits the party (Observed),
  // so an out-of-range age is refused up front with a reason the guest can act on.
  const childAgeIssue = checkChildAges(scope.details, childrenAges);
  if (childAgeIssue !== null) return err(ProviderErrorCode.INVALID_INPUT, childAgeIssue);

  const query: Record<string, string> = {
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    'occupancy[0][adults]': String(room.adults),
  };
  childrenAges.forEach((age, i) => {
    query[`occupancy[0][children][${i}]`] = String(age);
  });

  const availability = await client.get(
    scope.request,
    scope.hotelKey,
    'availability',
    availabilitySchema,
    { query },
  );
  if (!availability.ok) return err(availability.code, availability.message);

  const occupancy = { adults: room.adults, childrenAges };
  const currency = scope.details.defaultCurrency.code;
  const money = withPrices ? taxMode(scope.details, currency) : {};
  // One group per room the engine suggests. More than one, or one that does not echo our party, means
  // the engine re-split it: v1 quotes one room, so no partial price for a different party (§C.4).
  if (!pricedAsRequested(availability.data, occupancy)) {
    return ok({
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      occupancy,
      ...money,
      available: false,
      reason: 'party_does_not_fit_one_room',
      proposals: [],
    });
  }
  const found = availability.data[0]?.proposals ?? [];

  const catalog = await resolveCatalog(
    client,
    scope,
    found.map((f) => f.proposal),
  );
  if (!catalog.ok) return err(catalog.code, catalog.message);
  const { rooms, offers } = catalog.data;

  const joined = found.map(({ proposal, roomCount }) => ({
    proposal,
    out: joinProposal(scope, rooms, offers, proposal, roomCount),
  }));

  let proposals: unknown[] = joined.map((j) => j.out);
  if (withPrices) {
    // A price we would hand on must be a real amount in the hotel's currency — anything else is drift.
    const bad = found.find(
      ({ proposal: p }) =>
        p.price.currency !== currency || !Number.isFinite(p.price.amount) || p.price.amount <= 0,
    );
    if (bad !== undefined) {
      return err(
        ProviderErrorCode.PROVIDER_ERROR,
        `unexpected price from Profitroom (RoomID ${bad.proposal.RoomID}: ${bad.proposal.price.amount} ${bad.proposal.price.currency}, hotel currency ${currency})`,
      );
    }
    proposals = joined.map(({ proposal: p, out }) => ({
      ...out,
      price: p.price,
      originalPrice: p.originalPrice,
      discounts: p.discounts,
      bookingUrl: buildBookingUrl({
        locale: scope.locale,
        hotelKey: scope.hotelKey,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        adults: room.adults,
        childrenAges,
        currency,
        RoomID: p.RoomID,
        details: scope.details,
      }),
    }));
  }

  return ok({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    occupancy,
    ...money,
    available: proposals.length > 0,
    proposals,
  });
}

/**
 * The hotel's tax presentation, verbatim plus one derived flag. `be.taxesPresentationMode: "net"` means
 * the engine's prices EXCLUDE taxes it adds at checkout, and no endpoint states how much (contract §0).
 * An absent mode is reported as `null` and treated as not-included — the safe reading for a quote.
 */
function taxMode(details: Details, currency: string) {
  const mode = details.config['be.taxesPresentationMode'];
  const taxesPresentationMode = typeof mode === 'string' ? mode : null;
  return {
    currency,
    taxesPresentationMode,
    taxesIncluded: taxesPresentationMode !== null && taxesPresentationMode !== 'net',
  };
}

/** The hotel's calendar date at `epochMs`, `YYYY-MM-DD`, in its IANA time zone. */
function hotelToday(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/** null when every age is one the hotel prices as a child (`personTypes` C), else the guest-facing reason. */
function checkChildAges(details: Details, ages: readonly number[]): string | null {
  if (ages.length === 0) return null;
  const child = details.personTypes.find((p) => p.type === 'C');
  if (child === undefined || child.maxAge === null) {
    return 'this hotel does not price children separately; count them as adults';
  }
  const minAge = child.minAge ?? 0;
  if (ages.some((a) => a < minAge || a > (child.maxAge as number))) {
    return `children older than ${child.maxAge} count as adults at this hotel`;
  }
  return null;
}

/** True when the engine answered with exactly one group that prices exactly the requested party. */
function pricedAsRequested(
  groups: AvailabilityResponse,
  requested: { adults: number; childrenAges: readonly number[] },
): boolean {
  if (groups.length === 0) return true; // nothing at all: plain "not available", not a re-split
  if (groups.length > 1) return false;
  const echo = (groups[0] as AvailabilityResponse[number]).occupancy;
  if (echo.adults !== requested.adults) return false;
  const echoed: number[] = [];
  for (const bucket of echo.children) {
    // An age-range bucket cannot be matched to exact ages — treat it as a mismatch (fail closed).
    if (bucket.minAge !== bucket.maxAge) return false;
    for (let i = 0; i < bucket.count; i += 1) echoed.push(bucket.minAge);
  }
  const sorted = (xs: readonly number[]) => [...xs].sort((x, y) => x - y).join(',');
  return sorted(echoed) === sorted(requested.childrenAges);
}

interface Catalog {
  readonly rooms: Rooms;
  readonly offers: Offers;
}

async function loadCatalog(
  client: ProfitroomClient,
  scope: StayScope,
): Promise<ClientResult<Catalog>> {
  const rooms = await client.get(scope.request, scope.hotelKey, 'rooms', roomsSchema);
  if (!rooms.ok) return rooms;
  const offers = await client.get(scope.request, scope.hotelKey, 'offers', offersSchema, {
    query: { status: '1' },
  });
  if (!offers.ok) return offers;
  return { ok: true, data: { rooms: rooms.data, offers: offers.data } };
}

type ProposalRef = { OfferID: number; RoomID: number; profileId: number };

/**
 * The rooms and offers every proposal names. A miss usually means the hotel added one minutes ago and
 * our 15-minute cache predates it: refresh once. Still missing → fail closed; never a nameless option,
 * never a silently dropped one (contract §C.4).
 */
async function resolveCatalog(
  client: ProfitroomClient,
  scope: StayScope,
  refs: readonly ProposalRef[],
): Promise<ClientResult<Catalog>> {
  const cached = await loadCatalog(client, scope);
  if (!cached.ok || refs.every((ref) => resolvable(cached.data, ref))) return cached;

  client.invalidate(scope.hotelKey);
  const fresh = await loadCatalog(client, scope);
  if (!fresh.ok) return fresh;
  const missing = refs.find((ref) => !resolvable(fresh.data, ref));
  if (missing === undefined) return fresh;
  return {
    ok: false,
    code: ProviderErrorCode.PROVIDER_ERROR,
    message: `Profitroom proposed a room/rate this hotel does not list (RoomID ${missing.RoomID}, OfferID ${missing.OfferID}, profileId ${missing.profileId})`,
  };
}

function resolvable(catalog: Catalog, proposal: ProposalRef): boolean {
  const offer = catalog.offers.find((o) => o.id === proposal.OfferID);
  return (
    catalog.rooms.some((r) => r.id === proposal.RoomID) &&
    offer !== undefined &&
    offer.profiles.some((p) => p.profileId === proposal.profileId)
  );
}

function joinProposal(
  scope: StayScope,
  rooms: Rooms,
  offers: Offers,
  proposal: ProposalRef,
  roomCount: number,
) {
  const room = rooms.find((r) => r.id === proposal.RoomID);
  const offer = offers.find((o) => o.id === proposal.OfferID);
  const profile = offer?.profiles.find((p) => p.profileId === proposal.profileId);
  const roomText = translated(room?.translations ?? [], scope.locale, scope.details.defaultLocale);
  const offerText = translated(
    offer?.translations ?? [],
    scope.locale,
    scope.details.defaultLocale,
  );
  return {
    OfferID: proposal.OfferID,
    RoomID: proposal.RoomID,
    profileId: proposal.profileId,
    roomCount,
    room: { id: proposal.RoomID, name: roomText.name ?? '' },
    offer: {
      id: proposal.OfferID,
      name: offerText.name ?? '',
      ...(offerText.description !== undefined ? { description: offerText.description } : {}),
    },
    profile,
  };
}
