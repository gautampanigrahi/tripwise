import { PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Membership } from '@tripwise/shared';
import type { Invitation, InvitationsRepo } from '../interfaces.js';
import { INVITE_GSI_SK, inviteGsiPk, inviteSk, tripPk } from '../keys.js';
import { cancellationCodes, type DynamoContext } from './client.js';
import { invitationFromItem, invitationToItem, membershipToItem } from './items.js';

export function dynamoInvitationsRepo({ doc, tableName, gsi1Name }: DynamoContext): InvitationsRepo {
  return {
    async create(input) {
      const invitation: Invitation = {
        tripId: input.tripId,
        inviteId: input.inviteId,
        email: input.email.trim().toLowerCase(),
        status: 'pending',
        invitedBy: input.invitedBy,
        createdAt: input.createdAt,
      };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: invitationToItem(invitation),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return invitation;
    },

    // The accept route only has the inviteId, so this reads GSI1 (eventually consistent).
    async get(inviteId) {
      const res = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: gsi1Name,
          KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
          ExpressionAttributeValues: { ':pk': inviteGsiPk(inviteId), ':sk': INVITE_GSI_SK },
        }),
      );
      const raw = res.Items?.[0];
      return raw ? invitationFromItem(raw) : undefined;
    },

    // Req 3.3: Put MEMBER + Update INVITE (status = pending) in one transaction.
    async accept({ tripId, inviteId, tripName, member, acceptedAt }) {
      const membership: Membership = {
        tripId,
        userId: member.userId,
        role: 'member',
        displayName: member.displayName,
        email: member.email,
      };
      try {
        await doc.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: membershipToItem(membership, tripName),
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { PK: tripPk(tripId), SK: inviteSk(inviteId) },
                  UpdateExpression: 'SET #status = :accepted, acceptedBy = :user, acceptedAt = :at',
                  ConditionExpression: '#status = :pending',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: {
                    ':accepted': 'accepted',
                    ':pending': 'pending',
                    ':user': member.userId,
                    ':at': acceptedAt,
                  },
                },
              },
            ],
          }),
        );
      } catch (err) {
        const codes = cancellationCodes(err);
        if (codes?.[1] === 'ConditionalCheckFailed') return { ok: false, reason: 'NOT_PENDING' };
        if (codes?.[0] === 'ConditionalCheckFailed') return { ok: false, reason: 'ALREADY_MEMBER' };
        throw err;
      }
      return { ok: true, membership };
    },
  };
}
