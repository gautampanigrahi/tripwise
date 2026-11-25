import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import type { ApiEvent } from '../lib/routes.js';
import { createMemoryRepos } from '../repos/memory/index.js';
import { createHandler, type InvitesDeps } from './invites.js';

const ctx = { awsRequestId: 'req' } as Context;

function event(
  routeKey: string,
  sub: string,
  email: string,
  opts: { path?: Record<string, string>; body?: unknown; verified?: boolean } = {},
): ApiEvent {
  return {
    routeKey,
    pathParameters: opts.path ?? {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    requestContext: {
      requestId: 'req',
      authorizer: { jwt: { claims: { sub, email, email_verified: String(opts.verified ?? true) }, scopes: [] } },
    },
  } as unknown as ApiEvent;
}

async function setup() {
  const repos = createMemoryRepos();
  await repos.trips.create(
    {
      tripId: 't1',
      name: 'San Diego',
      destination: 'San Diego',
      startDate: '2025-06-01',
      endDate: '2025-06-05',
      hostId: 'host',
      createdAt: '2025-01-01T00:00:00Z',
    },
    { displayName: 'Host', email: 'host@example.com' },
  );
  const sent: Array<{ input: Record<string, unknown> }> = [];
  const deps: InvitesDeps = {
    ...repos,
    notify: { topicArn: 'arn:topic', sns: { send: async (cmd: unknown) => void sent.push(cmd as never) } as never },
    appUrl: 'https://app.example.com',
    now: () => '2025-02-01T00:00:00Z',
  };
  const handler = createHandler(() => deps);
  const invite = (sub: string, email: unknown) =>
    handler(
      event('POST /trips/{tripId}/invitations', sub, `${sub}@example.com`, { path: { tripId: 't1' }, body: { email } }),
      ctx,
    );
  const accept = (inviteId: string, sub: string, email: string, verified = true) =>
    handler(event('POST /invitations/{inviteId}/accept', sub, email, { path: { inviteId }, verified }), ctx);
  return { repos, sent, invite, accept };
}

describe('invites handler', () => {
  it('Host invite stores a pending lowercase invitation and publishes an accept link (Req 3.1, 3.2)', async () => {
    const { repos, sent, invite } = await setup();
    const res = await invite('host', '  Friend@Example.COM ');
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ tripId: 't1', email: 'friend@example.com', status: 'pending' });
    expect(await repos.invitations.get(body.inviteId)).toMatchObject({ status: 'pending', invitedBy: 'host' });
    expect(sent).toHaveLength(2); // subscribe + publish
    const publish = sent[1]!.input as { Message: string; MessageAttributes: { recipient: { StringValue: string } } };
    expect(publish.Message).toContain('San Diego');
    expect(publish.Message).toContain(`https://app.example.com/invitations/${body.inviteId}/accept`);
    expect(publish.MessageAttributes.recipient.StringValue).toBe('friend@example.com');
  });

  it('rejects a non-Host invite with 403 and a bad email with 400 (Req 3.4)', async () => {
    const { repos, invite } = await setup();
    const inv = await repos.invitations.create({
      tripId: 't1',
      inviteId: 'i0',
      email: 'm@example.com',
      invitedBy: 'host',
      createdAt: 'x',
    });
    await repos.invitations.accept({
      tripId: 't1',
      inviteId: inv.inviteId,
      tripName: 'San Diego',
      member: { userId: 'm', displayName: 'm', email: 'm@example.com' },
      acceptedAt: 'x',
    });
    expect((await invite('m', 'x@example.com')).statusCode).toBe(403);
    expect((await invite('stranger', 'x@example.com')).statusCode).toBe(403);
    expect((await invite('host', 'not-an-email')).statusCode).toBe(400);
  });

  it('matching verified email accepts and becomes a Member (Req 3.3)', async () => {
    const { repos, invite, accept } = await setup();
    const { inviteId } = JSON.parse((await invite('host', 'friend@example.com')).body);
    const res = await accept(inviteId, 'friend', 'Friend@example.com');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ tripId: 't1' });
    expect(await repos.memberships.get('t1', 'friend')).toMatchObject({ role: 'member' });
    expect(await repos.invitations.get(inviteId)).toMatchObject({ status: 'accepted', acceptedBy: 'friend' });
  });

  it('wrong or unverified email gets 403 and leaves Memberships unchanged (Req 3.5)', async () => {
    const { repos, invite, accept } = await setup();
    const { inviteId } = JSON.parse((await invite('host', 'friend@example.com')).body);
    const wrong = await accept(inviteId, 'other', 'other@example.com');
    const unverified = await accept(inviteId, 'friend', 'friend@example.com', false);
    expect(wrong.statusCode).toBe(403);
    expect(JSON.parse(wrong.body)).toEqual({ error: 'INVITE_EMAIL_MISMATCH' });
    expect(unverified.statusCode).toBe(403);
    expect((await repos.memberships.listByTrip('t1')).map((m) => m.userId)).toEqual(['host']);
    expect(await repos.invitations.get(inviteId)).toMatchObject({ status: 'pending' });
  });
});
