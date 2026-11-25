import {
  applyUpdate,
  claim as claimModel,
  type ChecklistItem,
  type CheckResult,
  type LodgingItem,
  type Membership,
  type PlanItem,
  type Trip,
} from '@tripwise/shared';
import type {
  CheckResultsRepo,
  ConstraintsRepo,
  Invitation,
  InvitationsRepo,
  MembershipsRepo,
  PlanItemsRepo,
  Repos,
  StoredConstraints,
  TripsRepo,
} from '../interfaces.js';
import {
  CHECK_PREFIX,
  CONSTRAINTS_SK,
  MEMBER_PREFIX,
  META_SK,
  checkSk,
  inviteSk,
  itemPrefix,
  itemSk,
  memberSk,
  tripPk,
} from '../keys.js';
import { FakeConditionError, MemoryTable } from './table.js';

export { FakeConditionError, MemoryTable, type RepoCall } from './table.js';

type StoredMembership = Membership & { tripName: string };

const stripTripName = ({ tripName: _tripName, ...m }: StoredMembership): Membership => m;

function memoryTrips(table: MemoryTable): TripsRepo {
  return {
    async create(trip, host) {
      table.record('trips', 'create', [trip, host]);
      const pk = tripPk(trip.tripId);
      if (table.has(pk, META_SK) || table.has(pk, memberSk(trip.hostId))) {
        throw new FakeConditionError('TransactionCanceledException', `Trip ${trip.tripId} already exists`);
      }
      const membership: StoredMembership = {
        tripId: trip.tripId,
        userId: trip.hostId,
        role: 'host',
        displayName: host.displayName,
        email: host.email,
        tripName: trip.name,
      };
      table.put(pk, META_SK, trip);
      table.put(pk, memberSk(trip.hostId), membership);
    },
    async get(tripId) {
      table.record('trips', 'get', [tripId]);
      return table.get<Trip>(tripPk(tripId), META_SK);
    },
    async listForUser(userId) {
      table.record('trips', 'listForUser', [userId]);
      return table
        .scanBySk((sk) => sk === memberSk(userId))
        .map((m) => m as StoredMembership)
        .map(({ tripId, tripName, role }) => ({ tripId, tripName, role }));
    },
  };
}

function memoryMemberships(table: MemoryTable): MembershipsRepo {
  return {
    async get(tripId, userId) {
      table.record('memberships', 'get', [tripId, userId]);
      const m = table.get<StoredMembership>(tripPk(tripId), memberSk(userId));
      return m ? stripTripName(m) : undefined;
    },
    async listByTrip(tripId) {
      table.record('memberships', 'listByTrip', [tripId]);
      return table.query<StoredMembership>(tripPk(tripId), MEMBER_PREFIX).map(stripTripName);
    },
  };
}

function memoryInvitations(table: MemoryTable): InvitationsRepo {
  return {
    async create(input) {
      table.record('invitations', 'create', [input]);
      const invitation: Invitation = {
        tripId: input.tripId,
        inviteId: input.inviteId,
        email: input.email.trim().toLowerCase(),
        status: 'pending',
        invitedBy: input.invitedBy,
        createdAt: input.createdAt,
      };
      const pk = tripPk(invitation.tripId);
      const sk = inviteSk(invitation.inviteId);
      if (table.has(pk, sk)) {
        throw new FakeConditionError('ConditionalCheckFailedException', `Invitation ${invitation.inviteId} exists`);
      }
      table.put(pk, sk, invitation);
      return invitation;
    },
    async get(inviteId) {
      table.record('invitations', 'get', [inviteId]);
      return table.scanBySk((sk) => sk === inviteSk(inviteId))[0] as Invitation | undefined;
    },
    async accept(input) {
      table.record('invitations', 'accept', [input]);
      const { tripId, inviteId, tripName, member, acceptedAt } = input;
      const pk = tripPk(tripId);
      const invitation = table.get<Invitation>(pk, inviteSk(inviteId));
      // Same precedence as the DynamoDB adapter's cancellation-reason mapping.
      if (invitation?.status !== 'pending') return { ok: false, reason: 'NOT_PENDING' };
      if (table.has(pk, memberSk(member.userId))) return { ok: false, reason: 'ALREADY_MEMBER' };
      const membership: Membership = {
        tripId,
        userId: member.userId,
        role: 'member',
        displayName: member.displayName,
        email: member.email,
      };
      table.put(pk, memberSk(member.userId), { ...membership, tripName } satisfies StoredMembership);
      table.put(pk, inviteSk(inviteId), {
        ...invitation,
        status: 'accepted',
        acceptedBy: member.userId,
        acceptedAt,
      } satisfies Invitation);
      return { ok: true, membership };
    },
  };
}

function memoryConstraints(table: MemoryTable): ConstraintsRepo {
  return {
    async get(tripId) {
      table.record('constraints', 'get', [tripId]);
      return table.get<StoredConstraints>(tripPk(tripId), CONSTRAINTS_SK);
    },
    async put(tripId, constraints, meta) {
      table.record('constraints', 'put', [tripId, constraints, meta]);
      const pk = tripPk(tripId);
      const trip = table.get<Trip>(pk, META_SK);
      if (!trip) throw new FakeConditionError('TransactionCanceledException', `Trip ${tripId} not found`);
      const stored: StoredConstraints = {
        ...constraints,
        lastModifiedBy: meta.lastModifiedBy,
        lastModifiedAt: meta.lastModifiedAt,
      };
      table.put(pk, CONSTRAINTS_SK, stored);
      table.put(pk, META_SK, {
        ...trip,
        destination: constraints.destination,
        startDate: constraints.startDate,
        endDate: constraints.endDate,
      } satisfies Trip);
      return stored;
    },
  };
}

function memoryPlanItems(table: MemoryTable): PlanItemsRepo {
  const read = (tripId: string, section: PlanItem['section'], itemId: string) =>
    table.get<PlanItem>(tripPk(tripId), itemSk(section, itemId));
  const write = (item: PlanItem) => table.put(tripPk(item.tripId), itemSk(item.section, item.itemId), item);

  return {
    async list(tripId, section) {
      table.record('planItems', 'list', [tripId, section]);
      return table.query<PlanItem>(tripPk(tripId), itemPrefix(section));
    },
    async get(tripId, section, itemId) {
      table.record('planItems', 'get', [tripId, section, itemId]);
      return read(tripId, section, itemId);
    },
    async create(item) {
      table.record('planItems', 'create', [item]);
      if (read(item.tripId, item.section, item.itemId)) {
        throw new FakeConditionError('ConditionalCheckFailedException', `Item ${item.itemId} exists`);
      }
      write(item);
    },
    async update(next, expectedLastModifiedAt) {
      table.record('planItems', 'update', [next, expectedLastModifiedAt]);
      const stored = read(next.tripId, next.section, next.itemId);
      if (!stored) return { ok: false, reason: 'NOT_FOUND' };
      const result = applyUpdate(stored, expectedLastModifiedAt, next);
      if (!result.ok) return { ok: false, reason: 'STALE', current: result.current };
      write(result.item);
      return { ok: true, item: result.item };
    },
    async delete(tripId, section, itemId) {
      table.record('planItems', 'delete', [tripId, section, itemId]);
      return table.delete(tripPk(tripId), itemSk(section, itemId));
    },
    async claim(tripId, itemId, meta) {
      table.record('planItems', 'claim', [tripId, itemId, meta]);
      const stored = read(tripId, 'Checklist', itemId) as ChecklistItem | undefined;
      if (!stored) return { ok: false, reason: 'NOT_FOUND' };
      const result = claimModel(stored, meta.lastModifiedBy);
      if (!result.ok) return { ok: false, reason: 'ALREADY_CLAIMED', claimedBy: result.claimedBy };
      const item: ChecklistItem = { ...result.item, ...meta };
      write(item);
      return { ok: true, item };
    },
    async setConfirmationKey(tripId, itemId, key) {
      table.record('planItems', 'setConfirmationKey', [tripId, itemId, key]);
      const stored = read(tripId, 'Lodging', itemId) as LodgingItem | undefined;
      if (!stored) return undefined;
      const item: LodgingItem = { ...stored, fields: { ...stored.fields, confirmationKey: key } };
      write(item);
      return item;
    },
  };
}

function memoryCheckResults(table: MemoryTable): CheckResultsRepo {
  const newestFirst = (tripId: string) => table.query<CheckResult>(tripPk(tripId), CHECK_PREFIX, true);
  return {
    async put(result) {
      table.record('checkResults', 'put', [result]);
      table.put(tripPk(result.tripId), checkSk(result.runAt, result.checkId), result);
    },
    async get(ref) {
      table.record('checkResults', 'get', [ref]);
      return table.get<CheckResult>(tripPk(ref.tripId), checkSk(ref.runAt, ref.checkId));
    },
    async history(tripId) {
      table.record('checkResults', 'history', [tripId]);
      return newestFirst(tripId);
    },
    async latest(tripId, kind) {
      table.record('checkResults', 'latest', [tripId, kind]);
      return newestFirst(tripId).find((r) => !kind || r.kind === kind);
    },
    async setExplanation(ref, explanation, source) {
      table.record('checkResults', 'setExplanation', [ref, explanation, source]);
      const pk = tripPk(ref.tripId);
      const sk = checkSk(ref.runAt, ref.checkId);
      const stored = table.get<CheckResult>(pk, sk);
      if (!stored) return false;
      table.put(pk, sk, { ...stored, explanation, explanationSource: source } satisfies CheckResult);
      return true;
    },
  };
}

/** In-memory repositories sharing one `MemoryTable`. Use `repos.table.calls` to assert on calls. */
export function createMemoryRepos(table: MemoryTable = new MemoryTable()): Repos & { table: MemoryTable } {
  return {
    table,
    trips: memoryTrips(table),
    memberships: memoryMemberships(table),
    invitations: memoryInvitations(table),
    constraints: memoryConstraints(table),
    planItems: memoryPlanItems(table),
    checkResults: memoryCheckResults(table),
  };
}
