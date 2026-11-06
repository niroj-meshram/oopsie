import {
  addDays,
  addMonths,
  diffDays,
  joinDateTime,
  parseLocalDate,
  splitDateTime,
  type LocalDate,
  type LocalDateTime,
  type LocalTime,
} from '@/utils/date';
import type { Recurrence } from '@/types';

/**
 * Recurrence is computed on the local calendar from a fixed anchor, never by
 * adding milliseconds. Occurrence k of a series is derived from the anchor
 * directly, so a monthly series anchored on Jan 31 runs Jan 31, Feb 28,
 * Mar 31 … instead of drifting to the 28th forever.
 */

export const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

export function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === 'string' && (RECURRENCES as readonly string[]).includes(value);
}

/** The k-th occurrence date (k = 0 is the anchor). */
export function occurrenceDate(anchor: LocalDate, recurrence: Recurrence, k: number): LocalDate {
  switch (recurrence) {
    case 'none':
      return anchor;
    case 'daily':
      return addDays(anchor, k);
    case 'weekly':
      return addDays(anchor, 7 * k);
    case 'monthly': {
      const day = parseLocalDate(anchor)?.day;
      return addMonths(anchor, k, day);
    }
  }
}

/** A cheap lower bound for the index of the first occurrence on/after `date`. */
function estimateIndex(anchor: LocalDate, recurrence: Recurrence, date: LocalDate): number {
  const days = diffDays(anchor, date);
  if (days <= 0) return 0;
  switch (recurrence) {
    case 'daily':
      return days - 1;
    case 'weekly':
      return Math.max(0, Math.floor(days / 7) - 1);
    case 'monthly':
      return Math.max(0, Math.floor(days / 31) - 1);
    default:
      return 0;
  }
}

/**
 * Smallest occurrence of the series strictly after `after`
 * (a LocalDateTime). Returns null for one-time series that have passed.
 */
export function nextOccurrenceAfter(
  anchorDate: LocalDate,
  time: LocalTime,
  recurrence: Recurrence,
  after: LocalDateTime,
): LocalDateTime | null {
  const first = joinDateTime(anchorDate, time);
  if (recurrence === 'none') return first > after ? first : null;
  if (first > after) return first;
  let k = estimateIndex(anchorDate, recurrence, splitDateTime(after).date);
  // Bounded walk; the estimate is at most a couple of steps short.
  for (let guard = 0; guard < 1000; guard++, k++) {
    const candidate = joinDateTime(occurrenceDate(anchorDate, recurrence, k), time);
    if (candidate > after) return candidate;
  }
  return null;
}

/** Latest occurrence at or before `at`, or null when the series starts later. */
export function latestOccurrenceAtOrBefore(
  anchorDate: LocalDate,
  time: LocalTime,
  recurrence: Recurrence,
  at: LocalDateTime,
): LocalDateTime | null {
  const first = joinDateTime(anchorDate, time);
  if (first > at) return null;
  if (recurrence === 'none') return first;
  let k = estimateIndex(anchorDate, recurrence, splitDateTime(at).date);
  let latest = first;
  for (let guard = 0; guard < 1000; guard++, k++) {
    const candidate = joinDateTime(occurrenceDate(anchorDate, recurrence, k), time);
    if (candidate > at) return latest;
    latest = candidate;
  }
  return latest;
}

/** Next date for a recurring task, strictly after `after`. */
export function nextDateAfter(anchor: LocalDate, recurrence: Recurrence, after: LocalDate): LocalDate | null {
  const next = nextOccurrenceAfter(anchor, '00:00', recurrence, `${after}T23:59`);
  return next ? splitDateTime(next).date : null;
}

export function describeRecurrence(recurrence: Recurrence, anchor?: LocalDate | null): string {
  switch (recurrence) {
    case 'none':
      return 'Does not repeat';
    case 'daily':
      return 'Every day';
    case 'weekly': {
      if (!anchor) return 'Every week';
      const p = parseLocalDate(anchor);
      if (!p) return 'Every week';
      const name = new Date(p.year, p.month - 1, p.day).toLocaleDateString(undefined, { weekday: 'long' });
      return `Every ${name}`;
    }
    case 'monthly': {
      const day = anchor ? parseLocalDate(anchor)?.day : undefined;
      return day ? `Monthly on the ${ordinal(day)}` : 'Every month';
    }
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
