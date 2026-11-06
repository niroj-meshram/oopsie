import type { AppData, FocusSession, Reminder, Settings, Task } from '@/types';
import { SCHEMA_VERSION, sanitizeReminder, sanitizeSettings, sanitizeTask } from './schema';
import type { StorageArea } from './storageArea';
import { DEFAULT_GEMINI_MODEL } from '@/services/ai/gemini';
import { sanitizeFocus } from '@/features/focus/services/focusLogic';

/**
 * Storage layout (chrome.storage.local):
 *   task:<id>      one Task per key
 *   reminder:<id>  one Reminder per key
 *   settings       Settings
 *   focus          FocusSession (the single focus timer, absent when none)
 *   meta           { schemaVersion }
 *
 * One key per entity means two contexts (popup, dashboard, service worker)
 * editing *different* items can never overwrite each other. Within a context,
 * writes are serialized and every update re-reads the latest stored value
 * right before applying its change.
 */

export const TASK_PREFIX = 'task:';
export const REMINDER_PREFIX = 'reminder:';
export const SETTINGS_KEY = 'settings';
export const META_KEY = 'meta';
export const FOCUS_KEY = 'focus';
/** AI settings incl. the API key. Kept apart from `settings` so it is never exported. */
export const AI_CONFIG_KEY = 'secret:ai';

export interface AiConfig {
  geminiApiKey: string;
  geminiModel: string;
}

export const taskKey = (id: string) => `${TASK_PREFIX}${id}`;
export const reminderKey = (id: string) => `${REMINDER_PREFIX}${id}`;

export type Updater<T> = (current: T) => T | null;

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly area: StorageArea) {}

  /** Runs `fn` after every previously queued write in this context. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async loadAll(): Promise<AppData> {
    const all = await this.area.getAll();
    return parseSnapshot(all);
  }

  async listTasks(): Promise<Task[]> {
    return (await this.loadAll()).tasks;
  }

  async listReminders(): Promise<Reminder[]> {
    return (await this.loadAll()).reminders;
  }

  async getTask(id: string): Promise<Task | null> {
    const res = await this.area.get([taskKey(id)]);
    return sanitizeTask(res[taskKey(id)]);
  }

  async getReminder(id: string): Promise<Reminder | null> {
    const res = await this.area.get([reminderKey(id)]);
    return sanitizeReminder(res[reminderKey(id)]);
  }

  async getAiConfig(): Promise<AiConfig> {
    const raw = (await this.area.get([AI_CONFIG_KEY]))[AI_CONFIG_KEY];
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      geminiApiKey: typeof r.geminiApiKey === 'string' ? r.geminiApiKey.slice(0, 200) : '',
      geminiModel: typeof r.geminiModel === 'string' && r.geminiModel ? r.geminiModel.slice(0, 80) : DEFAULT_GEMINI_MODEL,
    };
  }

  setAiConfig(patch: Partial<AiConfig>): Promise<AiConfig> {
    return this.serialize(async () => {
      const next = { ...(await this.getAiConfig()), ...patch };
      await this.area.set({ [AI_CONFIG_KEY]: next });
      return next;
    });
  }

  async getFocus(): Promise<FocusSession | null> {
    return sanitizeFocus((await this.area.get([FOCUS_KEY]))[FOCUS_KEY]);
  }

  /** Read-modify-write of the focus timer. Returning null removes it. */
  updateFocus(fn: (current: FocusSession | null) => FocusSession | null): Promise<FocusSession | null> {
    return this.serialize(async () => {
      const current = await this.getFocus();
      const next = fn(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return next;
      if (next) await this.area.set({ [FOCUS_KEY]: next });
      else await this.area.remove([FOCUS_KEY]);
      return next;
    });
  }

  async getSettings(): Promise<Settings> {
    const res = await this.area.get([SETTINGS_KEY]);
    return sanitizeSettings(res[SETTINGS_KEY]);
  }

  /** Writes several entities in one atomic chrome.storage call. */
  save(entities: { tasks?: Task[]; reminders?: Reminder[] }): Promise<void> {
    return this.serialize(async () => {
      const items: Record<string, unknown> = {};
      for (const t of entities.tasks ?? []) items[taskKey(t.id)] = t;
      for (const r of entities.reminders ?? []) items[reminderKey(r.id)] = r;
      if (Object.keys(items).length) await this.area.set(items);
    });
  }

  /** Read-modify-write against the latest stored value. Returning null skips the write. */
  updateTask(id: string, fn: Updater<Task>): Promise<Task | null> {
    return this.serialize(async () => {
      const current = await this.getTask(id);
      if (!current) return null;
      const next = fn(current);
      if (!next || JSON.stringify(next) === JSON.stringify(current)) return next ?? current;
      await this.area.set({ [taskKey(id)]: next });
      return next;
    });
  }

  updateReminder(id: string, fn: Updater<Reminder>): Promise<Reminder | null> {
    return this.serialize(async () => {
      const current = await this.getReminder(id);
      if (!current) return null;
      const next = fn(current);
      if (!next || JSON.stringify(next) === JSON.stringify(current)) return next ?? current;
      await this.area.set({ [reminderKey(id)]: next });
      return next;
    });
  }

  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.serialize(async () => {
      const next = sanitizeSettings({ ...(await this.getSettings()), ...patch });
      await this.area.set({ [SETTINGS_KEY]: next });
      return next;
    });
  }

  remove(ids: { tasks?: string[]; reminders?: string[] }): Promise<void> {
    return this.serialize(async () => {
      const keys = [...(ids.tasks ?? []).map(taskKey), ...(ids.reminders ?? []).map(reminderKey)];
      if (keys.length) await this.area.remove(keys);
    });
  }

  /**
   * Merge: imported items are added; for an id that exists in both,
   * whichever copy was updated most recently wins. Nothing is deleted.
   */
  importMerge(incoming: { tasks: Task[]; reminders: Reminder[]; settings: Settings | null }): Promise<{ added: number; updated: number }> {
    return this.serialize(async () => {
      const current = await this.loadAll();
      const tasksById = new Map(current.tasks.map((t) => [t.id, t]));
      const remindersById = new Map(current.reminders.map((r) => [r.id, r]));
      const items: Record<string, unknown> = {};
      let added = 0;
      let updated = 0;
      for (const t of incoming.tasks) {
        const existing = tasksById.get(t.id);
        if (!existing) added++;
        else if (t.updatedAt > existing.updatedAt) updated++;
        else continue;
        items[taskKey(t.id)] = t;
        tasksById.set(t.id, t);
      }
      for (const r of incoming.reminders) {
        const existing = remindersById.get(r.id);
        if (!existing) added++;
        else if (r.updatedAt > existing.updatedAt) updated++;
        else continue;
        const fixed = r.taskId && !tasksById.has(r.taskId) ? { ...r, taskId: null } : r;
        items[reminderKey(r.id)] = fixed;
      }
      if (incoming.settings) items[SETTINGS_KEY] = incoming.settings;
      if (Object.keys(items).length) await this.area.set(items);
      return { added, updated };
    });
  }

  /** Replace everything with the given data. Callers must confirm with the user first. */
  replaceAll(data: { tasks: Task[]; reminders: Reminder[]; settings: Settings | null }): Promise<void> {
    return this.serialize(async () => {
      const current = await this.area.getAll();
      const settings = data.settings ?? sanitizeSettings(current[SETTINGS_KEY]);
      const taskIds = new Set(data.tasks.map((t) => t.id));
      const items: Record<string, unknown> = {
        [SETTINGS_KEY]: settings,
        [META_KEY]: { schemaVersion: SCHEMA_VERSION },
      };
      for (const t of data.tasks) items[taskKey(t.id)] = t;
      for (const r of data.reminders) {
        items[reminderKey(r.id)] = r.taskId && !taskIds.has(r.taskId) ? { ...r, taskId: null } : r;
      }
      // Write the new data first, then remove leftovers, so a failure midway never leaves nothing.
      await this.area.set(items);
      const stale = Object.keys(current).filter(
        (k) => (k.startsWith(TASK_PREFIX) || k.startsWith(REMINDER_PREFIX)) && !(k in items),
      );
      if (stale.length) await this.area.remove(stale);
    });
  }

  clearAll(): Promise<void> {
    return this.serialize(async () => {
      await this.area.clear();
      await this.area.set({ [META_KEY]: { schemaVersion: SCHEMA_VERSION } });
    });
  }

  async ensureInitialized(): Promise<void> {
    await this.serialize(async () => {
      const res = await this.area.get([META_KEY, SETTINGS_KEY]);
      const items: Record<string, unknown> = {};
      if (!res[META_KEY]) items[META_KEY] = { schemaVersion: SCHEMA_VERSION };
      if (!res[SETTINGS_KEY]) items[SETTINGS_KEY] = sanitizeSettings(undefined);
      if (Object.keys(items).length) await this.area.set(items);
    });
  }
}

export function parseSnapshot(all: Record<string, unknown>): AppData {
  const tasks: Task[] = [];
  const reminders: Reminder[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(TASK_PREFIX)) {
      const t = sanitizeTask(value);
      if (t) tasks.push(t);
    } else if (key.startsWith(REMINDER_PREFIX)) {
      const r = sanitizeReminder(value);
      if (r) reminders.push(r);
    }
  }
  return { tasks, reminders, settings: sanitizeSettings(all[SETTINGS_KEY]), focus: sanitizeFocus(all[FOCUS_KEY]) };
}
