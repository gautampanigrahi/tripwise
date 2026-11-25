import type { Catalog, CheckName, CheckOutcome, IsoDate, TripConstraints } from '@tripwise/shared';

/** The stay being evaluated: the current Lodging Plan_Item, or a Catalog stay for alternatives. */
export interface StayInput {
  stayId?: string;
  name: string;
  sleeps: number;
  /** Integer US cents (Req 14.5). */
  nightlyPriceCents: number;
  features: Record<string, boolean>;
  checkIn: IsoDate;
  checkOut: IsoDate;
}

export interface ItineraryStop {
  itemId: string;
  day: IsoDate;
  startTime: string;
  stopName: string;
}

export interface EngineInput {
  stay: StayInput;
  /** Integer US cents, one per Transportation Plan_Item. */
  transportCostsCents: number[];
  itinerary: ItineraryStop[];
  constraints: TripConstraints;
  catalog: Pick<Catalog, 'version' | 'activities' | 'travelTimes'>;
  /** Always includes Cost, Capacity, Dates. */
  enabledChecks: ReadonlyArray<CheckName>;
}

export interface EngineOutput {
  outcomes: CheckOutcome[];
  score: number;
  tripNights: number;
}
