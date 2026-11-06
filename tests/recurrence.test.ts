import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  latestOccurrenceAtOrBefore,
  nextDateAfter,
  nextOccurrenceAfter,
  occurrenceDate,
  ordinal,
} from '@/features/reminders/services/recurrence';
import { addDays, addMonths, diffDays, localDateTimeToEpoch, localToEpoch, toLocalDateTime } from '@/utils/date';

describe('calendar arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps months to the last day and honours a preferred day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('counts calendar days independent of DST', () => {
    // US DST ends 2026-11-01; the day is 25 hours long but still one day.
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
  });
});

describe('recurrence', () => {
  it('generates daily, weekly and monthly occurrences from the anchor', () => {
    expect(occurrenceDate('2026-10-26', 'daily', 3)).toBe('2026-10-29');
    expect(occurrenceDate('2026-10-26', 'weekly', 2)).toBe('2026-11-09');
    expect(occurrenceDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(occurrenceDate('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
  });

  it('finds the next occurrence strictly after a moment', () => {
    expect(nextOccurrenceAfter('2026-10-26', '09:00', 'daily', '2026-10-26T08:59')).toBe('2026-10-26T09:00');
    expect(nextOccurrenceAfter('2026-10-26', '09:00', 'daily', '2026-10-26T09:00')).toBe('2026-10-27T09:00');
    expect(nextOccurrenceAfter('2026-10-26', '09:00', 'weekly', '2026-11-20T12:00')).toBe('2026-11-23T09:00');
    expect(nextOccurrenceAfter('2026-01-31', '10:00', 'monthly', '2026-02-01T00:00')).toBe('2026-02-28T10:00');
    expect(nextOccurrenceAfter('2026-10-26', '09:00', 'none', '2026-10-27T00:00')).toBeNull();
  });

  it('finds the latest past occurrence for catching up after downtime', () => {
    expect(latestOccurrenceAtOrBefore('2026-10-20', '09:00', 'daily', '2026-10-26T08:00')).toBe('2026-10-25T09:00');
    expect(latestOccurrenceAtOrBefore('2026-10-20', '09:00', 'daily', '2026-10-19T08:00')).toBeNull();
    expect(latestOccurrenceAtOrBefore('2025-10-05', '09:00', 'monthly', '2026-10-26T00:00')).toBe('2026-10-05T09:00');
  });

  it('keeps wall-clock time across a DST change instead of adding 24h', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST in America/New_York.
    const before = nextOccurrenceAfter('2026-10-31', '09:00', 'daily', '2026-10-31T09:00')!;
    expect(before).toBe('2026-11-01T09:00');
    const gap = localDateTimeToEpoch(before) - localDateTimeToEpoch('2026-10-31T09:00');
    expect(gap).toBe(25 * 3600_000);
    expect(toLocalDateTime(localDateTimeToEpoch(before))).toBe('2026-11-01T09:00');
  });

  it('resolves a nonexistent spring-forward time to a real instant', () => {
    // 2027-03-14 02:30 does not exist in New York.
    const epoch = localToEpoch('2027-03-14', '02:30');
    expect(Number.isNaN(epoch)).toBe(false);
    expect(toLocalDateTime(epoch)).toBe('2027-03-14T03:30');
  });

  it('computes the next date for recurring tasks', () => {
    expect(nextDateAfter('2026-10-26', 'daily', '2026-10-26')).toBe('2026-10-27');
    expect(nextDateAfter('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31');
  });

  it('describes recurrences for humans', () => {
    expect(describeRecurrence('monthly', '2026-11-05')).toBe('Monthly on the 5th');
    expect(describeRecurrence('none')).toBe('Does not repeat');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd',
    ]);
  });
});
