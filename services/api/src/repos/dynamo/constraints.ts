import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { ConstraintsRepo, StoredConstraints } from '../interfaces.js';
import { CONSTRAINTS_SK, META_SK, tripPk } from '../keys.js';
import type { DynamoContext } from './client.js';
import { constraintsFromItem, constraintsToItem } from './items.js';

export function dynamoConstraintsRepo({ doc, tableName }: DynamoContext): ConstraintsRepo {
  return {
    async get(tripId) {
      const res = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: tripPk(tripId), SK: CONSTRAINTS_SK },
          ConsistentRead: true,
        }),
      );
      return res.Item ? constraintsFromItem(res.Item) : undefined;
    },

    // Design §5: the constraints and the Trip's destination and dates change together.
    async put(tripId, constraints, meta) {
      const stored: StoredConstraints = {
        ...constraints,
        lastModifiedBy: meta.lastModifiedBy,
        lastModifiedAt: meta.lastModifiedAt,
      };
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: tableName, Item: constraintsToItem(tripId, stored) } },
            {
              Update: {
                TableName: tableName,
                Key: { PK: tripPk(tripId), SK: META_SK },
                UpdateExpression: 'SET destination = :destination, startDate = :start, endDate = :end',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: {
                  ':destination': constraints.destination,
                  ':start': constraints.startDate,
                  ':end': constraints.endDate,
                },
              },
            },
          ],
        }),
      );
      return stored;
    },
  };
}
