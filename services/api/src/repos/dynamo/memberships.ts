import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { MembershipsRepo } from '../interfaces.js';
import { MEMBER_PREFIX, memberSk, tripPk } from '../keys.js';
import { queryAll, type DynamoContext } from './client.js';
import { membershipFromItem } from './items.js';

export function dynamoMembershipsRepo({ doc, tableName }: DynamoContext): MembershipsRepo {
  return {
    async get(tripId, userId) {
      const res = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: tripPk(tripId), SK: memberSk(userId) },
          ConsistentRead: true,
        }),
      );
      return res.Item ? membershipFromItem(res.Item) : undefined;
    },

    async listByTrip(tripId) {
      const items = await queryAll(doc, {
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': tripPk(tripId), ':prefix': MEMBER_PREFIX },
        ConsistentRead: true,
      });
      return items.map(membershipFromItem);
    },
  };
}
