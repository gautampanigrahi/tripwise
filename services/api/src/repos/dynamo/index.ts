import type { Repos } from '../interfaces.js';
import { dynamoCheckResultsRepo } from './checkResults.js';
import { dynamoContextFromEnv, type DynamoContext } from './client.js';
import { dynamoConstraintsRepo } from './constraints.js';
import { dynamoInvitationsRepo } from './invitations.js';
import { dynamoMembershipsRepo } from './memberships.js';
import { dynamoPlanItemsRepo } from './planItems.js';
import { dynamoTripsRepo } from './trips.js';

export { createDocumentClient, dynamoContextFromEnv, type DynamoContext } from './client.js';

/**
 * All repositories over the single table. None of the transactions use a ConditionCheck item,
 * so the IAM policy needs only GetItem, PutItem, UpdateItem, DeleteItem, Query and
 * TransactWriteItems (plus Query on the GSI1 index ARN).
 */
export function createDynamoRepos(ctx: DynamoContext = dynamoContextFromEnv()): Repos {
  return {
    trips: dynamoTripsRepo(ctx),
    memberships: dynamoMembershipsRepo(ctx),
    invitations: dynamoInvitationsRepo(ctx),
    constraints: dynamoConstraintsRepo(ctx),
    planItems: dynamoPlanItemsRepo(ctx),
    checkResults: dynamoCheckResultsRepo(ctx),
  };
}
