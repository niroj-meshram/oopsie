import type { FocusSession, Reminder, Settings, Task } from '@/types';
import { FOCUS_EXTEND_MINUTES } from '@/features/focus/services/focusLogic';
import { formatClock, formatRelativeDay } from '@/utils/format';
import { localDateTimeToEpoch } from '@/utils/date';

export const NOTIFICATION_PREFIX = 'oopsie-reminder:';
export const notificationId = (reminderId: string) => `${NOTIFICATION_PREFIX}${reminderId}`;

export function reminderIdFromNotification(id: string): string | null {
  return id.startsWith(NOTIFICATION_PREFIX) ? id.slice(NOTIFICATION_PREFIX.length) : null;
}

/** Button order on the notification. */
export const NOTIFICATION_BUTTONS = { snooze: 0, done: 1 } as const;

/** There is only ever one focus timer, so its notification has a fixed id. */
export const FOCUS_NOTIFICATION_ID = 'oopsie-focus';
export const FOCUS_NOTIFICATION_BUTTONS = { extend: 0, done: 1 } as const;

export interface NotificationOptions {
  type: 'basic';
  iconUrl: string;
  title: string;
  message: string;
  contextMessage: string;
  buttons: { title: string }[];
  requireInteraction: boolean;
  silent: boolean;
  priority: number;
}

export interface NotificationsPort {
  /** Creating with an existing id replaces it — never a duplicate. */
  create(id: string, options: NotificationOptions): Promise<void>;
  clear(id: string): Promise<void>;
  getAll(): Promise<string[]>;
}

export function createChromeNotifications(iconUrl: string): NotificationsPort & { iconUrl: string } {
  return {
    iconUrl,
    create: (id, options) =>
      new Promise((resolve) => {
        chrome.notifications.create(id, options, () => {
          // Read lastError so Chrome doesn't log it as unchecked (e.g. notifications blocked by the OS).
          void chrome.runtime.lastError;
          resolve();
        });
      }),
    clear: (id) =>
      new Promise((resolve) => {
        chrome.notifications.clear(id, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      }),
    getAll: () =>
      new Promise((resolve) => {
        chrome.notifications.getAll((all) => resolve(Object.keys(all ?? {})));
      }),
  };
}

export function buildNotification(
  reminder: Reminder,
  opts: { task: Task | null; missed: boolean; settings: Settings; iconUrl: string; now: number },
): NotificationOptions {
  const when = localDateTimeToEpoch(reminder.occurrence);
  const parts: string[] = [];
  if (reminder.description) parts.push(reminder.description);
  if (opts.task) parts.push(`For task: ${opts.task.title}`);
  if (reminder.url) parts.push(safeHost(reminder.url));
  const message = parts.join('\n') || (opts.missed ? 'Oops, this one slipped past while Chrome was away.' : "Here's your nudge.");
  const context = opts.missed
    ? `Missed · was due ${formatRelativeDay(when, opts.now)} at ${formatClock(when)}`
    : reminder.snoozedUntil
      ? 'Back from snooze · Oopsie'
      : `Oopsie · ${formatClock(when)}`;
  return {
    type: 'basic',
    iconUrl: opts.iconUrl,
    title: reminder.title,
    message: message.slice(0, 300),
    contextMessage: context,
    buttons: [{ title: `Snooze ${formatSnooze(opts.settings.defaultSnoozeMinutes)}` }, { title: 'Mark done' }],
    requireInteraction: opts.settings.persistentNotifications,
    silent: opts.settings.silentNotifications,
    priority: 2,
  };
}

/** The end-of-focus alarm. It always stays on screen until the user acts on it. */
export function buildFocusNotification(focus: FocusSession, opts: { settings: Settings; iconUrl: string }): NotificationOptions {
  const minutes = focus.durationMinutes;
  return {
    type: 'basic',
    iconUrl: opts.iconUrl,
    title: "⏰ Focus time's up!",
    message: focus.label ? `You focused on “${focus.label}”. Time for a break.` : 'Nice work. Time for a break.',
    contextMessage: `Oopsie · ${minutes} min focus · ended ${formatClock(focus.endsAt)}`,
    buttons: [{ title: `+${FOCUS_EXTEND_MINUTES} min` }, { title: 'Done' }],
    requireInteraction: true,
    silent: opts.settings.silentNotifications,
    priority: 2,
  };
}

export function formatSnooze(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60} hr` : `${minutes} min`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
