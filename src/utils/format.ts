import { addDays, diffDays, localToEpoch, parseLocalDate, toLocalDate, type LocalDate, type LocalTime } from './date';

/** Consistent, locale-aware formatting used everywhere in the UI. */

export function formatClock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatTime(time: LocalTime): string {
  return formatClock(localToEpoch('2000-01-01', time));
}

/** "Today", "Tomorrow", "Yesterday", "Friday" (within a week) or "Mon, Nov 3". */
export function formatRelativeDay(epochOrDate: number | LocalDate, now: number = Date.now()): string {
  const date = typeof epochOrDate === 'number' ? toLocalDate(epochOrDate) : epochOrDate;
  const today = toLocalDate(now);
  const delta = diffDays(today, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const p = parseLocalDate(date);
  if (!p) return date;
  const d = new Date(p.year, p.month - 1, p.day);
  if (delta > 1 && delta < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = p.year === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDue(date: LocalDate, time: LocalTime | null, now: number = Date.now()): string {
  const day = formatRelativeDay(date, now);
  return time ? `${day}, ${formatTime(time)}` : day;
}

export function formatDateTime(epoch: number, now: number = Date.now()): string {
  return `${formatRelativeDay(epoch, now)}, ${formatClock(epoch)}`;
}

export function formatLongDate(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatShortWeekday(date: LocalDate): string {
  const p = parseLocalDate(date);
  if (!p) return date;
  return new Date(p.year, p.month - 1, p.day).toLocaleDateString(undefined, { weekday: 'short' });
}

export function greeting(now: number = Date.now()): string {
  const h = new Date(now).getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}

/** "in 5 min", "in 2 hr", "3 min ago" — for compact reminder hints. */
export function formatCountdown(epoch: number, now: number = Date.now()): string {
  const diff = epoch - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let text: string;
  if (mins < 1) text = 'less than a minute';
  else if (mins < 60) text = `${mins} min`;
  else if (mins < 60 * 24) text = `${Math.round(mins / 60)} hr`;
  else text = `${Math.round(mins / (60 * 24))} d`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export const tomorrow = (now: number = Date.now()) => addDays(toLocalDate(now), 1);

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "45m", "1h 20m", "2h" — durations for tracked time. */
export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
