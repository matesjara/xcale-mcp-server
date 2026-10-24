import { z } from 'zod';

/**
 * The Profitroom booking engine's wire shapes — ONLY the fields this provider reads (contract §A).
 *
 * This API is the engine's internal one, not a published contract (ADR credential-less-provider-auth,
 * Neutral consequences), so these schemas are the drift tripwire twice over: the client parses every
 * response with them and fails closed on a miss (contract §C.4), and the daily drift probe
 * (`scripts/profitroom-drift.ts`) parses the live API with the very same exports. zod's default
 * strip means a field Profitroom ADDS never fails; a field we use that changes or disappears does.
 */

const translations = z.array(
  z.object({
    locale: z.string(),
    messages: z.array(z.object({ fieldName: z.string(), value: z.string().nullable() })),
  }),
);

const money = z.object({ amount: z.number(), currency: z.string() });

const childBucket = z.object({ minAge: z.number(), maxAge: z.number(), count: z.number() });
const occupancyLimit = z.object({
  numberOfPeople: z.number(),
  occupancy: z.object({ adults: z.number(), children: z.array(childBucket) }),
});

export const detailsSchema = z.object({
  translations,
  defaultCurrency: z.object({ code: z.string() }),
  locales: z.array(z.object({ locale: z.string(), isLive: z.boolean() })),
  defaultLocale: z.string(),
  timeZone: z.string(),
  address: z
    .object({
      street: z.string().nullable(),
      city: z.string().nullable(),
      postalCode: z.string().nullable(),
      country: z.string().nullable(),
      coordinates: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
    })
    .nullable(),
  config: z.record(z.unknown()),
  personTypes: z.array(
    z.object({ type: z.string(), minAge: z.number().nullable(), maxAge: z.number().nullable() }),
  ),
  enabledNewChildrenOccupancyPicker: z.boolean(),
});

export const roomsSchema = z.array(
  z.object({
    id: z.number(),
    translations,
    attributes: z.object({
      area: z.object({ from: z.number(), to: z.number(), unit: z.string() }).nullable(),
      maxOccupancy: z.object({ people: z.number(), extraBeds: z.number().nullable() }).nullable(),
    }),
    limits: z.object({ min: occupancyLimit, max: occupancyLimit }),
    totalRooms: z.number(),
    offerIds: z.array(z.number()),
    // Photos by file name only (#145). Optional: a room without photos is still a room, so a missing
    // or reshaped gallery never fails the room list. The drift probe's `photo` check catches a
    // reshaped one: rooms that parse with no photo at all are reported as drift.
    gallery: z
      .object({
        featured: z.object({ fileName: z.string() }).nullable(),
        images: z.array(z.object({ fileName: z.string(), orderIndex: z.number().nullable() })),
      })
      .nullable()
      .optional()
      .catch(null),
  }),
);

export const profileSchema = z.object({
  profileId: z.number(),
  type: z.string(),
  deposit: z
    .object({ percentage: z.number().nullable(), nights: z.number().nullable() })
    .nullable(),
  params: z.object({
    cancelTime: z.string().nullable(),
    cancelUnit: z.string().nullable(),
    remainingPaymentType: z.string().nullable(),
  }),
});

export const offersSchema = z.array(
  z.object({
    id: z.number(),
    type: z.string(),
    translations,
    roomIds: z.array(z.number()),
    profiles: z.array(profileSchema),
    restrictions: z.object({
      availableFrom: z.string().nullable(),
      availableTo: z.string().nullable(),
      minNights: z.number().nullable(),
      availableWeekDays: z.array(z.number()),
    }),
  }),
);

export const calendarSchema = z.object({
  from: z.string(),
  to: z.string(),
  dates: z.array(
    z.object({
      date: z.string(),
      availability: z.boolean(),
      minLOS: z.number(),
      maxLOS: z.number().nullable(),
      CTD: z.boolean(),
    }),
  ),
});

export const availabilitySchema = z.array(
  z.object({
    occupancy: z.object({ adults: z.number(), children: z.array(childBucket) }),
    proposals: z.array(
      z.object({
        proposal: z.object({
          OfferID: z.number(),
          RoomID: z.number(),
          profileId: z.number(),
          price: money,
          originalPrice: money.nullable(),
          discounts: z.array(z.object({ amount: z.number(), availableTo: z.string() })),
        }),
        roomCount: z.number(),
      }),
    ),
  }),
);

export type Details = z.infer<typeof detailsSchema>;
export type Rooms = z.infer<typeof roomsSchema>;
export type Offers = z.infer<typeof offersSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type CalendarResponse = z.infer<typeof calendarSchema>;
export type AvailabilityResponse = z.infer<typeof availabilitySchema>;
