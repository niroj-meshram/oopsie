/** Thin, mockable wrapper around chrome.alarms plus pure diffing logic. */

export const REMINDER_ALARM_PREFIX = 'reminder:';
export const HEARTBEAT_ALARM = 'oopsie:heartbeat';
/** Fires at each whole minute left (to refresh the badge) and at the end of a focus session. */
export const FOCUS_ALARM = 'focus:tick';
/** Alarms owned by the reconcile plan; anything else (the heartbeat) is left alone. */
const MANAGED_PREFIXES = [REMINDER_ALARM_PREFIX, FOCUS_ALARM];
const isManaged = (name: string) => MANAGED_PREFIXES.some((p) => name.startsWith(p));
/**
 * The heartbeat re-checks everything periodically. It catches time-zone or
 * clock changes, sleeping machines and any alarm Chrome may have dropped.
 */
export const HEARTBEAT_MINUTES = 15;

export const reminderAlarmName = (id: string) => `${REMINDER_ALARM_PREFIX}${id}`;

export function reminderIdFromAlarm(name: string): string | null {
  return name.startsWith(REMINDER_ALARM_PREFIX) ? name.slice(REMINDER_ALARM_PREFIX.length) : null;
}

export interface AlarmInfo {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export interface AlarmsPort {
  getAll(): Promise<AlarmInfo[]>;
  create(name: string, info: { when?: number; periodInMinutes?: number; delayInMinutes?: number }): Promise<void>;
  clear(name: string): Promise<boolean>;
}

export function createChromeAlarms(): AlarmsPort {
  return {
    getAll: () => chrome.alarms.getAll(),
    create: async (name, info) => {
      await chrome.alarms.create(name, info);
    },
    clear: (name) => chrome.alarms.clear(name),
  };
}

export interface AlarmPlan {
  create: { name: string; when: number }[];
  clear: string[];
}

/** Ignore sub-second drift so unchanged alarms are left alone. */
const SAME_TIME_MS = 1000;

/**
 * Computes the minimal set of alarm changes to make Chrome's reminder and
 * focus alarms match `desired` (alarm name → epoch ms). Other alarms are untouched.
 */
export function planAlarms(existing: AlarmInfo[], desired: Map<string, number>): AlarmPlan {
  const plan: AlarmPlan = { create: [], clear: [] };
  const existingByName = new Map(existing.map((a) => [a.name, a]));
  for (const alarm of existing) {
    if (isManaged(alarm.name) && !desired.has(alarm.name)) plan.clear.push(alarm.name);
  }
  for (const [name, when] of desired) {
    const current = existingByName.get(name);
    if (!current || Math.abs(current.scheduledTime - when) > SAME_TIME_MS) plan.create.push({ name, when });
  }
  return plan;
}

export async function applyAlarmPlan(port: AlarmsPort, plan: AlarmPlan, now: number): Promise<void> {
  for (const name of plan.clear) await port.clear(name);
  for (const { name, when } of plan.create) {
    // Chrome rejects nothing in the past but fires it ASAP; keep it slightly ahead.
    await port.create(name, { when: Math.max(when, now + 500) });
  }
}

export async function ensureHeartbeat(port: AlarmsPort): Promise<void> {
  const all = await port.getAll();
  const hb = all.find((a) => a.name === HEARTBEAT_ALARM);
  if (!hb || hb.periodInMinutes !== HEARTBEAT_MINUTES) {
    await port.create(HEARTBEAT_ALARM, { delayInMinutes: 1, periodInMinutes: HEARTBEAT_MINUTES });
  }
}
