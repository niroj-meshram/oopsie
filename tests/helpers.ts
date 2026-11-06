import { createEngine } from '@/background/engine';
import type { AlarmInfo, AlarmsPort } from '@/services/alarms/alarmService';
import type { NotificationOptions, NotificationsPort } from '@/services/notifications/notificationService';
import { Repository } from '@/services/storage/repository';
import { createMemoryStorageArea } from '@/services/storage/storageArea';
import { localToEpoch } from '@/utils/date';

/** Epoch for a local wall-clock time in the test zone (America/New_York). */
export const at = (date: string, time = '00:00') => localToEpoch(date, time);

export function fakeAlarms(): AlarmsPort & { alarms: Map<string, AlarmInfo> } {
  const alarms = new Map<string, AlarmInfo>();
  return {
    alarms,
    getAll: async () => [...alarms.values()],
    create: async (name, info) => {
      const when = info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60_000;
      alarms.set(name, { name, scheduledTime: when, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) });
    },
    clear: async (name) => alarms.delete(name),
  };
}

export function fakeNotifications(): NotificationsPort & {
  shown: Map<string, NotificationOptions>;
  log: { id: string; options: NotificationOptions }[];
} {
  const shown = new Map<string, NotificationOptions>();
  const log: { id: string; options: NotificationOptions }[] = [];
  return {
    shown,
    log,
    create: async (id, options) => {
      shown.set(id, options);
      log.push({ id, options });
    },
    clear: async (id) => {
      shown.delete(id);
    },
    getAll: async () => [...shown.keys()],
  };
}

/** A full background engine wired to in-memory fakes and a controllable clock. */
export function setupEngine(start: number, initial: Record<string, unknown> = {}) {
  const clock = { now: start };
  const area = createMemoryStorageArea(initial);
  const repo = new Repository(area);
  const alarms = fakeAlarms();
  const notifications = fakeNotifications();
  const badge = {
    text: '',
    title: '',
    tone: undefined as 'focus' | undefined,
    set: async (text: string, title: string, tone?: 'focus') => {
      badge.text = text;
      badge.title = title;
      badge.tone = tone;
    },
  };
  const sound = { rings: 0, ring: async () => void sound.rings++ };
  const engine = createEngine({ repo, alarms, notifications, badge, sound, iconUrl: 'icon.png', now: () => clock.now });
  return { clock, area, repo, alarms, notifications, badge, sound, engine };
}
