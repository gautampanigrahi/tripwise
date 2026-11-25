import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ChecklistItem, LodgingItem, PlanItem, Section } from '@tripwise/shared';
import type { PlanItemsRepo } from '../interfaces.js';
import { itemPrefix, itemSk, tripPk } from '../keys.js';
import { isConditionalCheckFailed, queryAll, type DynamoContext } from './client.js';
import { planItemFromItem, planItemToItem, splitServerOwned } from './items.js';

export function dynamoPlanItemsRepo({ doc, tableName }: DynamoContext): PlanItemsRepo {
  const key = (tripId: string, section: Section, itemId: string) => ({
    PK: tripPk(tripId),
    SK: itemSk(section, itemId),
  });

  const get = async (tripId: string, section: Section, itemId: string): Promise<PlanItem | undefined> => {
    const res = await doc.send(
      new GetCommand({ TableName: tableName, Key: key(tripId, section, itemId), ConsistentRead: true }),
    );
    return res.Item ? planItemFromItem(res.Item) : undefined;
  };

  return {
    // Req 5.4: follows LastEvaluatedKey until the whole section is read.
    async list(tripId, section) {
      const items = await queryAll(doc, {
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': tripPk(tripId), ':prefix': itemPrefix(section) },
        ConsistentRead: true,
      });
      return items.map(planItemFromItem);
    },

    get,

    async create(item) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: planItemToItem(item),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },

    // Req 23.3: `SET fields` replaces only the client-editable map. Server-owned fields live in
    // top-level attributes (see items.ts), so they keep their stored values.
    async update(next, expectedLastModifiedAt) {
      const { fields } = splitServerOwned(next.fields);
      try {
        const res = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(next.tripId, next.section, next.itemId),
            UpdateExpression: 'SET #fields = :fields, lastModifiedBy = :by, lastModifiedAt = :at',
            ConditionExpression: 'attribute_exists(PK) AND lastModifiedAt = :expected',
            ExpressionAttributeNames: { '#fields': 'fields' },
            ExpressionAttributeValues: {
              ':fields': fields,
              ':by': next.lastModifiedBy,
              ':at': next.lastModifiedAt,
              ':expected': expectedLastModifiedAt,
            },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return { ok: true, item: planItemFromItem(res.Attributes ?? {}) };
      } catch (err) {
        if (!isConditionalCheckFailed(err)) throw err;
        const current = await get(next.tripId, next.section, next.itemId);
        return current ? { ok: false, reason: 'STALE', current } : { ok: false, reason: 'NOT_FOUND' };
      }
    },

    async delete(tripId, section, itemId) {
      const res = await doc.send(
        new DeleteCommand({ TableName: tableName, Key: key(tripId, section, itemId), ReturnValues: 'ALL_OLD' }),
      );
      return res.Attributes !== undefined;
    },

    // Req 9.2, 9.4: same rule as the shared `claim` model.
    async claim(tripId, itemId, meta) {
      try {
        const res = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(tripId, 'Checklist', itemId),
            UpdateExpression: 'SET claimedBy = :caller, lastModifiedBy = :caller, lastModifiedAt = :at',
            ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(claimedBy) OR claimedBy = :caller)',
            ExpressionAttributeValues: { ':caller': meta.lastModifiedBy, ':at': meta.lastModifiedAt },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return { ok: true, item: planItemFromItem(res.Attributes ?? {}) as ChecklistItem };
      } catch (err) {
        if (!isConditionalCheckFailed(err)) throw err;
        const current = await get(tripId, 'Checklist', itemId);
        if (!current) return { ok: false, reason: 'NOT_FOUND' };
        const claimedBy = current.fields.claimedBy;
        // The condition failed, so the item must be claimed by someone else.
        if (typeof claimedBy !== 'string') throw err;
        return { ok: false, reason: 'ALREADY_CLAIMED', claimedBy };
      }
    },

    async setConfirmationKey(tripId, itemId, confirmationKey) {
      try {
        const res = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(tripId, 'Lodging', itemId),
            UpdateExpression: 'SET confirmationKey = :key',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':key': confirmationKey },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return planItemFromItem(res.Attributes ?? {}) as LodgingItem;
      } catch (err) {
        if (isConditionalCheckFailed(err)) return undefined;
        throw err;
      }
    },
  };
}
