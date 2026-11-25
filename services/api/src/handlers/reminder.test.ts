import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { reminderMessage } from '@tripwise/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../repos/memory/index.js';
import { sendReminders } from './reminder.js';

const snsMock = mockClient(SNSClient);
const notify = { sns: new SNSClient({ region: 'us-west-2' }), topicArn: 'arn:aws:sns:us-west-2:1:topic' };

beforeEach(() => {
  snsMock.reset();
  snsMock.on(PublishCommand).resolves({});
});

describe('reminder handler', () => {
  it('publishes the reminder to every Member', async () => {
    const repos = createMemoryRepos();
    const trip = {
      tripId: 't1',
      name: 'Tahoe Weekend',
      destination: 'Tahoe',
      startDate: '2025-07-04',
      endDate: '2025-07-06',
      hostId: 'u1',
      createdAt: '2025-01-01T00:00:00.000Z',
    };
    await repos.trips.create(trip, { displayName: 'Host', email: 'host@example.com' });
    await repos.invitations.create({ tripId: 't1', inviteId: 'i1', email: 'guest@example.com', invitedBy: 'u1', createdAt: 'x' });
    await repos.invitations.accept({
      tripId: 't1',
      inviteId: 'i1',
      tripName: trip.name,
      member: { userId: 'u2', displayName: 'Guest', email: 'guest@example.com' },
      acceptedAt: 'y',
    });

    await sendReminders({ tripId: 't1' }, { repos, notify });

    const expected = reminderMessage(trip.name, trip.startDate);
    const inputs = snsMock.commandCalls(PublishCommand).map((c) => c.args[0].input);
    expect(inputs.map((i) => i.MessageAttributes?.recipient?.StringValue)).toEqual([
      'host@example.com',
      'guest@example.com',
    ]);
    for (const i of inputs) {
      expect(i.Subject).toBe(expected.subject);
      expect(i.Message).toBe(expected.body);
    }
  });

  it('publishes nothing when the trip is gone', async () => {
    await sendReminders({ tripId: 'missing' }, { repos: createMemoryRepos(), notify });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});
