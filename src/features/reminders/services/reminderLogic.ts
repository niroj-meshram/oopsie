import type { OccurrenceOutcome, Reminder } from '@/types';
import {
  MINUTE,
  isValidLocalDate,
  isValidLocalTime,
  joinDateTime,
  localDateTimeToEpoch,
  localToEpoch,
  toLocalDateTime,
} from '@/utils/date';
import { createId } from '@/utils/id';
import { LIMITS, cleanText, cleanTitle, normalizeUrl } from '@/utils/validation';
import type { ReminderInput } from '../types';
import { latestOccurrenceAtOrBefore, nextOccurrenceAfter } from './recurrence';

/**
 * The reminder lifecycle, as pure functions.
 *
 * A reminder always has one *current occurrence* (a local date/time).
 *  - When its fire time arrives it is "due": a notification is shown once,
 *    tracked by `notifiedKey` = "<occurrence>@<snoozedUntil|0>".
 *  - Snoozing sets `snoozedUntil`, which changes the key, so the snoozed
 *    alert fires exactly once more.
 *  - Done / Dismiss resolve the occurrence. One-time reminders stop; recurring
 *    ones move to the next occurrence.
 *  - If a recurring reminder's next occurrence arrives while the current one
 *    is still unresolved (or Chrome was closed for days), the backlog collapses
 *    into a single "missed" history entry and the latest occurrence takes over.
 *    Users get one catch-up notification, not a flood.
 */

/** Alarms may fire a hair early; treat anything within this window as due. */
export const DUE_TOLERANCE_MS = 1000;
/** A notification shown this long after its time is labelled as missed. */
export const MISSED_AFTER_MS = 5 * MINUTE;

export class ReminderValidationError extends Error {
  constructor(
    message: string,
    readonly field: 'title' | 'date' | 'time' | 'url',
  ) {
    super(message);
    this.name = 'ReminderValidationError';
  }
}

export function validateReminderInput(input: ReminderInput, now: number): void {
  if (!cleanTitle(input.title)) throw new ReminderValidationError('Give your reminder a title.', 'title');
  if (!isValidLocalDate(input.date)) throw new ReminderValidationError('Pick a valid date.', 'date');
  if (!isValidLocalTime(input.time)) throw new ReminderValidationError('Pick a valid time.', 'time');
  if (input.url && !normalizeUrl(input.url)) {
    throw new ReminderValidationError('That link should start with http:// or https://.', 'url');
  }
  const recurrence = input.recurrence ?? 'none';
  if (recurrence === 'none' && localToEpoch(input.date, input.time) <= now) {
    throw new ReminderValidationError('That time has already passed. Pick a time in the future.', 'time');
  }
}

/** First occurrence that hasn't happened yet (for recurring series that start in the past). */
function initialOccurrence(date: string, time: string, recurrence: Reminder['recurrence'], now: number): string {
  const first = joinDateTime(date, time);
  if (recurrence === 'none' || localDateTimeToEpoch(first) > now) return first;
  return nextOccurrenceAfter(date, time, recurrence, toLocalDateTime(now)) ?? first;
}

export function createReminder(input: ReminderInput, now: number = Date.now()): Reminder {
  validateReminderInput(input, now);
  const recurrence = input.recurrence ?? 'none';
  return {
    id: createId(),
    title: cleanTitle(input.title),
    description: cleanText(input.description, LIMITS.description),
    url: normalizeUrl(input.url),
    taskId: input.taskId ?? null,
    anchorDate: input.date,
    time: input.time,
    recurrence,
    occurrence: initialOccurrence(input.date, input.time, recurrence, now),
    snoozedUntil: null,
    notifiedKey: null,
    status: 'active',
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies an edit. Changing when it fires (date, time or recurrence) resets
 * the schedule and reactivates it; editing only text keeps snooze/notified state.
 */
export function editReminder(r: Reminder, input: ReminderInput, now: number = Date.now()): Reminder {
  const recurrence = input.recurrence ?? 'none';
  const scheduleChanged =
    input.date !== r.anchorDate || input.time !== r.time || recurrence !== r.recurrence || r.status !== 'active';
  if (scheduleChanged) validateReminderInput(input, now);
  else if (!cleanTitle(input.title)) throw new ReminderValidationError('Give your reminder a title.', 'title');
  else if (input.url && !normalizeUrl(input.url)) {
    throw new ReminderValidationError('That link should start with http:// or https://.', 'url');
  }
  const base: Reminder = {
    ...r,
    title: cleanTitle(input.title),
    description: cleanText(input.description, LIMITS.description),
    url: normalizeUrl(input.url),
    taskId: input.taskId === undefined ? r.taskId : input.taskId,
    updatedAt: now,
  };
  if (!scheduleChanged) return base;
  return {
    ...base,
    anchorDate: input.date,
    time: input.time,
    recurrence,
    occurrence: initialOccurrence(input.date, input.time, recurrence, now),
    snoozedUntil: null,
    notifiedKey: null,
    status: 'active',
  };
}

export function rescheduleReminder(r: Reminder, date: string, time: string, now: number = Date.now()): Reminder {
  return editReminder(r, { ...toInput(r), date, time }, now);
}

export function toInput(r: Reminder): ReminderInput {
  return {
    title: r.title,
    description: r.description,
    url: r.url,
    taskId: r.taskId,
    date: r.anchorDate,
    time: r.time,
    recurrence: r.recurrence,
  };
}

export function occurrenceEpoch(r: Reminder): number {
  return localDateTimeToEpoch(r.occurrence);
}

/** When the current occurrence should alert (honours snooze). */
export function fireTime(r: Reminder): number {
  return r.snoozedUntil ?? occurrenceEpoch(r);
}

export function fireKey(r: Reminder): string {
  return `${r.occurrence}@${r.snoozedUntil ?? 0}`;
}

export function isDue(r: Reminder, now: number = Date.now()): boolean {
  return r.status === 'active' && fireTime(r) <= now + DUE_TOLERANCE_MS;
}

export function snoozeReminder(r: Reminder, minutes: number, now: number = Date.now()): Reminder {
  if (r.status !== 'active') return r;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) throw new Error('Invalid snooze length');
  return { ...r, snoozedUntil: now + minutes * MINUTE, updatedAt: now };
}

function pushHistory(r: Reminder, outcome: OccurrenceOutcome, now: number): Reminder['history'] {
  return [...r.history, { occurrence: r.occurrence, outcome, at: now }].slice(-LIMITS.history);
}

/** Marks the current occurrence done or dismissed. */
export function resolveReminder(r: Reminder, outcome: 'done' | 'dismissed', now: number = Date.now()): Reminder {
  if (r.status !== 'active') return r;
  const history = pushHistory(r, outcome, now);
  if (r.recurrence === 'none') {
    return { ...r, status: outcome, snoozedUntil: null, history, updatedAt: now };
  }
  const next = nextOccurrenceAfter(r.anchorDate, r.time, r.recurrence, r.occurrence);
  if (!next) return { ...r, status: outcome, snoozedUntil: null, history, updatedAt: now };
  return { ...r, occurrence: next, snoozedUntil: null, notifiedKey: null, history, updatedAt: now };
}

/** Brings a finished reminder back for its next sensible time. */
export function reactivateReminder(r: Reminder, now: number = Date.now()): Reminder {
  if (r.status === 'active') return r;
  return {
    ...r,
    status: 'active',
    occurrence: initialOccurrence(r.anchorDate, r.time, r.recurrence, now),
    snoozedUntil: null,
    notifiedKey: null,
    updatedAt: now,
  };
}

export interface ReconcileOutcome {
  reminder: Reminder;
  changed: boolean;
  /** Show a notification for the current occurrence now. */
  notify: boolean;
  /** The occurrence was due a while ago (browser closed, machine asleep…). */
  missed: boolean;
  /** When the background should next wake for this reminder, if ever. */
  alarmAt: number | null;
}

/**
 * Decides what the background must do for one reminder at `now`.
 * Idempotent: running it twice in a row never produces a second notification.
 */
export function reconcileReminder(input: Reminder, now: number = Date.now()): ReconcileOutcome {
  let r = input;
  if (r.status !== 'active') return { reminder: r, changed: false, notify: false, missed: false, alarmAt: null };

  // Collapse missed occurrences of a recurring series.
  if (r.recurrence !== 'none') {
    const latest = latestOccurrenceAtOrBefore(r.anchorDate, r.time, r.recurrence, toLocalDateTime(now));
    if (latest && latest > r.occurrence) {
      r = {
        ...r,
        history: pushHistory(r, 'missed', now),
        occurrence: latest,
        snoozedUntil: null,
        notifiedKey: null,
        updatedAt: now,
      };
    }
  }

  const at = fireTime(r);
  let notify = false;
  if (at <= now + DUE_TOLERANCE_MS && r.notifiedKey !== fireKey(r)) {
    notify = true;
    r = { ...r, notifiedKey: fireKey(r), updatedAt: now };
  }

  let alarmAt: number | null = null;
  if (at > now + DUE_TOLERANCE_MS) {
    alarmAt = at;
  } else if (r.recurrence !== 'none') {
    // Already alerted: wake again when the next occurrence takes over.
    const next = nextOccurrenceAfter(r.anchorDate, r.time, r.recurrence, r.occurrence);
    alarmAt = next ? localDateTimeToEpoch(next) : null;
  }

  return {
    reminder: r,
    changed: r !== input,
    notify,
    missed: notify && now - at > MISSED_AFTER_MS,
    alarmAt,
  };
}

/** Sort key used by lists: due/snoozed first by fire time, finished last. */
export function compareReminders(a: Reminder, b: Reminder): number {
  const rank = (r: Reminder) => (r.status === 'active' ? 0 : 1);
  return rank(a) - rank(b) || fireTime(a) - fireTime(b);
}

export function nextUpcomingReminder(reminders: Reminder[], now: number = Date.now()): Reminder | null {
  let best: Reminder | null = null;
  for (const r of reminders) {
    if (r.status !== 'active' || isDue(r, now)) continue;
    if (!best || fireTime(r) < fireTime(best)) best = r;
  }
  return best;
}

export function dueReminders(reminders: Reminder[], now: number = Date.now()): Reminder[] {
  return reminders.filter((r) => isDue(r, now)).sort((a, b) => fireTime(a) - fireTime(b));
}
