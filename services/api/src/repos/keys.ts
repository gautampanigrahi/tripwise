import type { Section } from '@tripwise/shared';

/**
 * Single-table key builders (design: Data Models). The memory fakes use the same sort keys so
 * their ordering matches DynamoDB's lexicographic sort-key order.
 */
export const tripPk = (tripId: string): string => `TRIP#${tripId}`;

export const META_SK = 'META';
export const CONSTRAINTS_SK = 'CONSTRAINTS';

export const MEMBER_PREFIX = 'MEMBER#';
export const memberSk = (userId: string): string => `${MEMBER_PREFIX}${userId}`;
/** GSI1 partition of a Membership: the user's trip list. GSI1SK is `tripPk(tripId)`. */
export const userGsiPk = (userId: string): string => `USER#${userId}`;

export const inviteSk = (inviteId: string): string => `INVITE#${inviteId}`;
/** GSI1 key of an Invitation, so it can be found by inviteId alone. */
export const inviteGsiPk = inviteSk;
export const INVITE_GSI_SK = 'INVITE';

export const itemPrefix = (section: Section): string => `ITEM#${section}#`;
export const itemSk = (section: Section, itemId: string): string => `${itemPrefix(section)}${itemId}`;

export const CHECK_PREFIX = 'CHECK#';
/** `runAt` must be a fixed-width ISO timestamp (`Date#toISOString`) so keys sort by time. */
export const checkSk = (runAt: string, checkId: string): string => `${CHECK_PREFIX}${runAt}#${checkId}`;
