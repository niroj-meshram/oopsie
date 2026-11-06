import type { Priority, Recurrence } from '@/types';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatLocalDate,
  localToEpoch,
  parseLocalDate,
  toLocalDate,
  toLocalTime,
  weekdayOf,
  type LocalDate,
  type LocalTime,
} from '@/utils/date';
import { cleanLabel } from '@/utils/validation';

/**
 * A small, local, rule-based parser for quick-add text such as
 *   "Finish report tomorrow at 10 AM"
 *   "Call the client Friday at 3 PM"
 *   "Pay electricity bill every month on the 5th #home !high"
 * It never calls a remote service. Anything it doesn't recognise stays in
 * the title, and the UI always shows what was detected before saving.
 */

export type TokenKind = 'date' | 'time' | 'recurrence' | 'priority' | 'label';

export interface ParsedToken {
  kind: TokenKind;
  text: string;
}

export interface ParsedQuickAdd {
  title: string;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  recurrence: Recurrence;
  priority: Priority | null;
  labels: string[];
  tokens: ParsedToken[];
}

export interface ParseOptions {
  /** Kinds the user dismissed; their text stays in the title. */
  disabled?: ReadonlySet<TokenKind>;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const WEEKDAY_FULL_RE = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
const PREP = '(?:(?:on|by|due|for|at)\\s+)?';

const weekdayIndex = (word: string) => WEEKDAYS.findIndex((d) => d.startsWith(word.toLowerCase().slice(0, 3)));
const monthIndex = (word: string) => MONTHS.indexOf(word.toLowerCase().slice(0, 3));

/** Upcoming date for a weekday; `strict` skips today. */
function nextWeekday(today: LocalDate, weekday: number, strict: boolean): LocalDate {
  let delta = (weekday - weekdayOf(today) + 7) % 7;
  if (delta === 0 && strict) delta = 7;
  return addDays(today, delta);
}

/** Next date (today or later) that falls on the given day of the month. */
function nextDayOfMonth(today: LocalDate, day: number): LocalDate {
  const t = parseLocalDate(today)!;
  for (let i = 0; i < 24; i++) {
    const base = addMonths(formatLocalDate({ year: t.year, month: t.month, day: 1 }), i);
    const p = parseLocalDate(base)!;
    if (day > daysInMonth(p.year, p.month)) continue;
    const candidate = formatLocalDate({ year: p.year, month: p.month, day });
    if (candidate >= today) return candidate;
  }
  return today;
}

function to24h(hour: number, minute: number, meridiem: string | undefined): LocalTime | null {
  if (minute > 59) return null;
  let h = hour;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const pm = meridiem.toLowerCase().startsWith('p');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

interface Rule {
  kind: TokenKind;
  re: RegExp;
  apply(m: RegExpExecArray, ctx: Ctx): boolean;
}

interface Ctx {
  now: number;
  today: LocalDate;
  out: Omit<ParsedQuickAdd, 'title' | 'tokens'>;
}

const RULES: Rule[] = [
  // ---- recurrence -------------------------------------------------------
  {
    kind: 'recurrence',
    re: new RegExp(`\\b(?:every\\s+month|monthly|each\\s+month)(?:\\s+on\\s+the\\s+(\\d{1,2})${ORD})?\\b`, 'i'),
    apply(m, ctx) {
      ctx.out.recurrence = 'monthly';
      const day = m[1] ? Number(m[1]) : null;
      if (day !== null) {
        if (day < 1 || day > 31) return false;
        ctx.out.dueDate = nextDayOfMonth(ctx.today, day);
      }
      return true;
    },
  },
  {
    kind: 'recurrence',
    re: new RegExp(`\\bevery\\s+(\\d{1,2})${ORD}(?:\\s+of\\s+the\\s+month)?\\b`, 'i'),
    apply(m, ctx) {
      const day = Number(m[1]);
      if (day < 1 || day > 31) return false;
      ctx.out.recurrence = 'monthly';
      ctx.out.dueDate = nextDayOfMonth(ctx.today, day);
      return true;
    },
  },
  {
    kind: 'recurrence',
    re: new RegExp(`\\bevery\\s+${WEEKDAY_RE}\\b`, 'i'),
    apply(m, ctx) {
      ctx.out.recurrence = 'weekly';
      ctx.out.dueDate = nextWeekday(ctx.today, weekdayIndex(m[1]!), false);
      return true;
    },
  },
  {
    kind: 'recurrence',
    re: /\b(?:every\s+week|weekly|each\s+week)\b/i,
    apply(_m, ctx) {
      ctx.out.recurrence = 'weekly';
      return true;
    },
  },
  {
    kind: 'recurrence',
    re: /\b(?:every\s*day|daily|each\s+day|every\s+morning|every\s+evening|every\s+night)\b/i,
    apply(m, ctx) {
      ctx.out.recurrence = 'daily';
      const w = m[0].toLowerCase();
      if (w.endsWith('morning')) ctx.out.dueTime ??= '09:00';
      if (w.endsWith('evening')) ctx.out.dueTime ??= '18:00';
      if (w.endsWith('night')) ctx.out.dueTime ??= '21:00';
      return true;
    },
  },
  // ---- relative date + time --------------------------------------------
  {
    kind: 'date',
    re: /\bin\s+(\d{1,3}|an?|one|two|three|half\s+an?)\s+(minutes?|mins?|hours?|hrs?)\b/i,
    apply(m, ctx) {
      const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
      const raw = m[1]!.toLowerCase();
      const unit = m[2]!.toLowerCase();
      let minutes: number;
      if (raw.startsWith('half')) minutes = 30;
      else {
        const n = words[raw] ?? Number(raw);
        minutes = unit.startsWith('h') ? n * 60 : n;
      }
      if (!minutes || minutes > 60 * 24 * 7) return false;
      const at = ctx.now + minutes * 60_000;
      ctx.out.dueDate = toLocalDate(at);
      ctx.out.dueTime = toLocalTime(at);
      return true;
    },
  },
  // ---- dates --------------------------------------------------------------
  {
    kind: 'date',
    re: /\b(?:the\s+)?day\s+after\s+tomorrow\b/i,
    apply(_m, ctx) {
      ctx.out.dueDate = addDays(ctx.today, 2);
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`\\b${PREP}(today|tonight|tomorrow|tmrw?|tmw)(?:\\s+(morning|afternoon|evening|night))?\\b`, 'i'),
    apply(m, ctx) {
      const w = m[1]!.toLowerCase();
      ctx.out.dueDate = w.startsWith('to') && !w.startsWith('tom') ? ctx.today : addDays(ctx.today, 1);
      const part = (m[2] ?? (w === 'tonight' ? 'night' : '')).toLowerCase();
      const times: Record<string, LocalTime> = { morning: '09:00', afternoon: '14:00', evening: '18:00', night: '20:00' };
      if (part && times[part]) ctx.out.dueTime ??= times[part]!;
      return true;
    },
  },
  {
    kind: 'date',
    re: /\bin\s+(\d{1,3}|a|an|one|two|three)\s+(days?|weeks?|months?)\b/i,
    apply(m, ctx) {
      const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
      const n = words[m[1]!.toLowerCase()] ?? Number(m[1]);
      const unit = m[2]!.toLowerCase();
      if (!n) return false;
      ctx.out.dueDate = unit.startsWith('d')
        ? addDays(ctx.today, n)
        : unit.startsWith('w')
          ? addDays(ctx.today, 7 * n)
          : addMonths(ctx.today, n);
      return true;
    },
  },
  {
    kind: 'date',
    re: /\b(?:next\s+week)\b/i,
    apply(_m, ctx) {
      ctx.out.dueDate = nextWeekday(ctx.today, 1, true);
      return true;
    },
  },
  {
    kind: 'date',
    re: /\b(?:this\s+weekend|on\s+the\s+weekend|at\s+the\s+weekend)\b/i,
    apply(_m, ctx) {
      ctx.out.dueDate = nextWeekday(ctx.today, 6, false);
      return true;
    },
  },
  {
    kind: 'date',
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    apply(m, ctx) {
      const date = `${m[1]}-${m[2]}-${m[3]}`;
      if (!parseLocalDate(date)) return false;
      ctx.out.dueDate = date;
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`\\b${PREP}${MONTH_RE}\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    apply(m, ctx) {
      return applyMonthDay(ctx, monthIndex(m[1]!), Number(m[2]), m[3] ? Number(m[3]) : null);
    },
  },
  {
    kind: 'date',
    re: new RegExp(`\\b${PREP}(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, 'i'),
    apply(m, ctx) {
      return applyMonthDay(ctx, monthIndex(m[2]!), Number(m[1]), m[3] ? Number(m[3]) : null);
    },
  },
  {
    // Full weekday names anywhere: "Call the client Friday".
    kind: 'date',
    re: new RegExp(`\\b(?:(?:on|by|due|for)\\s+)?(?:(next|this)\\s+)?${WEEKDAY_FULL_RE}\\b`, 'i'),
    apply(m, ctx) {
      return applyWeekday(ctx, m[2]!, m[1]);
    },
  },
  {
    // Abbreviations need a lead-in so "sat down" or "sun cream" stay in the title.
    kind: 'date',
    re: new RegExp(`\\b(?:(?:on|by|due|for)\\s+|(next|this)\\s+)${WEEKDAY_RE}\\b`, 'i'),
    apply(m, ctx) {
      return applyWeekday(ctx, m[2]!, m[1]);
    },
  },
  {
    kind: 'date',
    re: new RegExp(`\\b(?:on|by|due)\\s+the\\s+(\\d{1,2})${ORD}\\b`, 'i'),
    apply(m, ctx) {
      const day = Number(m[1]);
      if (day < 1 || day > 31) return false;
      ctx.out.dueDate = nextDayOfMonth(ctx.today, day);
      return true;
    },
  },
  // ---- times -------------------------------------------------------------
  {
    kind: 'time',
    re: /\b(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\s|$|[,.!?])/i,
    apply(m, ctx) {
      const t = to24h(Number(m[1]), Number(m[2] ?? 0), m[3]!.replace(/\./g, ''));
      if (!t) return false;
      ctx.out.dueTime = t;
      return true;
    },
  },
  {
    kind: 'time',
    re: /\b(?:at\s+|@\s*)?(noon|midday|midnight)\b/i,
    apply(m, ctx) {
      ctx.out.dueTime = m[1]!.toLowerCase() === 'midnight' ? '00:00' : '12:00';
      return true;
    },
  },
  {
    kind: 'time',
    re: /\b(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i,
    apply(m, ctx) {
      const t = to24h(Number(m[1]), Number(m[2]), undefined);
      if (!t) return false;
      ctx.out.dueTime = t;
      return true;
    },
  },
  {
    // "at 3" — assume working hours: 1–7 means PM, 8–11 AM, 12 noon.
    kind: 'time',
    re: /\b(?:at|@)\s*(\d{1,2})\b(?![:\d]|\s*(?:%|st|nd|rd|th))/i,
    apply(m, ctx) {
      const h = Number(m[1]);
      if (h < 1 || h > 23) return false;
      ctx.out.dueTime = to24h(h >= 1 && h <= 7 ? h + 12 : h, 0, undefined);
      return ctx.out.dueTime !== null;
    },
  },
  {
    kind: 'time',
    re: /\b(?:in\s+the\s+|this\s+)(morning|afternoon|evening)\b/i,
    apply(m, ctx) {
      const times: Record<string, LocalTime> = { morning: '09:00', afternoon: '14:00', evening: '18:00' };
      ctx.out.dueTime ??= times[m[1]!.toLowerCase()]!;
      return true;
    },
  },
  // ---- priority & labels -----------------------------------------------
  {
    kind: 'priority',
    re: /(?:^|\s)(!high|!medium|!med|!low|!!!|!!|p[123])(?=\s|$)/i,
    apply(m, ctx) {
      const v = m[1]!.toLowerCase();
      ctx.out.priority =
        v === '!high' || v === '!!!' || v === 'p1' ? 'high' : v === '!low' || v === 'p3' ? 'low' : 'medium';
      return true;
    },
  },
];

function applyWeekday(ctx: Ctx, word: string, modifier: string | undefined): boolean {
  const idx = weekdayIndex(word);
  if (idx < 0) return false;
  ctx.out.dueDate = nextWeekday(ctx.today, idx, modifier?.toLowerCase() === 'next');
  return true;
}

function applyMonthDay(ctx: Ctx, month: number, day: number, year: number | null): boolean {
  if (month < 0 || day < 1 || day > 31) return false;
  const thisYear = parseLocalDate(ctx.today)!.year;
  const build = (y: number) =>
    day <= daysInMonth(y, month + 1) ? formatLocalDate({ year: y, month: month + 1, day }) : null;
  let date = build(year ?? thisYear);
  if (!date) return false;
  if (year === null && date < ctx.today) date = build(thisYear + 1);
  if (!date) return false;
  ctx.out.dueDate = date;
  return true;
}

const LABEL_RE = /(?:^|\s)#([\p{L}\p{N}_-]{1,32})/gu;

export function parseQuickAdd(text: string, now: number = Date.now(), options: ParseOptions = {}): ParsedQuickAdd {
  const disabled = options.disabled ?? new Set<TokenKind>();
  const ctx: Ctx = {
    now,
    today: toLocalDate(now),
    out: { dueDate: null, dueTime: null, recurrence: 'none', priority: null, labels: [] },
  };
  const tokens: ParsedToken[] = [];
  let rest = ` ${text} `;

  if (!disabled.has('label')) {
    rest = rest.replace(LABEL_RE, (match, label: string) => {
      const clean = cleanLabel(label);
      if (clean && !ctx.out.labels.includes(clean)) {
        ctx.out.labels.push(clean);
        tokens.push({ kind: 'label', text: `#${clean}` });
      }
      return match.startsWith(' ') ? ' ' : '';
    });
  }

  const seen = new Set<TokenKind>();
  for (const rule of RULES) {
    if (disabled.has(rule.kind)) continue;
    // One match per kind keeps the parse predictable ("tomorrow at 3 at 5" → first wins).
    if (seen.has(rule.kind)) continue;
    const m = rule.re.exec(rest);
    if (!m) continue;
    const snapshot = { ...ctx.out, labels: [...ctx.out.labels] };
    if (!rule.apply(m, ctx)) {
      ctx.out = snapshot;
      continue;
    }
    seen.add(rule.kind);
    tokens.push({ kind: rule.kind, text: m[0].trim() });
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
  }

  const out = ctx.out;
  // A time with no date means the next time that clock time comes around.
  if (out.dueTime && !out.dueDate) {
    out.dueDate = localToEpoch(ctx.today, out.dueTime) > now ? ctx.today : addDays(ctx.today, 1);
  }
  // A repeating task with no start date starts today.
  if (out.recurrence !== 'none' && !out.dueDate) out.dueDate = ctx.today;

  const title = rest
    .replace(/\s+/g, ' ')
    .replace(/\s+(on|at|by|due|for|every|in|the|,|-|–)+\s*$/i, '')
    .replace(/^\s*(on|at|by|due)\s+/i, '')
    .replace(/[\s,;:–-]+$/, '')
    .trim();

  return { title, ...out, tokens };
}

/** True when the parse found anything worth showing as a chip. */
export function hasDetections(p: ParsedQuickAdd): boolean {
  return p.tokens.length > 0;
}
