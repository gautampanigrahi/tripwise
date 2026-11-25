import { GetCommand, PutCommand, QueryCommand, UpdateCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import type { CheckRef, CheckResultsRepo } from '../interfaces.js';
import { CHECK_PREFIX, checkSk, tripPk } from '../keys.js';
import { isConditionalCheckFailed, queryAll, type DynamoContext } from './client.js';
import { checkResultFromItem, checkResultToItem } from './items.js';

export function dynamoCheckResultsRepo({ doc, tableName }: DynamoContext): CheckResultsRepo {
  const key = (ref: CheckRef) => ({ PK: tripPk(ref.tripId), SK: checkSk(ref.runAt, ref.checkId) });

  // Newest first: SK is CHECK#{runAt ISO}#{checkId} and ISO timestamps sort lexicographically.
  const newestFirst = (tripId: string): QueryCommandInput => ({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': tripPk(tripId), ':prefix': CHECK_PREFIX },
    ScanIndexForward: false,
    ConsistentRead: true,
  });

  return {
    async put(result) {
      await doc.send(new PutCommand({ TableName: tableName, Item: checkResultToItem(result) }));
    },

    async get(ref) {
      const res = await doc.send(new GetCommand({ TableName: tableName, Key: key(ref), ConsistentRead: true }));
      return res.Item ? checkResultFromItem(res.Item) : undefined;
    },

    // Req 13.6
    async history(tripId) {
      return (await queryAll(doc, newestFirst(tripId))).map(checkResultFromItem);
    },

    async latest(tripId, kind) {
      if (!kind) {
        const res = await doc.send(new QueryCommand({ ...newestFirst(tripId), Limit: 1 }));
        const raw = res.Items?.[0];
        return raw ? checkResultFromItem(raw) : undefined;
      }
      // A filter runs after each page is read, so keep reading pages until one matches.
      const base = newestFirst(tripId);
      let start: QueryCommandInput['ExclusiveStartKey'];
      do {
        const page = await doc.send(
          new QueryCommand({
            ...base,
            FilterExpression: '#kind = :kind',
            ExpressionAttributeNames: { '#kind': 'kind' },
            ExpressionAttributeValues: { ...base.ExpressionAttributeValues, ':kind': kind },
            ExclusiveStartKey: start,
          }),
        );
        const raw = page.Items?.[0];
        if (raw) return checkResultFromItem(raw);
        start = page.LastEvaluatedKey;
      } while (start);
      return undefined;
    },

    async setExplanation(ref, explanation, source) {
      try {
        await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(ref),
            UpdateExpression: 'SET explanation = :text, explanationSource = :source',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':text': explanation, ':source': source },
          }),
        );
        return true;
      } catch (err) {
        if (isConditionalCheckFailed(err)) return false;
        throw err;
      }
    },
  };
}
