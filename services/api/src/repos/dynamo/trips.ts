import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Membership, Trip } from '@tripwise/shared';
import type { TripListEntry, TripsRepo } from '../interfaces.js';
import { META_SK, tripPk, userGsiPk } from '../keys.js';
import { queryAll, type DynamoContext } from './client.js';
import { membershipToItem, tripFromItem, tripToItem } from './items.js';

export function dynamoTripsRepo({ doc, tableName, gsi1Name }: DynamoContext): TripsRepo {
  return {
    async create(trip, host) {
      const membership: Membership = {
        tripId: trip.tripId,
        userId: trip.hostId,
        role: 'host',
        displayName: host.displayName,
        email: host.email,
      };
      // Req 2.1: META and the host MEMBER are written together or not at all.
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: tripToItem(trip),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: membershipToItem(membership, trip.name),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
    },

    async get(tripId): Promise<Trip | undefined> {
      const res = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: tripPk(tripId), SK: META_SK }, ConsistentRead: true }),
      );
      return res.Item ? tripFromItem(res.Item) : undefined;
    },

    // Req 2.4: GSI1 holds only Membership items under USER#{userId}. GSIs cannot be read
    // with ConsistentRead, so a just-created trip can take a moment to appear here.
    async listForUser(userId): Promise<TripListEntry[]> {
      const items = await queryAll(doc, {
        TableName: tableName,
        IndexName: gsi1Name,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': userGsiPk(userId) },
      });
      return items.map((raw) => ({
        tripId: raw.tripId as string,
        tripName: raw.tripName as string,
        role: raw.role as Membership['role'],
      }));
    },
  };
}
