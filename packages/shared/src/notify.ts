import type { IsoDate } from './types.js';
import { toEpochDay } from './dates.js';

/** Plain-text SNS message: `subject` is the email subject, `body` the email text. */
export interface NotificationMessage {
  subject: string;
  body: string;
}

/** SNS limits a subject to 100 characters on one line. */
const SUBJECT_MAX = 100;

/** Collapses whitespace (including newlines) and truncates to the SNS subject limit. */
function subjectLine(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= SUBJECT_MAX ? oneLine : `${oneLine.slice(0, SUBJECT_MAX - 3)}...`;
}

/** Invite alert with the Trip name and accept link (Req 3.2). */
export function inviteMessage(tripName: string, acceptUrl: string): NotificationMessage {
  return {
    subject: subjectLine(`You're invited to ${tripName} on TripWise`),
    body: `You have been invited to join the trip "${tripName}" on TripWise.\n\nAccept the invitation: ${acceptUrl}\n`,
  };
}

/** Check-result alert with the Trip name, Feasibility_Score (whole percent), and label (Req 24.1). */
export function checkResultMessage(tripName: string, score: number, label: string): NotificationMessage {
  return {
    subject: subjectLine(`${tripName}: ${label} (${score}%)`),
    body: `A new feasibility check finished for "${tripName}".\n\nFeasibility score: ${score}%\nResult: ${label}\n`,
  };
}

/** Pre-trip reminder with the Trip name and start date (Req 24.3). */
export function reminderMessage(tripName: string, startDate: IsoDate): NotificationMessage {
  return {
    subject: subjectLine(`Reminder: ${tripName} starts ${startDate}`),
    body: `Your trip "${tripName}" starts on ${startDate}.\n\nOpen TripWise to review the plan before you go.\n`,
  };
}

export const REMINDER_TIMEZONE = 'America/Los_Angeles';
export const REMINDER_DAYS_BEFORE = 2;
export const REMINDER_LOCAL_TIME = '09:00:00';

export interface ReminderTime {
  /** Wall-clock time in `REMINDER_TIMEZONE`, `YYYY-MM-DDT09:00:00`. */
  localDateTime: string;
  /** IANA time zone for `ScheduleExpressionTimezone`. */
  timezone: typeof REMINDER_TIMEZONE;
  /** EventBridge Scheduler one-time expression, `at(YYYY-MM-DDT09:00:00)`. */
  scheduleExpression: string;
  /** The same moment as UTC epoch milliseconds, so the handler can skip past times. */
  instantMs: number;
}

const MS_PER_DAY = 86_400_000;

/** Epoch day back to `YYYY-MM-DD` (UTC, so no local-zone drift). */
function fromEpochDay(day: number): IsoDate {
  const dt = new Date(day * MS_PER_DAY);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const tzFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: REMINDER_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of `REMINDER_TIMEZONE` from UTC at instant `ms`, in milliseconds (local − UTC). */
function zoneOffsetMs(ms: number): number {
  const parts: Record<string, number> = {};
  for (const p of tzFormatter.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(parts.year!, parts.month! - 1, parts.day!);
  asUtc.setUTCHours(parts.hour!, parts.minute!, parts.second!, 0);
  // The formatter drops milliseconds, so compare against the instant floored to the second.
  return asUtc.getTime() - Math.floor(ms / 1000) * 1000;
}

/**
 * Reminder fire time: 09:00 in America/Los_Angeles, 2 calendar days before `startDate` (Req 24.2).
 * 09:00 never falls in a DST gap or overlap, so the UTC instant is unique.
 */
export function reminderAt(startDate: IsoDate): ReminderTime {
  const day = fromEpochDay(toEpochDay(startDate) - REMINDER_DAYS_BEFORE);
  const localDateTime = `${day}T${REMINDER_LOCAL_TIME}`;
  // Wall-clock 09:00 interpreted as UTC, then corrected by the zone offset (twice, to settle across DST).
  const wallAsUtc = toEpochDay(day) * MS_PER_DAY + 9 * 3_600_000;
  let instantMs = wallAsUtc - zoneOffsetMs(wallAsUtc);
  instantMs = wallAsUtc - zoneOffsetMs(instantMs);
  return {
    localDateTime,
    timezone: REMINDER_TIMEZONE,
    scheduleExpression: `at(${localDateTime})`,
    instantMs,
  };
}

/** One schedule per Trip: the name depends only on `tripId` (Req 24.2). */
export function reminderScheduleName(tripId: string): string {
  return `trip-reminder-${tripId}`;
}
