import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export type DynamoItem = Record<string, unknown>;

/** What every DynamoDB repository needs: the document client and the table/index names. */
export interface DynamoContext {
  doc: DynamoDBDocumentClient;
  tableName: string;
  gsi1Name: string;
}

/** Document client that drops `undefined` attributes (optional fields) instead of failing. */
export function createDocumentClient(client: DynamoDBClient = new DynamoDBClient({})): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

/** Reads `TABLE_NAME` and `GSI1_NAME` (set by infra on every table-using function). */
export function dynamoContextFromEnv(
  env: Record<string, string | undefined> = process.env,
  doc: DynamoDBDocumentClient = createDocumentClient(),
): DynamoContext {
  const tableName = env.TABLE_NAME;
  if (!tableName) throw new Error('TABLE_NAME is not set');
  return { doc, tableName, gsi1Name: env.GSI1_NAME || 'GSI1' };
}

/** Runs a Query and follows `LastEvaluatedKey` until every page is read (Req 5.4). */
export async function queryAll(doc: DynamoDBDocumentClient, input: QueryCommandInput): Promise<DynamoItem[]> {
  const items: DynamoItem[] = [];
  let start: QueryCommandInput['ExclusiveStartKey'];
  do {
    const page = await doc.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
    items.push(...((page.Items ?? []) as DynamoItem[]));
    start = page.LastEvaluatedKey;
  } while (start);
  return items;
}

const errorName = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : undefined;

export function isConditionalCheckFailed(err: unknown): boolean {
  return errorName(err) === 'ConditionalCheckFailedException';
}

/**
 * For a `TransactionCanceledException`, the cancellation code of each transaction item in order
 * (`'None'` for items that did not fail). Returns undefined for any other error.
 */
export function cancellationCodes(err: unknown): string[] | undefined {
  if (errorName(err) !== 'TransactionCanceledException') return undefined;
  const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? [];
  return reasons.map((r) => r.Code ?? 'None');
}
