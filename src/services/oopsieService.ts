import {
  createReminder,
  editReminder,
  reactivateReminder,
  rescheduleReminder,
  resolveReminder,
  snoozeReminder,
} from '@/features/reminders/services/reminderLogic';
import type { ReminderInput } from '@/features/reminders/types';
import { createTask, editTask, setTaskStatus, toggleSubtask } from '@/features/tasks/services/taskLogic';
import type { TaskInput } from '@/features/tasks/types';
import { extendFocus, startFocus } from '@/features/focus/services/focusLogic';
import type { FocusSession, Reminder, Settings, Task, TaskStatus } from '@/types';
import { buildExport, parseImport, type ImportResult } from './storage/schema';
import type { AiConfig, Repository } from './storage/repository';
import { ENV_GEMINI_API_KEY, generateWithGemini } from './ai/gemini';
import { normalizeBullets, TIMESHEET_SYSTEM_PROMPT } from '@/features/timesheet/timesheetLogic';

/**
 * Use-case layer shared by the popup and dashboard. Each method validates via
 * the pure feature logic, persists through the repository and then nudges the
 * service worker to re-sync alarms. React components never touch storage or
 * scheduling directly.
 */
export function createOopsieService(repo: Repository, notifyBackground: () => Promise<void>) {
  const now = () => Date.now();

  return {
    // ---- tasks -----------------------------------------------------------
    async addTask(input: TaskInput, reminder?: Omit<ReminderInput, 'taskId'>): Promise<{ task: Task; reminder: Reminder | null }> {
      const settings = await repo.getSettings();
      const created = createTask(input, now(), settings.defaultPriority);
      const task = input.status && input.status !== 'pending' ? setTaskStatus(created, input.status, now()).task : created;
      const linked = reminder ? createReminder({ ...reminder, taskId: task.id }, now()) : null;
      await repo.save({ tasks: [task], reminders: linked ? [linked] : [] });
      if (linked) await notifyBackground();
      return { task, reminder: linked };
    },

    /** Edits fields; a status change in the input goes through the normal status rules. */
    async updateTask(id: string, input: TaskInput): Promise<Task | null> {
      const { status, ...fields } = input;
      const task = await repo.updateTask(id, (t) => editTask(t, fields, now()));
      if (task && status && status !== task.status) return (await this.setTaskStatus(id, status)).task;
      return task;
    },

    /**
     * Moves a task between pending, active and completed. Completed tasks are
     * only marked done — they stay in every list. Completing a task leaves its
     * reminders alone (documented rule); the UI offers to turn them off.
     * Completing a recurring task spawns its next instance.
     */
    async setTaskStatus(id: string, status: TaskStatus): Promise<{ task: Task | null; spawned: Task | null }> {
      let spawned: Task | null = null;
      const task = await repo.updateTask(id, (t) => {
        const result = setTaskStatus(t, status, now());
        spawned = result.spawned;
        return result.task;
      });
      const next = spawned as Task | null;
      if (next) {
        await repo.save({ tasks: [next] });
        // Repeating reminders follow the series to its next instance.
        for (const r of await repo.listReminders()) {
          if (r.taskId === id && r.recurrence !== 'none' && r.status === 'active') {
            await repo.updateReminder(r.id, (cur) => ({ ...cur, taskId: next.id, updatedAt: now() }));
          }
        }
      }
      return { task, spawned: next };
    },

    completeTask(id: string) {
      return this.setTaskStatus(id, 'completed');
    },

    async reopenTask(id: string): Promise<Task | null> {
      return (await this.setTaskStatus(id, 'pending')).task;
    },

    async toggleSubtask(taskId: string, subtaskId: string): Promise<Task | null> {
      return repo.updateTask(taskId, (t) => toggleSubtask(t, subtaskId, now()));
    },

    async setTaskPriority(id: string, priority: Task['priority']): Promise<Task | null> {
      return repo.updateTask(id, (t) => ({ ...t, priority, updatedAt: now() }));
    },

    /**
     * Deleting a task either deletes its linked reminders too (when the user
     * ticks the box) or keeps them as standalone reminders.
     */
    async deleteTask(id: string, opts: { deleteReminders: boolean }): Promise<{ task: Task | null; reminders: Reminder[] }> {
      const task = await repo.getTask(id);
      const linked = (await repo.listReminders()).filter((r) => r.taskId === id);
      if (opts.deleteReminders) {
        await repo.remove({ tasks: [id], reminders: linked.map((r) => r.id) });
      } else {
        await repo.remove({ tasks: [id] });
        for (const r of linked) await repo.updateReminder(r.id, (cur) => ({ ...cur, taskId: null, updatedAt: now() }));
      }
      await notifyBackground();
      return { task, reminders: opts.deleteReminders ? linked : [] };
    },

    /** Re-inserts deleted entities exactly as they were (used by Undo). */
    async restore(entities: { tasks?: Task[]; reminders?: Reminder[] }): Promise<void> {
      await repo.save(entities);
      await notifyBackground();
    },

    async clearCompleted(): Promise<number> {
      const done = (await repo.listTasks()).filter((t) => t.status === 'completed');
      const ids = new Set(done.map((t) => t.id));
      await repo.remove({ tasks: [...ids] });
      for (const r of await repo.listReminders()) {
        if (r.taskId && ids.has(r.taskId)) await repo.updateReminder(r.id, (cur) => ({ ...cur, taskId: null, updatedAt: now() }));
      }
      return done.length;
    },

    // ---- reminders -------------------------------------------------------
    async addReminder(input: ReminderInput): Promise<Reminder> {
      const reminder = createReminder(input, now());
      await repo.save({ reminders: [reminder] });
      await notifyBackground();
      return reminder;
    },

    async updateReminder(id: string, input: ReminderInput): Promise<Reminder | null> {
      const r = await repo.updateReminder(id, (cur) => editReminder(cur, input, now()));
      await notifyBackground();
      return r;
    },

    async rescheduleReminder(id: string, date: string, time: string): Promise<Reminder | null> {
      const r = await repo.updateReminder(id, (cur) => rescheduleReminder(cur, date, time, now()));
      await notifyBackground();
      return r;
    },

    async snoozeReminder(id: string, minutes: number): Promise<Reminder | null> {
      const r = await repo.updateReminder(id, (cur) => snoozeReminder(cur, minutes, now()));
      await notifyBackground();
      return r;
    },

    async resolveReminder(id: string, outcome: 'done' | 'dismissed'): Promise<Reminder | null> {
      const r = await repo.updateReminder(id, (cur) => resolveReminder(cur, outcome, now()));
      await notifyBackground();
      return r;
    },

    async reactivateReminder(id: string): Promise<Reminder | null> {
      const r = await repo.updateReminder(id, (cur) => reactivateReminder(cur, now()));
      await notifyBackground();
      return r;
    },

    async deleteReminder(id: string): Promise<Reminder | null> {
      const r = await repo.getReminder(id);
      await repo.remove({ reminders: [id] });
      await notifyBackground();
      return r;
    },

    /** Turns off every active reminder linked to a task (offered after completing it). */
    async dismissRemindersForTask(taskId: string): Promise<number> {
      const linked = (await repo.listReminders()).filter((r) => r.taskId === taskId && r.status === 'active');
      for (const r of linked) {
        await repo.updateReminder(r.id, (cur) => ({ ...cur, status: 'dismissed', snoozedUntil: null, updatedAt: now() }));
      }
      if (linked.length) await notifyBackground();
      return linked.length;
    },

    // ---- focus timer -------------------------------------------------------
    /** Starts a new focus session, replacing any current one. Also remembers the length for next time. */
    async startFocus(minutes: number, label = ''): Promise<FocusSession | null> {
      const focus = startFocus(minutes, label, now());
      const saved = await repo.updateFocus(() => focus);
      const settings = await repo.getSettings();
      if (settings.defaultFocusMinutes !== minutes) await repo.updateSettings({ defaultFocusMinutes: minutes });
      await notifyBackground();
      return saved;
    },

    async extendFocus(minutes: number): Promise<FocusSession | null> {
      const focus = await repo.updateFocus((cur) => (cur ? extendFocus(cur, minutes, now()) : cur));
      await notifyBackground();
      return focus;
    },

    /** Stops a running session early, or dismisses one that has ended. */
    async stopFocus(): Promise<void> {
      await repo.updateFocus(() => null);
      await notifyBackground();
    },

    // ---- AI timesheet ------------------------------------------------------
    /** Saved settings plus which key will actually be used (Settings first, then .env). */
    async getAiConfig() {
      const config = await repo.getAiConfig();
      const keySource: 'settings' | 'env' | 'none' = config.geminiApiKey ? 'settings' : ENV_GEMINI_API_KEY ? 'env' : 'none';
      return { ...config, keySource, hasEnvKey: !!ENV_GEMINI_API_KEY };
    },

    saveAiConfig(patch: Partial<AiConfig>) {
      return repo.setAiConfig(patch);
    },

    /** Sends the day's tasks to Gemini (only when the user asks) and returns hyphen bullets. */
    async generateTimesheet(prompt: string, signal?: AbortSignal): Promise<{ text: string; model: string }> {
      const config = await repo.getAiConfig();
      const result = await generateWithGemini({
        apiKey: config.geminiApiKey || ENV_GEMINI_API_KEY,
        model: config.geminiModel,
        system: TIMESHEET_SYSTEM_PROMPT,
        prompt,
        signal,
      });
      return { text: normalizeBullets(result.text), model: result.model };
    },

    // ---- settings & data -------------------------------------------------
    async updateSettings(patch: Partial<Settings>): Promise<Settings> {
      const s = await repo.updateSettings(patch);
      await notifyBackground();
      return s;
    },

    async exportJson(): Promise<string> {
      return JSON.stringify(buildExport(await repo.loadAll(), now()), null, 2);
    },

    previewImport(text: string): ImportResult {
      return parseImport(text, now());
    },

    async applyImport(result: ImportResult, mode: 'merge' | 'replace', includeSettings: boolean) {
      const payload = { tasks: result.tasks, reminders: result.reminders, settings: includeSettings ? result.settings : null };
      if (mode === 'replace') await repo.replaceAll(payload);
      const merged = mode === 'merge' ? await repo.importMerge(payload) : null;
      await notifyBackground();
      return merged;
    },

    async clearAll(): Promise<void> {
      await repo.clearAll();
      await notifyBackground();
    },
  };
}

export type OopsieService = ReturnType<typeof createOopsieService>;
