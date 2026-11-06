import { describe, expect, it } from 'vitest';
import {
  createReminder,
  editReminder,
  fireTime,
  isDue,
  nextUpcomingReminder,
  reactivateReminder,
  reconcileReminder,
  ReminderValidationError,
  rescheduleReminder,
  resolveReminder,
  snoozeReminder,
} from '@/features/reminders/services/reminderLogic';
import { at } from './helpers';

const NOW = at('2026-10-26', '08:00');

describe('creating reminders', () => {
  it('creates a one-time reminder for a future time', () => {
    const r = createReminder({ title: '  Call Sam  ', date: '2026-10-26', time: '10:00' }, NOW);
    expect(r.title).toBe('Call Sam');
    expect(r.occurrence).toBe('2026-10-26T10:00');
    expect(r.status).toBe('active');
    expect(fireTime(r)).toBe(at('2026-10-26', '10:00'));
  });

  it('rejects empty titles, bad dates, unsafe links and past one-time times', () => {
    expect(() => createReminder({ title: ' ', date: '2026-10-26', time: '10:00' }, NOW)).toThrow(ReminderValidationError);
    expect(() => createReminder({ title: 'x', date: '2026-02-30', time: '10:00' }, NOW)).toThrow(/valid date/);
    expect(() => createReminder({ title: 'x', date: '2026-10-26', time: '25:00' }, NOW)).toThrow(/valid time/);
    expect(() => createReminder({ title: 'x', date: '2026-10-26', time: '07:00' }, NOW)).toThrow(/already passed/);
    expect(() =>
      createReminder({ title: 'x', date: '2026-10-27', time: '07:00', url: 'javascript:alert(1)' }, NOW),
    ).toThrow(/http/);
  });

  it('starts a recurring series that began in the past at its next occurrence', () => {
    const r = createReminder({ title: 'Stand-up', date: '2026-10-01', time: '07:30', recurrence: 'daily' }, NOW);
    expect(r.anchorDate).toBe('2026-10-01');
    expect(r.occurrence).toBe('2026-10-27T07:30');
  });
});

describe('editing and rescheduling', () => {
  const base = createReminder({ title: 'Pay rent', date: '2026-10-27', time: '09:00' }, NOW);

  it('keeps schedule state when only text changes', () => {
    const notified = { ...base, notifiedKey: 'k' };
    const edited = editReminder(notified, { title: 'Pay the rent', date: '2026-10-27', time: '09:00' }, NOW);
    expect(edited.title).toBe('Pay the rent');
    expect(edited.notifiedKey).toBe('k');
  });

  it('resets snooze and notification state when the time changes', () => {
    const snoozed = { ...snoozeReminder({ ...base, notifiedKey: 'k' }, 10, NOW) };
    const moved = rescheduleReminder(snoozed, '2026-10-28', '11:00', NOW);
    expect(moved.occurrence).toBe('2026-10-28T11:00');
    expect(moved.snoozedUntil).toBeNull();
    expect(moved.notifiedKey).toBeNull();
  });
});

describe('snooze', () => {
  it('moves the fire time and re-arms a single notification', () => {
    const r = createReminder({ title: 'Stretch', date: '2026-10-26', time: '08:30' }, NOW);
    const t = at('2026-10-26', '08:30');
    const first = reconcileReminder(r, t);
    expect(first.notify).toBe(true);
    const snoozed = snoozeReminder(first.reminder, 5, t + 1000);
    expect(isDue(snoozed, t + 2000)).toBe(false);
    const quiet = reconcileReminder(snoozed, t + 2000);
    expect(quiet.notify).toBe(false);
    expect(quiet.alarmAt).toBe(t + 1000 + 5 * 60_000);
    const again = reconcileReminder(quiet.reminder, t + 1000 + 5 * 60_000);
    expect(again.notify).toBe(true);
    expect(reconcileReminder(again.reminder, t + 7 * 60_000).notify).toBe(false);
  });

  it('rejects silly snooze lengths', () => {
    const r = createReminder({ title: 'x', date: '2026-10-27', time: '09:00' }, NOW);
    expect(() => snoozeReminder(r, 0, NOW)).toThrow();
    expect(() => snoozeReminder(r, -5, NOW)).toThrow();
  });
});

describe('reconcile', () => {
  it('notifies exactly once per occurrence (duplicate prevention)', () => {
    const r = createReminder({ title: 'Water plants', date: '2026-10-26', time: '09:00' }, NOW);
    const due = at('2026-10-26', '09:00');
    const a = reconcileReminder(r, due);
    expect(a.notify).toBe(true);
    const b = reconcileReminder(a.reminder, due + 30_000);
    expect(b.notify).toBe(false);
    expect(b.changed).toBe(false);
    expect(b.alarmAt).toBeNull();
  });

  it('schedules an alarm for future reminders without notifying', () => {
    const r = createReminder({ title: 'Later', date: '2026-10-26', time: '12:00' }, NOW);
    const res = reconcileReminder(r, NOW);
    expect(res.notify).toBe(false);
    expect(res.alarmAt).toBe(at('2026-10-26', '12:00'));
  });

  it('flags a reminder that was due while Chrome was closed as missed, once', () => {
    const r = createReminder({ title: 'Submit form', date: '2026-10-26', time: '09:00' }, NOW);
    const res = reconcileReminder(r, at('2026-10-26', '15:00'));
    expect(res.notify).toBe(true);
    expect(res.missed).toBe(true);
    expect(reconcileReminder(res.reminder, at('2026-10-26', '15:05')).notify).toBe(false);
  });

  it('collapses a backlog of missed recurring occurrences into one catch-up', () => {
    const r = createReminder({ title: 'Vitamins', date: '2026-10-26', time: '09:00', recurrence: 'daily' }, NOW);
    // Browser closed for four days.
    const res = reconcileReminder(r, at('2026-10-30', '12:00'));
    expect(res.notify).toBe(true);
    expect(res.reminder.occurrence).toBe('2026-10-30T09:00');
    expect(res.reminder.history).toEqual([{ occurrence: '2026-10-26T09:00', outcome: 'missed', at: at('2026-10-30', '12:00') }]);
    // While ringing, the next alarm is the next day's occurrence.
    expect(res.alarmAt).toBe(at('2026-10-31', '09:00'));
  });

  it('rolls an ignored recurring reminder over to the next occurrence', () => {
    const r = createReminder({ title: 'Journal', date: '2026-10-26', time: '09:00', recurrence: 'daily' }, NOW);
    const rang = reconcileReminder(r, at('2026-10-26', '09:00')).reminder;
    const next = reconcileReminder(rang, at('2026-10-27', '09:00'));
    expect(next.reminder.occurrence).toBe('2026-10-27T09:00');
    expect(next.notify).toBe(true);
    expect(next.missed).toBe(false);
  });

  it('ignores reminders that are done or dismissed', () => {
    const r = resolveReminder(createReminder({ title: 'x', date: '2026-10-26', time: '09:00' }, NOW), 'done', NOW);
    const res = reconcileReminder(r, at('2026-10-26', '10:00'));
    expect(res).toMatchObject({ notify: false, alarmAt: null, changed: false });
  });

  it('honours a changed time zone because occurrences are stored as local time', () => {
    const r = createReminder({ title: 'Call home', date: '2026-10-27', time: '10:00' }, NOW);
    const ny = reconcileReminder(r, NOW).alarmAt;
    const prevTz = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      const london = reconcileReminder(r, NOW).alarmAt;
      // 10:00 in London is earlier (in absolute time) than 10:00 in New York.
      expect(london).not.toBe(ny);
      expect(new Date(london!).getHours()).toBe(10);
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

describe('resolving occurrences', () => {
  it('finishes one-time reminders', () => {
    const r = createReminder({ title: 'x', date: '2026-10-26', time: '09:00' }, NOW);
    expect(resolveReminder(r, 'done', NOW).status).toBe('done');
    expect(resolveReminder(r, 'dismissed', NOW).status).toBe('dismissed');
  });

  it('advances recurring reminders to their next occurrence and records history', () => {
    const r = createReminder({ title: 'Rent', date: '2026-01-31', time: '09:00', recurrence: 'monthly' }, at('2026-01-01'));
    const next = resolveReminder({ ...r, snoozedUntil: 123 }, 'done', at('2026-01-31', '09:05'));
    expect(next.status).toBe('active');
    expect(next.occurrence).toBe('2026-02-28T09:00');
    expect(next.snoozedUntil).toBeNull();
    expect(next.history.at(-1)).toMatchObject({ occurrence: '2026-01-31T09:00', outcome: 'done' });
    expect(resolveReminder(next, 'done', at('2026-02-28', '10:00')).occurrence).toBe('2026-03-31T09:00');
  });

  it('reactivates a finished recurring reminder at its next future occurrence', () => {
    const r = createReminder({ title: 'x', date: '2026-10-20', time: '09:00', recurrence: 'weekly' }, at('2026-10-19'));
    const stopped = { ...r, status: 'dismissed' as const };
    expect(reactivateReminder(stopped, NOW).occurrence).toBe('2026-10-27T09:00');
  });

  it('picks the next upcoming (not-yet-due) reminder', () => {
    const a = createReminder({ title: 'a', date: '2026-10-26', time: '09:00' }, NOW);
    const b = createReminder({ title: 'b', date: '2026-10-26', time: '11:00' }, NOW);
    expect(nextUpcomingReminder([b, a], NOW)?.title).toBe('a');
    expect(nextUpcomingReminder([b, a], at('2026-10-26', '09:30'))?.title).toBe('b');
  });
});
