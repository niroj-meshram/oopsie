/**
 * Local calendar helpers.
 *
 * Oopsie stores dates and times as *local calendar values* ("2026-10-27",
 * "10:00") rather than epoch milliseconds. An epoch is derived only when we
 * need to schedule something, using the time zone in effect at that moment.
 * That keeps "10 AM" meaning 10 AM after a DST shift or a time-zone change.
 */

/** YYYY-MM-DD */
export type LocalDate = string;
/** HH:mm, 24-hour */
export type LocalTime = string;
/** YYYY-MM-DDTHH:mm — sortable as a string */
export type LocalDateTime = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

export function parseLocalDate(value: string): DateParts | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function parseLocalTime(value: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(value);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export const isValidLocalDate = (value: unknown): value is LocalDate =>
  typeof value === 'string' && parseLocalDate(value) !== null;

export const isValidLocalTime = (value: unknown): value is LocalTime =>
  typeof value === 'string' && parseLocalTime(value) !== null;

export function formatLocalDate({ year, month, day }: DateParts): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Local calendar date of an instant, in the current time zone. */
export function toLocalDate(instant: Date | number): LocalDate {
  const d = new Date(instant);
  return formatLocalDate({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

export function toLocalTime(instant: Date | number): LocalTime {
  const d = new Date(instant);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalDateTime(instant: Date | number): LocalDateTime {
  return `${toLocalDate(instant)}T${toLocalTime(instant)}`;
}

export function joinDateTime(date: LocalDate, time: LocalTime): LocalDateTime {
  return `${date}T${time}`;
}

export function splitDateTime(value: LocalDateTime): { date: LocalDate; time: LocalTime } {
  const [date = '', time = '00:00'] = value.split('T');
  return { date, time };
}

/**
 * Converts a local calendar date/time into epoch ms using the current zone.
 * Nonexistent times (spring-forward gap) resolve to the instant after the gap,
 * e.g. 02:30 becomes 03:30; ambiguous fall-back times resolve to the first one.
 */
export function localToEpoch(date: LocalDate, time: LocalTime = '00:00'): number {
  const d = parseLocalDate(date);
  const t = parseLocalTime(time);
  if (!d || !t) return Number.NaN;
  return new Date(d.year, d.month - 1, d.day, t.hour, t.minute, 0, 0).getTime();
}

export function localDateTimeToEpoch(value: LocalDateTime): number {
  const { date, time } = splitDateTime(value);
  return localToEpoch(date, time);
}

/** Pure calendar arithmetic, independent of time zone and DST. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const p = parseLocalDate(date);
  if (!p) throw new Error(`Invalid date: ${date}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return formatLocalDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

/**
 * Adds calendar months, clamping the day to the target month's length.
 * `preferredDay` lets a series anchored on the 31st come back to the 31st.
 */
export function addMonths(date: LocalDate, months: number, preferredDay?: number): LocalDate {
  const p = parseLocalDate(date);
  if (!p) throw new Error(`Invalid date: ${date}`);
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(preferredDay ?? p.day, daysInMonth(year, month));
  return formatLocalDate({ year, month, day });
}

/** Whole calendar days from a to b (b - a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  if (!pa || !pb) return Number.NaN;
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY,
  );
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: LocalDate): number {
  const p = parseLocalDate(date);
  if (!p) return Number.NaN;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export const today = (now: number = Date.now()): LocalDate => toLocalDate(now);

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}
