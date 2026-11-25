import {
  ConflictException,
  CreateScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { reminderAt } from '@tripwise/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../lib/logging.js';
import { upsertReminder } from './scheduler.js';

const FN = 'arn:aws:lambda:us-west-2:123456789012:function:reminder-fn';
const ROLE = 'arn:aws:iam::123456789012:role/scheduler-role';
const schedulerMock = mockClient(SchedulerClient);
const scheduler = new SchedulerClient({ region: 'us-west-2' });
const START = '2030-06-15';
const fireAt = reminderAt(START).instantMs;
const deps = (nowMs = fireAt - 86_400_000) => ({
  scheduler,
  now: () => nowMs,
  reminderFunctionArn: FN,
  schedulerRoleArn: ROLE,
});

const conflict = () => new ConflictException({ message: 'exists', Message: 'exists', $metadata: {} });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  schedulerMock.reset();
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('upsertReminder', () => {
  it('creates a one-time schedule 2 days before the start, deleted after completion (Req 24.2)', async () => {
    schedulerMock.on(CreateScheduleCommand).resolves({ ScheduleArn: 'arn:s' });
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps())).resolves.toBe('CREATED');
    const calls = schedulerMock.commandCalls(CreateScheduleCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({
      Name: 'trip-reminder-t1',
      ScheduleExpression: 'at(2030-06-13T09:00:00)',
      ScheduleExpressionTimezone: 'America/Los_Angeles',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: { Arn: FN, RoleArn: ROLE, Input: JSON.stringify({ tripId: 't1' }) },
    });
    expect(schedulerMock.commandCalls(UpdateScheduleCommand)).toHaveLength(0);
  });

  it('falls back to UpdateSchedule with the same parameters on ConflictException', async () => {
    schedulerMock.on(CreateScheduleCommand).rejects(conflict());
    schedulerMock.on(UpdateScheduleCommand).resolves({ ScheduleArn: 'arn:s' });
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps())).resolves.toBe('UPDATED');
    const create = schedulerMock.commandCalls(CreateScheduleCommand)[0]!.args[0].input;
    const update = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(update).toHaveLength(1);
    expect(update[0]!.args[0].input).toEqual(create);
    expect(update[0]!.args[0].input.ActionAfterCompletion).toBe('DELETE');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('skips scheduling when the reminder time is not in the future', async () => {
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps(fireAt))).resolves.toBe('SKIPPED_PAST');
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps(fireAt + 1))).resolves.toBe('SKIPPED_PAST');
    expect(schedulerMock.calls()).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('schedules when the clock is 1 ms before the reminder time', async () => {
    schedulerMock.on(CreateScheduleCommand).resolves({});
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps(fireAt - 1))).resolves.toBe('CREATED');
  });

  it('logs SCHEDULE_FAILED and does not throw on other errors', async () => {
    schedulerMock.on(CreateScheduleCommand).rejects(new Error('AccessDenied'));
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps())).resolves.toBe('FAILED');
    expect(schedulerMock.commandCalls(UpdateScheduleCommand)).toHaveLength(0);
    expect(errorSpy.mock.calls[0]![1]).toMatchObject({ event: 'SCHEDULE_FAILED', tripId: 't1' });
  });

  it('logs SCHEDULE_FAILED when the fallback update also fails', async () => {
    schedulerMock.on(CreateScheduleCommand).rejects(conflict());
    schedulerMock.on(UpdateScheduleCommand).rejects(new Error('boom'));
    await expect(upsertReminder({ tripId: 't1', startDate: START }, deps())).resolves.toBe('FAILED');
    expect(errorSpy.mock.calls[0]![1]).toMatchObject({ event: 'SCHEDULE_FAILED', tripId: 't1' });
  });
});
