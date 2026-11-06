import type { FocusSession } from '@/types';
import { cleanTitle, isFiniteNumber, isRecord } from '@/utils/validation';

/** Pure focus-timer rules. Storage and alarms live elsewhere; these are unit-tested. */

export const FOCUS_PRESETS = [15, 25, 45, 60] as const;
export const MIN_FOCUS_MINUTES = 1;
export const MAX_FOCUS_MINUTES = 240;
export const FOCUS_EXTEND_MINUTES = 5;

export const isValidFocusMinutes = (m: unknown): m is number =>
  typeof m === 'number' && Number.isInteger(m) && m >= MIN_FOCUS_MINUTES && m <= MAX_FOCUS_MINUTES;

export function startFocus(minutes: number, label: string, now: number): FocusSession {
  if (!isValidFocusMinutes(minutes)) {
    throw new Error(`Focus time must be a whole number of minutes between ${MIN_FOCUS_MINUTES} and ${MAX_FOCUS_MINUTES}.`);
  }
  return { label: cleanTitle(label), durationMinutes: minutes, startedAt: now, endsAt: now + minutes * 60_000, notifiedAt: null };
}

/** Adds time. Extending a session that already ended starts a fresh countdown from now. */
export function extendFocus(focus: FocusSession, minutes: number, now: number): FocusSession {
  if (now >= focus.endsAt) return startFocus(minutes, focus.label, now);
  const endsAt = Math.min(focus.endsAt + minutes * 60_000, now + MAX_FOCUS_MINUTES * 60_000);
  return { ...focus, endsAt, durationMinutes: Math.round((endsAt - focus.startedAt) / 60_000), notifiedAt: null };
}

export const isFocusRunning = (focus: FocusSession | null, now: number): boolean => !!focus && now < focus.endsAt;

export const focusRemainingMs = (focus: FocusSession, now: number) => Math.max(0, focus.endsAt - now);

/** 0 → 1 over the session. */
export function focusProgress(focus: FocusSession, now: number): number {
  const total = focus.endsAt - focus.startedAt;
  return total > 0 ? Math.min(1, Math.max(0, (now - focus.startedAt) / total)) : 1;
}

/** Toolbar badge while running: whole minutes left, rounded up ("25m"), or seconds in the last minute ("<1m"). */
export function focusBadgeText(focus: FocusSession, now: number): string {
  const ms = focusRemainingMs(focus, now);
  if (ms <= 0) return '';
  const minutes = Math.ceil(ms / 60_000);
  return ms <= 60_000 ? '<1m' : `${minutes}m`;
}

/**
 * Next time the badge text changes: the next whole minute counted back from
 * `endsAt`. Null once the session is over.
 */
export function nextFocusTick(focus: FocusSession, now: number): number | null {
  const remaining = focus.endsAt - now;
  if (remaining <= 60_000) return null;
  const steps = Math.ceil(remaining / 60_000) - 1;
  return focus.endsAt - steps * 60_000;
}

/** "24:59" or "1:05:00". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function sanitizeFocus(value: unknown): FocusSession | null {
  if (!isRecord(value)) return null;
  const { startedAt, endsAt } = value;
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(endsAt) || endsAt <= startedAt) return null;
  return {
    label: cleanTitle(value.label),
    durationMinutes: Math.round((endsAt - startedAt) / 60_000),
    startedAt,
    endsAt,
    notifiedAt: isFiniteNumber(value.notifiedAt) ? value.notifiedAt : null,
  };
}
