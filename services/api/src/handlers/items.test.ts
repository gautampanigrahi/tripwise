import type { Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createS3ConfirmationStore } from '../adapters/s3.js';
import { dispatch, type ApiEvent } from '../lib/routes.js';
import { createMemoryRepos } from '../repos/memory/index.js';
import { routes, type ItemsDeps } from './items.js';

const ITEMS = '/trips/{tripId}/sections/{section}/items';

async function setup() {
  const repos = createMemoryRepos();
  await repos.trips.create(
    {
      tripId: 't1',
      name: 'SD',
      destination: 'San Diego',
      startDate: '2025-06-01',
      endDate: '2025-06-05',
      hostId: 'host',
      createdAt: '2025-01-01T00:00:00Z',
    },
    { displayName: 'Host', email: 'host@example.com' },
  );
  await repos.invitations.create({
    tripId: 't1',
    inviteId: 'i1',
    email: 'm@example.com',
    invitedBy: 'host',
    createdAt: '2025-01-01T00:00:00Z',
  });
  await repos.invitations.accept({
    tripId: 't1',
    inviteId: 'i1',
    tripName: 'SD',
    member: { userId: 'member', displayName: 'M', email: 'm@example.com' },
    acceptedAt: '2025-01-01T00:00:00Z',
  });
  let tick = 0;
  let id = 0;
  const deps: ItemsDeps = {
    ...repos,
    now: () => `2025-02-01T00:00:0${tick++}.000Z`,
    newId: () => `item${++id}`,
    files: createS3ConfirmationStore(
      new S3Client({ region: 'us-west-2', credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret' } }),
      'data-bucket',
    ),
  };
  const handler = dispatch(routes, () => deps);
  const call = async (
    routeKey: string,
    sub: string,
    params: Record<string, string>,
    body?: unknown,
  ) => {
    const event = {
      routeKey,
      pathParameters: { tripId: 't1', ...params },
      body: body === undefined ? undefined : JSON.stringify(body),
      requestContext: {
        requestId: 'r1',
        authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` }, scopes: [] } },
      },
    } as unknown as ApiEvent;
    const res = await handler(event, {} as Context);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
  };
  return { call, repos };
}

describe('items handler', () => {
  it('creates, lists, updates, and deletes with stamping from the token', async () => {
    const { call } = await setup();
    const created = await call(`POST ${ITEMS}`, 'member', { section: 'Checklist' }, {
      fields: { task: 'Pack' },
      lastModifiedBy: 'evil',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      section: 'Checklist',
      fields: { task: 'Pack', done: false },
      lastModifiedBy: 'member',
    });

    const listed = await call(`GET ${ITEMS}`, 'host', { section: 'Checklist' });
    expect(listed.body.items).toEqual([created.body]);

    const updated = await call(`PUT ${ITEMS}/{itemId}`, 'host', { section: 'Checklist', itemId: 'item1' }, {
      fields: { task: 'Pack', done: true },
      expectedLastModifiedAt: created.body.lastModifiedAt,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ fields: { done: true }, lastModifiedBy: 'host', createdAt: created.body.createdAt });

    const stale = await call(`PUT ${ITEMS}/{itemId}`, 'member', { section: 'Checklist', itemId: 'item1' }, {
      fields: { task: 'Other' },
      expectedLastModifiedAt: created.body.lastModifiedAt,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: 'STALE', current: updated.body });

    expect((await call(`DELETE ${ITEMS}/{itemId}`, 'member', { section: 'Checklist', itemId: 'item1' })).status).toBe(204);
    expect((await call(`GET ${ITEMS}`, 'host', { section: 'Checklist' })).body.items).toEqual([]);
  });

  it('rejects unknown sections, invalid fields, and a missing expectedLastModifiedAt', async () => {
    const { call } = await setup();
    const unknown = await call(`GET ${ITEMS}`, 'host', { section: 'Nope' });
    expect(unknown).toEqual({ status: 400, body: { error: 'UNKNOWN_SECTION', section: 'Nope' } });

    const invalid = await call(`POST ${ITEMS}`, 'host', { section: 'Itinerary' }, {
      fields: { day: '2025-07-01', startTime: '10:00', stopName: 'Zoo' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.fields.map((f: { field: string }) => f.field)).toContain('day');

    const noExpected = await call(`PUT ${ITEMS}/{itemId}`, 'host', { section: 'Checklist', itemId: 'x' }, {
      fields: { task: 'A' },
    });
    expect(noExpected.status).toBe(400);
  });

  it('claims a Checklist item and returns ALREADY_CLAIMED for another member', async () => {
    const { call } = await setup();
    await call(`POST ${ITEMS}`, 'host', { section: 'Checklist' }, { fields: { task: 'Sunscreen' } });
    const claimKey = 'POST /trips/{tripId}/sections/Checklist/items/{itemId}/claim';

    const claimed = await call(claimKey, 'member', { itemId: 'item1' });
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({ fields: { claimedBy: 'member' }, lastModifiedBy: 'member' });

    const again = await call(claimKey, 'host', { itemId: 'item1' });
    expect(again).toEqual({ status: 409, body: { error: 'ALREADY_CLAIMED', claimedBy: 'member' } });
  });

  it('denies non-members', async () => {
    const { call } = await setup();
    const res = await call(`GET ${ITEMS}`, 'stranger', { section: 'Checklist' });
    expect(res).toEqual({ status: 403, body: { error: 'FORBIDDEN' } });
  });

  it('records the confirmation key on upload and presigns a 15-minute download', async () => {
    const { call, repos } = await setup();
    await repos.planItems.create({
      tripId: 't1',
      itemId: 'lodge1',
      section: 'Lodging',
      fields: { name: 'Inn', checkIn: '2025-06-01', checkOut: '2025-06-03' },
      createdAt: '2025-01-01T00:00:00Z',
      lastModifiedBy: 'host',
      lastModifiedAt: '2025-01-01T00:00:00Z',
    } as never);

    const missing = await call('GET /trips/{tripId}/items/{itemId}/confirmation', 'member', { itemId: 'lodge1' });
    expect(missing.status).toBe(404);

    const up = await call('POST /trips/{tripId}/items/{itemId}/confirmation-upload', 'member', { itemId: 'lodge1' }, {
      fileName: 'conf.pdf',
      contentType: 'application/pdf',
    });
    expect(up.status).toBe(200);
    expect(up.body.key).toMatch(/^private\/trips\/t1\/confirmations\/lodge1\/.+-conf\.pdf$/);
    expect(up.body.fields).toMatchObject({ key: up.body.key, 'Content-Type': 'application/pdf' });
    const policy = JSON.parse(Buffer.from(up.body.fields.Policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 10 * 1024 * 1024]);
    const stored = await repos.planItems.get('t1', 'Lodging', 'lodge1');
    expect(stored?.fields).toMatchObject({ confirmationKey: up.body.key });

    const down = await call('GET /trips/{tripId}/items/{itemId}/confirmation', 'host', { itemId: 'lodge1' });
    expect(down.status).toBe(200);
    expect(down.body.url).toContain('X-Amz-Expires=900');
    expect(down.body.url).toContain(encodeURI(up.body.key).replace(/\//g, '/'));
  });
});
