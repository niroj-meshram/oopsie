import { isOverdue } from '@/features/tasks/services/taskQueries';
import {
  isDue,
  reconcileReminder,
  resolveReminder,
  snoozeReminder,
  type ReconcileOutcome,
} from '@/features/reminders/services/reminderLogic';
import {
  extendFocus,
  FOCUS_EXTEND_MINUTES,
  focusBadgeText,
  focusRemainingMs,
  isFocusRunning,
  nextFocusTick,
} from '@/features/focus/services/focusLogic';
import {
  applyAlarmPlan,
  ensureHeartbeat,
  FOCUS_ALARM,
  planAlarms,
  reminderAlarmName,
  type AlarmsPort,
} from '@/services/alarms/alarmService';
import {
  buildFocusNotification,
  buildNotification,
  FOCUS_NOTIFICATION_ID,
  notificationId,
  reminderIdFromNotification,
  type NotificationsPort,
} from '@/services/notifications/notificationService';
import type { Repository } from '@/services/storage/repository';

export interface BadgePort {
  /** `tone: 'focus'` paints the badge red for a running focus timer. */
  set(text: string, title: string, tone?: 'focus'): Promise<void>;
}

/** Plays the alarm sound (the service worker itself cannot play audio). */
export interface SoundPort {
  ring(): Promise<void>;
}

export interface EngineDeps {
  repo: Repository;
  alarms: AlarmsPort;
  notifications: NotificationsPort;
  badge: BadgePort;
  sound?: SoundPort;
  iconUrl: string;
  now?: () => number;
}

/**
 * The scheduling engine. It runs in the service worker and is the only place
 * that creates alarms or notifications. `reconcile()` is idempotent and safe
 * to call on every wake-up: browser start, extension update, alarm, storage
 * change, or a message from the UI.
 */
export function createEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now;
  let running: Promise<void> | null = null;
  let rerun = false;

  async function reconcileOnce(): Promise<void> {
    const t = now();
    const { tasks, reminders, settings, focus } = await deps.repo.loadAll();
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const desired = new Map<string, number>();
    const shouldShow = new Set<string>();

    for (const stored of reminders) {
      let outcome: ReconcileOutcome | null = null;
      // Apply the transition to the freshest copy so concurrent UI edits win.
      const latest = await deps.repo.updateReminder(stored.id, (current) => {
        outcome = reconcileReminder(current, t);
        return outcome.reminder;
      });
      const result = outcome as ReconcileOutcome | null;
      if (!latest || !result) continue;
      if (result.alarmAt !== null) desired.set(reminderAlarmName(latest.id), result.alarmAt);
      if (isDue(latest, t)) shouldShow.add(notificationId(latest.id));
      if (result.notify && settings.notificationsEnabled) {
        const task = latest.taskId ? tasksById.get(latest.taskId) ?? null : null;
        await deps.notifications.create(
          notificationId(latest.id),
          buildNotification(latest, { task, missed: result.missed, settings, iconUrl: deps.iconUrl, now: t }),
        );
      }
    }

    // Focus timer: tick every minute while running, alarm exactly once when it ends.
    let currentFocus = focus;
    if (focus && isFocusRunning(focus, t)) {
      desired.set(FOCUS_ALARM, nextFocusTick(focus, t) ?? focus.endsAt);
    } else if (focus && focus.notifiedAt === null) {
      let claimed = false;
      currentFocus = await deps.repo.updateFocus((cur) => {
        if (!cur || cur.notifiedAt !== null || t < cur.endsAt) return cur;
        claimed = true;
        return { ...cur, notifiedAt: t };
      });
      if (claimed && currentFocus) {
        await deps.notifications.create(FOCUS_NOTIFICATION_ID, buildFocusNotification(currentFocus, { settings, iconUrl: deps.iconUrl }));
        if (settings.focusSound) await deps.sound?.ring().catch((err: unknown) => console.error('Oopsie: focus sound failed', err));
      }
    }
    if (currentFocus && currentFocus.notifiedAt !== null && t >= currentFocus.endsAt) shouldShow.add(FOCUS_NOTIFICATION_ID);

    // Remove notifications for reminders that were snoozed, resolved or deleted, and a dismissed focus alarm.
    for (const id of await deps.notifications.getAll()) {
      const managed = reminderIdFromNotification(id) || id === FOCUS_NOTIFICATION_ID;
      if (managed && !shouldShow.has(id)) await deps.notifications.clear(id);
    }

    await applyAlarmPlan(deps.alarms, planAlarms(await deps.alarms.getAll(), desired), t);
    await ensureHeartbeat(deps.alarms);

    const fresh = await deps.repo.listReminders();
    const dueCount = fresh.filter((r) => isDue(r, t)).length;
    const overdueCount = tasks.filter((task) => isOverdue(task, t)).length;
    const total = dueCount + overdueCount;
    // A running focus timer takes over the badge so the countdown is always visible.
    if (currentFocus && isFocusRunning(currentFocus, t)) {
      const left = Math.ceil(focusRemainingMs(currentFocus, t) / 60_000);
      const what = currentFocus.label ? ` on “${currentFocus.label}”` : '';
      await deps.badge.set(focusBadgeText(currentFocus, t), `Oopsie — focusing${what}, ${left} min left`, 'focus');
      return;
    }
    await deps.badge.set(
      settings.showBadge && total > 0 ? (total > 99 ? '99+' : String(total)) : '',
      total > 0 ? `Oopsie — ${dueCount} reminder(s) due, ${overdueCount} overdue task(s)` : 'Oopsie',
    );
  }

  /** Serialized and coalesced: concurrent calls share one extra pass. */
  function reconcile(): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          await reconcileOnce();
        } while (rerun);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function snooze(reminderId: string, minutes: number): Promise<void> {
    await deps.repo.updateReminder(reminderId, (r) => snoozeReminder(r, minutes, now()));
    await reconcile();
  }

  async function resolve(reminderId: string, outcome: 'done' | 'dismissed'): Promise<void> {
    await deps.repo.updateReminder(reminderId, (r) => resolveReminder(r, outcome, now()));
    await reconcile();
  }

  /** "+5 min" on the focus alarm. */
  async function extendFocusBy(minutes = FOCUS_EXTEND_MINUTES): Promise<void> {
    await deps.repo.updateFocus((cur) => (cur ? extendFocus(cur, minutes, now()) : cur));
    await reconcile();
  }

  /** "Done" on the focus alarm: forget the session and clear its notification. */
  async function dismissFocus(): Promise<void> {
    await deps.repo.updateFocus(() => null);
    await reconcile();
  }

  return { reconcile, snooze, resolve, extendFocus: extendFocusBy, dismissFocus };
}

export type Engine = ReturnType<typeof createEngine>;
