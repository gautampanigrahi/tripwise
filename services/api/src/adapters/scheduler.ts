import {
  ConflictException,
  CreateScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
  type CreateScheduleCommandInput,
} from '@aws-sdk/client-scheduler';
import { reminderAt, reminderScheduleName, type IsoDate } from '@tripwise/shared';
import { log } from '../lib/logging.js';

export interface SchedulerDeps {
  scheduler?: Pick<SchedulerClient, 'send'>;
  /** Clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Defaults to `process.env.REMINDER_FUNCTION_ARN`. */
  reminderFunctionArn?: string;
  /** Defaults to `process.env.SCHEDULER_ROLE_ARN`. */
  schedulerRoleArn?: string;
}

export type UpsertOutcome = 'CREATED' | 'UPDATED' | 'SKIPPED_PAST' | 'FAILED';

let defaultClient: SchedulerClient | undefined;

/**
 * Creates or updates the single pre-trip reminder schedule `trip-reminder-{tripId}` that fires at
 * 09:00 America/Los_Angeles 2 days before `startDate` and invokes `reminder-fn` with `{ tripId }`
 * (Req 24.2). Tries `CreateSchedule` first and falls back to `UpdateSchedule` on
 * `ConflictException`. If the fire time is not in the future, nothing is scheduled.
 * Best effort: on any other error it logs `{ event: 'SCHEDULE_FAILED', tripId }` and returns
 * `'FAILED'` instead of throwing, so the Trip save still succeeds.
 */
export async function upsertReminder(
  input: { tripId: string; startDate: IsoDate },
  deps: SchedulerDeps = {},
): Promise<UpsertOutcome> {
  const { tripId, startDate } = input;
  try {
    const at = reminderAt(startDate);
    const now = (deps.now ?? Date.now)();
    if (at.instantMs <= now) return 'SKIPPED_PAST';

    const functionArn = deps.reminderFunctionArn ?? process.env.REMINDER_FUNCTION_ARN;
    const roleArn = deps.schedulerRoleArn ?? process.env.SCHEDULER_ROLE_ARN;
    if (!functionArn || !roleArn) throw new Error('REMINDER_FUNCTION_ARN or SCHEDULER_ROLE_ARN is not configured');

    const scheduler = deps.scheduler ?? (defaultClient ??= new SchedulerClient({}));
    const params: CreateScheduleCommandInput = {
      Name: reminderScheduleName(tripId),
      ScheduleExpression: at.scheduleExpression,
      ScheduleExpressionTimezone: at.timezone,
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: { Arn: functionArn, RoleArn: roleArn, Input: JSON.stringify({ tripId }) },
    };
    try {
      await scheduler.send(new CreateScheduleCommand(params));
      return 'CREATED';
    } catch (err) {
      if (!isConflict(err)) throw err;
      await scheduler.send(new UpdateScheduleCommand(params));
      return 'UPDATED';
    }
  } catch (err) {
    const error = err instanceof Error ? { name: err.name, message: err.message } : { name: 'Unknown', message: String(err) };
    log.error('Reminder schedule failed', { event: 'SCHEDULE_FAILED', tripId, error });
    return 'FAILED';
  }
}

function isConflict(err: unknown): boolean {
  return err instanceof ConflictException || (err instanceof Error && err.name === 'ConflictException');
}
