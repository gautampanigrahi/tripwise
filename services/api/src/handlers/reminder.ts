import { reminderMessage } from '@tripwise/shared';
import { safePublish, type NotifyDeps } from '../adapters/notify.js';
import { log } from '../lib/logging.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';
import type { Repos } from '../repos/interfaces.js';

/**
 * reminder-fn (Req 24.3). Invoked by EventBridge Scheduler with `{ tripId }` 2 days before the
 * trip starts; publishes the reminder to every Member. Publishing is best effort per recipient.
 */
export interface ReminderEvent {
  tripId: string;
}

export interface ReminderDeps {
  repos?: Pick<Repos, 'trips' | 'memberships'>;
  notify?: NotifyDeps;
}

export async function sendReminders(event: ReminderEvent, deps: ReminderDeps = {}): Promise<void> {
  const repos = deps.repos ?? (defaultRepos ??= createDynamoRepos());
  const { tripId } = event;
  const trip = await repos.trips.get(tripId);
  if (!trip) {
    log.warn('Trip not found for reminder', { event: 'REMINDER_TRIP_MISSING', tripId });
    return;
  }
  const message = reminderMessage(trip.name, trip.startDate);
  const members = await repos.memberships.listByTrip(tripId);
  for (const m of members) {
    await safePublish({ tripId, kind: 'REMINDER', recipient: m.email, message }, deps.notify);
  }
}

let defaultRepos: Repos | undefined;

export const handler = (event: ReminderEvent): Promise<void> => sendReminders(event);
