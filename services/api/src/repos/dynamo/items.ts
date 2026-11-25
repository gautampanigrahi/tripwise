import {
  SERVER_OWNED_FIELD_KEYS,
  type CheckResult,
  type Membership,
  type PlanItem,
  type Section,
  type Trip,
} from '@tripwise/shared';
import type { Invitation, StoredConstraints } from '../interfaces.js';
import {
  CONSTRAINTS_SK,
  INVITE_GSI_SK,
  META_SK,
  checkSk,
  inviteGsiPk,
  inviteSk,
  itemSk,
  memberSk,
  tripPk,
  userGsiPk,
} from '../keys.js';
import type { DynamoItem } from './client.js';

/**
 * Conversions between domain objects and table items. Each `from*` copies only the domain
 * attributes, so key attributes (PK, SK, GSI1PK, GSI1SK) never leak to handlers.
 */

const KEY_ATTRS = new Set(['PK', 'SK', 'GSI1PK', 'GSI1SK']);
const withoutKeys = (raw: DynamoItem): DynamoItem =>
  Object.fromEntries(Object.entries(raw).filter(([k]) => !KEY_ATTRS.has(k)));

// ---------- Trip ----------
export const tripToItem = (t: Trip): DynamoItem => ({
  PK: tripPk(t.tripId),
  SK: META_SK,
  tripId: t.tripId,
  name: t.name,
  destination: t.destination,
  startDate: t.startDate,
  endDate: t.endDate,
  hostId: t.hostId,
  createdAt: t.createdAt,
});
export const tripFromItem = (raw: DynamoItem): Trip => ({
  tripId: raw.tripId as string,
  name: raw.name as string,
  destination: raw.destination as string,
  startDate: raw.startDate as string,
  endDate: raw.endDate as string,
  hostId: raw.hostId as string,
  createdAt: raw.createdAt as string,
});

// ---------- Membership ----------
export const membershipToItem = (m: Membership, tripName: string): DynamoItem => ({
  PK: tripPk(m.tripId),
  SK: memberSk(m.userId),
  GSI1PK: userGsiPk(m.userId),
  GSI1SK: tripPk(m.tripId),
  tripId: m.tripId,
  userId: m.userId,
  role: m.role,
  displayName: m.displayName,
  email: m.email,
  tripName,
});
export const membershipFromItem = (raw: DynamoItem): Membership => ({
  tripId: raw.tripId as string,
  userId: raw.userId as string,
  role: raw.role as Membership['role'],
  displayName: raw.displayName as string,
  email: raw.email as string,
});

// ---------- Invitation ----------
export const invitationToItem = (i: Invitation): DynamoItem => ({
  PK: tripPk(i.tripId),
  SK: inviteSk(i.inviteId),
  GSI1PK: inviteGsiPk(i.inviteId),
  GSI1SK: INVITE_GSI_SK,
  ...i,
});
export const invitationFromItem = (raw: DynamoItem): Invitation => withoutKeys(raw) as unknown as Invitation;

// ---------- Trip_Constraints ----------
export const constraintsToItem = (tripId: string, c: StoredConstraints): DynamoItem => ({
  ...c,
  PK: tripPk(tripId),
  SK: CONSTRAINTS_SK,
});
export const constraintsFromItem = (raw: DynamoItem): StoredConstraints =>
  withoutKeys(raw) as unknown as StoredConstraints;

// ---------- Plan_Item ----------
/**
 * Server-owned field keys (`claimedBy`, `confirmationKey`) are stored as top-level attributes,
 * outside the `fields` map. A field update (`SET fields = :fields`) therefore never touches them,
 * and the claim condition can test `claimedBy` directly. Reads merge them back into `fields`.
 */
export function splitServerOwned(fields: Record<string, unknown>): {
  fields: Record<string, unknown>;
  serverOwned: Record<string, unknown>;
} {
  const rest: Record<string, unknown> = { ...fields };
  const serverOwned: Record<string, unknown> = {};
  for (const key of SERVER_OWNED_FIELD_KEYS) {
    if (key in rest) {
      if (rest[key] !== undefined) serverOwned[key] = rest[key];
      delete rest[key];
    }
  }
  return { fields: rest, serverOwned };
}

export const planItemToItem = (p: PlanItem): DynamoItem => {
  const { fields, serverOwned } = splitServerOwned(p.fields);
  return {
    PK: tripPk(p.tripId),
    SK: itemSk(p.section, p.itemId),
    tripId: p.tripId,
    itemId: p.itemId,
    section: p.section,
    fields,
    lastModifiedBy: p.lastModifiedBy,
    lastModifiedAt: p.lastModifiedAt,
    createdAt: p.createdAt,
    ...serverOwned,
  };
};
export const planItemFromItem = (raw: DynamoItem): PlanItem => {
  const fields: Record<string, unknown> = { ...((raw.fields as Record<string, unknown> | undefined) ?? {}) };
  for (const key of SERVER_OWNED_FIELD_KEYS) {
    if (raw[key] !== undefined) fields[key] = raw[key];
  }
  return {
    tripId: raw.tripId as string,
    itemId: raw.itemId as string,
    section: raw.section as Section,
    fields,
    lastModifiedBy: raw.lastModifiedBy as string,
    lastModifiedAt: raw.lastModifiedAt as string,
    createdAt: raw.createdAt as string,
  };
};

// ---------- Check_Result ----------
export const checkResultToItem = (r: CheckResult): DynamoItem => ({
  ...r,
  PK: tripPk(r.tripId),
  SK: checkSk(r.runAt, r.checkId),
});
export const checkResultFromItem = (raw: DynamoItem): CheckResult => withoutKeys(raw) as unknown as CheckResult;
