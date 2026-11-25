import { describe, expect, it } from 'vitest';
import {
  checkResultMessage,
  inviteMessage,
  reminderAt,
  reminderMessage,
  reminderScheduleName,
} from './notify.js';

describe('message builders', () => {
  it('invite message contains the trip name and accept link', () => {
    const m = inviteMessage('Tahoe Weekend', 'https://app.example.com/invitations/abc/accept');
    expect(m.subject).toContain('Tahoe Weekend');
    expect(m.body).toContain('Tahoe Weekend');
    expect(m.body).toContain('https://app.example.com/invitations/abc/accept');
  });

  it('check-result message contains the trip name, score, and label', () => {
    const m = checkResultMessage('Tahoe Weekend', 67, 'Not feasible');
    expect(m.body).toContain('Tahoe Weekend');
    expect(m.body).toContain('67%');
    expect(m.body).toContain('Not feasible');
  });

  it('reminder message contains the trip name and start date', () => {
    const m = reminderMessage('Tahoe Weekend', '2025-07-04');
    expect(m.body).toContain('Tahoe Weekend');
    expect(m.body).toContain('2025-07-04');
  });

  it('subject is a single line within the SNS 100-character limit', () => {
    const m = inviteMessage(`Long\nname ${'x'.repeat(200)}`, 'https://a.example');
    expect(m.subject).not.toMatch(/\n/);
    expect(m.subject.length).toBeLessThanOrEqual(100);
  });
});

describe('reminderAt', () => {
  it('is 09:00 Los Angeles time 2 days before the start date (PDT)', () => {
    const r = reminderAt('2025-07-04');
    expect(r.localDateTime).toBe('2025-07-02T09:00:00');
    expect(r.scheduleExpression).toBe('at(2025-07-02T09:00:00)');
    expect(r.timezone).toBe('America/Los_Angeles');
    expect(r.instantMs).toBe(Date.parse('2025-07-02T16:00:00Z'));
  });

  it('uses the PST offset in winter', () => {
    expect(reminderAt('2025-01-10').instantMs).toBe(Date.parse('2025-01-08T17:00:00Z'));
  });

  it('crosses month, year, and leap-day boundaries', () => {
    expect(reminderAt('2025-03-01').localDateTime).toBe('2025-02-27T09:00:00');
    expect(reminderAt('2024-03-01').localDateTime).toBe('2024-02-28T09:00:00');
    expect(reminderAt('2026-01-01').localDateTime).toBe('2025-12-30T09:00:00');
  });

  it('handles the days around DST transitions', () => {
    // DST starts 2025-03-09 and ends 2025-11-02 in Los Angeles.
    expect(reminderAt('2025-03-11').instantMs).toBe(Date.parse('2025-03-09T16:00:00Z'));
    expect(reminderAt('2025-11-04').instantMs).toBe(Date.parse('2025-11-02T17:00:00Z'));
  });
});

describe('reminderScheduleName', () => {
  it('depends only on tripId', () => {
    expect(reminderScheduleName('t1')).toBe('trip-reminder-t1');
    expect(reminderScheduleName('t1')).toBe(reminderScheduleName('t1'));
    expect(reminderScheduleName('t2')).not.toBe(reminderScheduleName('t1'));
  });
});
