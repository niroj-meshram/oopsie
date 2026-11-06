import { isRecurrence } from '@/features/reminders/services/recurrence';
import {
  DEFAULT_SETTINGS,
  SNOOZE_OPTIONS,
  type AppData,
  type OccurrenceRecord,
  type Priority,
  type Reminder,
  type Settings,
  type Subtask,
  type Task,
  type TaskStatus,
  type WorkSession,
} from '@/types';
import { isValidFocusMinutes } from '@/features/focus/services/focusLogic';
import { isValidLocalDate, isValidLocalTime, joinDateTime } from '@/utils/date';
import { createId } from '@/utils/id';
import {
  LIMITS,
  cleanLabels,
  cleanText,
  cleanTitle,
  isFiniteNumber,
  isRecord,
  normalizeUrl,
} from '@/utils/validation';

/**
 * Sanitizers turn untrusted values (storage written by an older version,
 * imported files) into well-formed entities. They return null when an
 * entity is unusable rather than throwing, so one bad record never takes
 * down the rest of the data.
 */

/** v2: tasks have `status` (pending | active | completed) and work `sessions` instead of `completed: boolean`. */
export const SCHEMA_VERSION = 2;

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];
const isPriority = (v: unknown): v is Priority => typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

function sanitizeSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((s) => ({
      id: isId(s.id) ? s.id : createId(),
      title: cleanTitle(s.title),
      done: s.done === true,
    }))
    .filter((s) => s.title)
    .slice(0, LIMITS.subtasks);
}

const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'active', 'completed'];

function sanitizeSessions(value: unknown, now: number): WorkSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((s) => isFiniteNumber(s.start) && (s.end === null || s.end === undefined || isFiniteNumber(s.end)))
    .map((s) => {
      const start = s.start as number;
      const end = isFiniteNumber(s.end) ? Math.max(s.end, start) : null;
      return { start, end };
    })
    .filter((s) => s.start <= now + 60_000)
    .sort((a, b) => a.start - b.start)
    .slice(-LIMITS.sessions);
}

export function sanitizeTask(value: unknown, now = Date.now()): Task | null {
  if (!isRecord(value)) return null;
  const title = cleanTitle(value.title);
  if (!title || !isId(value.id)) return null;
  const dueDate = isValidLocalDate(value.dueDate) ? value.dueDate : null;
  const recurrence = dueDate && isRecurrence(value.recurrence) ? value.recurrence : 'none';
  // v1 data stored `completed: boolean`; map it onto the status model.
  const status: TaskStatus = (TASK_STATUSES as readonly unknown[]).includes(value.status)
    ? (value.status as TaskStatus)
    : value.completed === true
      ? 'completed'
      : 'pending';
  const createdAt = isFiniteNumber(value.createdAt) ? value.createdAt : now;
  let sessions = sanitizeSessions(value.sessions, now);
  // Only an active task may have an open session; close any stray one.
  if (status !== 'active') sessions = sessions.map((s) => (s.end === null ? { ...s, end: s.start } : s));
  else if (!sessions.some((s) => s.end === null)) sessions = [...sessions, { start: now, end: null }];
  else sessions = sessions.map((s, i) => (s.end === null && i !== sessions.length - 1 ? { ...s, end: s.start } : s));
  return {
    id: value.id,
    title,
    description: cleanText(value.description, LIMITS.description),
    priority: isPriority(value.priority) ? value.priority : 'medium',
    dueDate,
    dueTime: dueDate && isValidLocalTime(value.dueTime) ? value.dueTime : null,
    labels: cleanLabels(value.labels),
    subtasks: sanitizeSubtasks(value.subtasks),
    url: normalizeUrl(value.url),
    recurrence,
    recurrenceAnchor:
      recurrence === 'none' ? null : isValidLocalDate(value.recurrenceAnchor) ? value.recurrenceAnchor : dueDate,
    spawnedNextId: isId(value.spawnedNextId) ? value.spawnedNextId : null,
    status,
    startedAt: isFiniteNumber(value.startedAt) ? value.startedAt : sessions[0]?.start ?? null,
    completedAt: status === 'completed' ? (isFiniteNumber(value.completedAt) ? value.completedAt : now) : null,
    sessions,
    createdAt,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : createdAt,
  };
}

function sanitizeHistory(value: unknown): OccurrenceRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter(
      (h) =>
        typeof h.occurrence === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(h.occurrence) &&
        (h.outcome === 'done' || h.outcome === 'dismissed' || h.outcome === 'missed') &&
        isFiniteNumber(h.at),
    )
    .map((h) => ({ occurrence: h.occurrence as string, outcome: h.outcome as OccurrenceRecord['outcome'], at: h.at as number }))
    .slice(-LIMITS.history);
}

export function sanitizeReminder(value: unknown, now = Date.now()): Reminder | null {
  if (!isRecord(value)) return null;
  const title = cleanTitle(value.title);
  if (!title || !isId(value.id)) return null;
  if (!isValidLocalDate(value.anchorDate) || !isValidLocalTime(value.time)) return null;
  const recurrence = isRecurrence(value.recurrence) ? value.recurrence : 'none';
  const occurrence =
    typeof value.occurrence === 'string' &&
    isValidLocalDate(value.occurrence.slice(0, 10)) &&
    value.occurrence.slice(11) === value.time &&
    value.occurrence.length === 16
      ? value.occurrence
      : joinDateTime(value.anchorDate, value.time);
  const status = value.status === 'done' || value.status === 'dismissed' ? value.status : 'active';
  const createdAt = isFiniteNumber(value.createdAt) ? value.createdAt : now;
  return {
    id: value.id,
    title,
    description: cleanText(value.description, LIMITS.description),
    url: normalizeUrl(value.url),
    taskId: isId(value.taskId) ? value.taskId : null,
    anchorDate: value.anchorDate,
    time: value.time,
    recurrence,
    occurrence,
    snoozedUntil: isFiniteNumber(value.snoozedUntil) ? value.snoozedUntil : null,
    notifiedKey: typeof value.notifiedKey === 'string' ? value.notifiedKey.slice(0, 64) : null,
    status,
    history: sanitizeHistory(value.history),
    createdAt,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : createdAt,
  };
}

export function sanitizeSettings(value: unknown): Settings {
  const s = isRecord(value) ? value : {};
  const bool = (key: keyof Settings) =>
    typeof s[key] === 'boolean' ? (s[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
  return {
    theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : DEFAULT_SETTINGS.theme,
    defaultPriority: isPriority(s.defaultPriority) ? s.defaultPriority : DEFAULT_SETTINGS.defaultPriority,
    notificationsEnabled: bool('notificationsEnabled'),
    persistentNotifications: bool('persistentNotifications'),
    silentNotifications: bool('silentNotifications'),
    defaultSnoozeMinutes: (SNOOZE_OPTIONS as readonly number[]).includes(s.defaultSnoozeMinutes as number)
      ? (s.defaultSnoozeMinutes as number)
      : DEFAULT_SETTINGS.defaultSnoozeMinutes,
    showBadge: bool('showBadge'),
    autoReminderFromQuickAdd: bool('autoReminderFromQuickAdd'),
    playfulCopy: bool('playfulCopy'),
    timesheetExamples: typeof s.timesheetExamples === 'string' ? cleanText(s.timesheetExamples, 4000) : '',
    defaultFocusMinutes: isValidFocusMinutes(s.defaultFocusMinutes) ? s.defaultFocusMinutes : DEFAULT_SETTINGS.defaultFocusMinutes,
    focusSound: bool('focusSound'),
  };
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export const EXPORT_APP_ID = 'oopsie';
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface ExportFile {
  app: typeof EXPORT_APP_ID;
  schemaVersion: number;
  exportedAt: string;
  tasks: Task[];
  reminders: Reminder[];
  settings: Settings;
}

/** The focus timer is transient and never exported. */
export function buildExport(data: Omit<AppData, 'focus'>, now = Date.now()): ExportFile {
  return {
    app: EXPORT_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    tasks: data.tasks,
    reminders: data.reminders,
    settings: data.settings,
  };
}

export interface ImportResult {
  tasks: Task[];
  reminders: Reminder[];
  settings: Settings | null;
  skipped: number;
  warnings: string[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Validates an export file. Throws ImportError with a user-facing message. */
export function parseImport(text: string, now = Date.now()): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('That file is too large to be an Oopsie backup (max 10 MB).');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError("That file isn't valid JSON. Pick a file exported from Oopsie.");
  }
  if (!isRecord(json)) throw new ImportError("That file doesn't look like an Oopsie backup.");
  if (json.app !== EXPORT_APP_ID) throw new ImportError("That file doesn't look like an Oopsie backup (missing the \"app\": \"oopsie\" marker).");
  if (!isFiniteNumber(json.schemaVersion) || json.schemaVersion > SCHEMA_VERSION) {
    throw new ImportError('This backup was made by a newer version of Oopsie. Update the extension and try again.');
  }
  if (!Array.isArray(json.tasks) || !Array.isArray(json.reminders)) {
    throw new ImportError('The backup is missing its task or reminder list.');
  }

  let skipped = 0;
  const warnings: string[] = [];
  const tasks: Task[] = [];
  const seenTasks = new Set<string>();
  for (const raw of json.tasks) {
    const task = sanitizeTask(raw, now);
    if (!task || seenTasks.has(task.id)) {
      skipped++;
      continue;
    }
    seenTasks.add(task.id);
    tasks.push(task);
  }
  const reminders: Reminder[] = [];
  const seenReminders = new Set<string>();
  for (const raw of json.reminders) {
    const reminder = sanitizeReminder(raw, now);
    if (!reminder || seenReminders.has(reminder.id)) {
      skipped++;
      continue;
    }
    seenReminders.add(reminder.id);
    reminders.push(reminder);
  }
  if (skipped > 0) warnings.push(`${skipped} item${skipped === 1 ? '' : 's'} could not be read and will be skipped.`);
  return {
    tasks,
    reminders,
    settings: isRecord(json.settings) ? sanitizeSettings(json.settings) : null,
    skipped,
    warnings,
  };
}
