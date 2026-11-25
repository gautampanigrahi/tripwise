import type {
  CheckResult,
  ChecklistItem,
  LodgingItem,
  Membership,
  PlanItem,
  Section,
  Trip,
  TripConstraints,
} from '@tripwise/shared';

/**
 * Repository contracts shared by the DynamoDB adapters (`./dynamo`) and the in-memory fakes
 * (`./memory`). Handlers depend only on these interfaces.
 *
 * Every read of trip data is strongly consistent (Req 23.2), except the two GSI1 lookups
 * (`trips.listForUser`, `invitations.get`), because DynamoDB GSIs only support eventual consistency.
 *
 * Expected conditional-write failures are returned as `{ ok: false, reason }` values so handlers
 * can map them to 404/409 responses. Any other storage error is thrown and becomes a 500.
 */

/** Write metadata stamped by the server (Req 5.1, 5.2). */
export interface WriteMeta {
  lastModifiedBy: string;
  lastModifiedAt: string;
}

/** One row of the caller's trip list, read from their Membership (Req 2.4). */
export interface TripListEntry {
  tripId: string;
  tripName: string;
  role: Membership['role'];
}

export interface Invitation {
  tripId: string;
  inviteId: string;
  /** Stored lowercase. */
  email: string;
  status: 'pending' | 'accepted';
  invitedBy: string;
  createdAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
}

/** Trip_Constraints as stored, with their write metadata. */
export type StoredConstraints = TripConstraints & WriteMeta;

/** Identifies one Check_Result. `runAt` is part of the sort key, so it is needed to address it. */
export interface CheckRef {
  tripId: string;
  runAt: string;
  checkId: string;
}

export interface TripsRepo {
  /**
   * Creates the Trip and the creator's `host` Membership in one transaction (Req 2.1).
   * The Membership's user ID is always `trip.hostId`.
   */
  create(trip: Trip, host: { displayName: string; email: string }): Promise<void>;
  get(tripId: string): Promise<Trip | undefined>;
  /** Trips where `userId` has a Membership, ordered by tripId (Req 2.4). */
  listForUser(userId: string): Promise<TripListEntry[]>;
}

export interface MembershipsRepo {
  /** The guard's only pre-decision read (Req 4.1). */
  get(tripId: string, userId: string): Promise<Membership | undefined>;
  /** Every Member of the trip, ordered by userId. */
  listByTrip(tripId: string): Promise<Membership[]>;
}

export type AcceptInvitationResult =
  | { ok: true; membership: Membership }
  | { ok: false; reason: 'NOT_PENDING' | 'ALREADY_MEMBER' };

export interface AcceptInvitationInput {
  tripId: string;
  inviteId: string;
  /** Denormalized onto the Membership for the trip list. */
  tripName: string;
  member: { userId: string; displayName: string; email: string };
  acceptedAt: string;
}

export interface InvitationsRepo {
  /** Stores a `pending` invitation (Req 3.1). Any `status` on the input is ignored. */
  create(invitation: Omit<Invitation, 'status' | 'acceptedBy' | 'acceptedAt'>): Promise<Invitation>;
  /** Looks up an invitation by ID alone (the accept route has no tripId). */
  get(inviteId: string): Promise<Invitation | undefined>;
  /**
   * Adds the `member` Membership and marks the invitation accepted in one transaction (Req 3.3).
   * Fails with no writes if the invitation is not pending or the user is already a Member.
   * The email check (Req 3.5) is the handler's job and must happen before this call.
   */
  accept(input: AcceptInvitationInput): Promise<AcceptInvitationResult>;
}

export interface ConstraintsRepo {
  get(tripId: string): Promise<StoredConstraints | undefined>;
  /**
   * Saves the constraints and copies destination and dates onto the Trip in one transaction
   * (design §5). Returns the stored record.
   */
  put(tripId: string, constraints: TripConstraints, meta: WriteMeta): Promise<StoredConstraints>;
}

export type UpdatePlanItemResult =
  | { ok: true; item: PlanItem }
  | { ok: false; reason: 'STALE'; current: PlanItem }
  | { ok: false; reason: 'NOT_FOUND' };

export type ClaimPlanItemResult =
  | { ok: true; item: ChecklistItem }
  | { ok: false; reason: 'ALREADY_CLAIMED'; claimedBy: string }
  | { ok: false; reason: 'NOT_FOUND' };

export interface PlanItemsRepo {
  /** Every item of the section, ordered by itemId; reads all pages (Req 5.4). */
  list(tripId: string, section: Section): Promise<PlanItem[]>;
  get(tripId: string, section: Section, itemId: string): Promise<PlanItem | undefined>;
  /** Server-owned field keys (`claimedBy`, `confirmationKey`) in `item.fields` are stored too. */
  create(item: PlanItem): Promise<void>;
  /**
   * Replaces fields and write metadata only if the stored `lastModifiedAt` equals `expected`
   * (Req 23.3). Server-owned fields keep their stored values, as in `applyUpdate`.
   * On a mismatch returns `STALE` with the stored item.
   */
  update(next: PlanItem, expectedLastModifiedAt: string): Promise<UpdatePlanItemResult>;
  /** Returns whether an item was deleted. */
  delete(tripId: string, section: Section, itemId: string): Promise<boolean>;
  /**
   * Sets `claimedBy` to the caller if the Checklist item is unclaimed or already the caller's,
   * and stamps the write metadata (Req 9.2). Otherwise `ALREADY_CLAIMED`, unchanged (Req 9.4).
   */
  claim(tripId: string, itemId: string, meta: WriteMeta): Promise<ClaimPlanItemResult>;
  /** Records the uploaded confirmation's S3 key on a Lodging item (Req 6.4). */
  setConfirmationKey(tripId: string, itemId: string, key: string): Promise<LodgingItem | undefined>;
}

export interface CheckResultsRepo {
  put(result: CheckResult): Promise<void>;
  get(ref: CheckRef): Promise<CheckResult | undefined>;
  /** Every saved Check_Result, newest `runAt` first (Req 13.6). */
  history(tripId: string): Promise<CheckResult[]>;
  /** The newest Check_Result, optionally of one kind. */
  latest(tripId: string, kind?: CheckResult['kind']): Promise<CheckResult | undefined>;
  /** Stores the explanation text and its source on an existing result. Returns false if missing. */
  setExplanation(
    ref: CheckRef,
    explanation: string,
    source: NonNullable<CheckResult['explanationSource']>,
  ): Promise<boolean>;
}

export interface Repos {
  trips: TripsRepo;
  memberships: MembershipsRepo;
  invitations: InvitationsRepo;
  constraints: ConstraintsRepo;
  planItems: PlanItemsRepo;
  checkResults: CheckResultsRepo;
}
