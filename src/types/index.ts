import type { LocalDate, LocalDateTime, LocalTime } from '@/utils/date';

export type Priority = 'low' | 'medium' | 'high';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

/**
 * pending   – not started
 * active    – being worked on right now (time is being tracked)
 * completed – done; stays visible in its lists, just marked done
 */
export type TaskStatus = 'pending' | 'active' | 'completed';

/** One stretch of time a task spent in the "active" status. `end` is null while still active. */
export interface WorkSession {
  start: number;
  end: number | null;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  labels: string[];
  subtasks: Subtask[];
  url: string | null;
  /** Recurring tasks spawn their next instance when completed. */
  recurrence: Recurrence;
  /** First date of the series; keeps monthly-on-the-31st from drifting. */
  recurrenceAnchor: LocalDate | null;
  /** Id of the instance spawned when this one was completed (prevents double spawning). */
  spawnedNextId: string | null;
  status: TaskStatus;
  /** First time the task became active (null if never started). */
  startedAt: number | null;
  completedAt: number | null;
  /** Every active stretch, oldest first — the raw data for timesheets. */
  sessions: WorkSession[];
  createdAt: number;
  updatedAt: number;
}

export type ReminderStatus = 'active' | 'done' | 'dismissed';
export type OccurrenceOutcome = 'done' | 'dismissed' | 'missed';

export interface OccurrenceRecord {
  occurrence: LocalDateTime;
  outcome: OccurrenceOutcome;
  at: number;
}

export interface Reminder {
  id: string;
  title: string;
  description: string;
  url: string | null;
  taskId: string | null;
  /** First date of the series (or the only date of a one-time reminder). */
  anchorDate: LocalDate;
  time: LocalTime;
  recurrence: Recurrence;
  /** The occurrence currently pending, as a local date/time. */
  occurrence: LocalDateTime;
  /** Absolute epoch ms; snoozing overrides the occurrence's fire time. */
  snoozedUntil: number | null;
  /** Fire key ("occurrence@snooze") that has already produced a notification. */
  notifiedKey: string | null;
  status: ReminderStatus;
  history: OccurrenceRecord[];
  createdAt: number;
  updatedAt: number;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  defaultPriority: Priority;
  notificationsEnabled: boolean;
  /** Keep the notification on screen until the user acts on it. */
  persistentNotifications: boolean;
  silentNotifications: boolean;
  /** Snooze length (minutes) used by the notification's snooze button. */
  defaultSnoozeMinutes: number;
  showBadge: boolean;
  /** Quick-add with a time also creates a linked reminder. */
  autoReminderFromQuickAdd: boolean;
  /** Show "Good morning" style greetings and a bit of humour. */
  playfulCopy: boolean;
  /** The user's own past timesheets; Gemini copies their style (never their facts). */
  timesheetExamples: string;
  /** Length (minutes) pre-selected when starting a focus session. */
  defaultFocusMinutes: number;
  /** Ring an alarm sound when a focus session ends. */
  focusSound: boolean;
}

export const SNOOZE_OPTIONS = [5, 10, 30, 60] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultPriority: 'medium',
  notificationsEnabled: true,
  persistentNotifications: false,
  silentNotifications: false,
  defaultSnoozeMinutes: 10,
  showBadge: true,
  autoReminderFromQuickAdd: true,
  playfulCopy: true,
  timesheetExamples: '',
  defaultFocusMinutes: 25,
  focusSound: true,
};

/**
 * A focus timer. Only one exists at a time. It stays stored after it ends
 * (with `notifiedAt` set) so the UI can show "time's up" until dismissed.
 */
export interface FocusSession {
  label: string;
  durationMinutes: number;
  startedAt: number;
  endsAt: number;
  /** When the end-of-focus alarm was shown; null while still running. */
  notifiedAt: number | null;
}

export interface AppData {
  tasks: Task[];
  reminders: Reminder[];
  settings: Settings;
  focus: FocusSession | null;
}
