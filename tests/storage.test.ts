import { describe, expect, it } from 'vitest';
import { createReminder } from '@/features/reminders/services/reminderLogic';
import { createTask } from '@/features/tasks/services/taskLogic';
import { Repository, taskKey } from '@/services/storage/repository';
import { buildExport, ImportError, parseImport, sanitizeReminder, sanitizeTask } from '@/services/storage/schema';
import { createMemoryStorageArea } from '@/services/storage/storageArea';
import { DEFAULT_SETTINGS } from '@/types';
import { at } from './helpers';

const NOW = at('2026-10-26', '08:00');

describe('repository', () => {
  it('persists and reloads data (survives a "restart")', async () => {
    const area = createMemoryStorageArea();
    const repo = new Repository(area);
    await repo.ensureInitialized();
    const t = createTask({ title: 'Persist me' }, NOW);
    await repo.save({ tasks: [t] });
    const reopened = new Repository(createMemoryStorageArea(area.snapshot()));
    const data = await reopened.loadAll();
    expect(data.tasks.map((x) => x.title)).toEqual(['Persist me']);
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('does not lose either change when two updates race', async () => {
    const repo = new Repository(createMemoryStorageArea());
    const t = createTask({ title: 'Race' }, NOW);
    await repo.save({ tasks: [t] });
    await Promise.all([
      repo.updateTask(t.id, (cur) => ({ ...cur, priority: 'high' })),
      repo.updateTask(t.id, (cur) => ({ ...cur, description: 'notes' })),
    ]);
    expect(await repo.getTask(t.id)).toMatchObject({ priority: 'high', description: 'notes' });
  });

  it('isolates entities across contexts: two repos writing different tasks never clobber', async () => {
    const area = createMemoryStorageArea();
    const popup = new Repository(area);
    const dashboard = new Repository(area);
    await Promise.all([
      popup.save({ tasks: [createTask({ title: 'from popup' }, NOW)] }),
      dashboard.save({ tasks: [createTask({ title: 'from dashboard' }, NOW)] }),
    ]);
    expect((await popup.listTasks()).map((t) => t.title).sort()).toEqual(['from dashboard', 'from popup']);
  });

  it('skips corrupted records instead of failing', async () => {
    const good = createTask({ title: 'ok' }, NOW);
    const repo = new Repository(createMemoryStorageArea({ [taskKey(good.id)]: good, 'task:bad': { nope: true }, settings: 'garbage' }));
    const data = await repo.loadAll();
    expect(data.tasks).toHaveLength(1);
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('import / export', () => {
  const task = createTask({ title: 'Exported', dueDate: '2026-10-27' }, NOW);
  const reminder = createReminder({ title: 'Exported reminder', date: '2026-10-27', time: '09:00', taskId: task.id }, NOW);
  const file = JSON.stringify(buildExport({ tasks: [task], reminders: [reminder], settings: { ...DEFAULT_SETTINGS, theme: 'dark' } }, NOW));

  it('round-trips an export', () => {
    const res = parseImport(file, NOW);
    expect(res.tasks).toEqual([task]);
    expect(res.reminders).toEqual([reminder]);
    expect(res.settings?.theme).toBe('dark');
    expect(res.skipped).toBe(0);
  });

  it('rejects malformed files with helpful messages', () => {
    expect(() => parseImport('{oops', NOW)).toThrow(ImportError);
    expect(() => parseImport('{oops', NOW)).toThrow(/valid JSON/);
    expect(() => parseImport('[]', NOW)).toThrow(/Oopsie backup/);
    expect(() => parseImport('{"app":"other"}', NOW)).toThrow(/Oopsie backup/);
    expect(() => parseImport('{"app":"oopsie","schemaVersion":99,"tasks":[],"reminders":[]}', NOW)).toThrow(/newer version/);
    expect(() => parseImport('{"app":"oopsie","schemaVersion":1}', NOW)).toThrow(/missing/);
  });

  it('skips invalid items and strips unsafe values', () => {
    const json = JSON.stringify({
      app: 'oopsie',
      schemaVersion: 1,
      tasks: [
        { ...task, url: 'javascript:alert(1)', priority: 'urgent!!' },
        { id: 'x', title: '' },
        'nonsense',
        task, // duplicate id
      ],
      reminders: [{ ...reminder, anchorDate: 'not-a-date' }],
    });
    const res = parseImport(json, NOW);
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]).toMatchObject({ url: null, priority: 'medium' });
    expect(res.reminders).toHaveLength(0);
    expect(res.skipped).toBe(4);
    expect(res.warnings[0]).toMatch(/4 items/);
  });

  it('merges without erasing existing data; newest copy wins', async () => {
    const repo = new Repository(createMemoryStorageArea());
    const mine = createTask({ title: 'Already here' }, NOW);
    const newerLocal = { ...task, title: 'Edited locally', updatedAt: NOW + 10 };
    await repo.save({ tasks: [mine, newerLocal] });
    const res = await repo.importMerge(parseImport(file, NOW));
    expect(res).toEqual({ added: 1, updated: 0 });
    const titles = (await repo.listTasks()).map((t) => t.title).sort();
    expect(titles).toEqual(['Already here', 'Edited locally']);
    expect((await repo.listReminders())[0]?.taskId).toBe(task.id);
  });

  it('replace mode swaps all data only when asked', async () => {
    const repo = new Repository(createMemoryStorageArea());
    await repo.save({ tasks: [createTask({ title: 'Old' }, NOW)] });
    await repo.replaceAll(parseImport(file, NOW));
    expect((await repo.listTasks()).map((t) => t.title)).toEqual(['Exported']);
    expect((await repo.getSettings()).theme).toBe('dark');
  });

  it('migrates v1 tasks (completed: boolean) to the status model', () => {
    const v1 = { id: 'abc', title: 'Old', completed: true, completedAt: 5, createdAt: 1, updatedAt: 2 };
    expect(sanitizeTask(v1)).toMatchObject({ status: 'completed', completedAt: 5, sessions: [], startedAt: null });
    expect(sanitizeTask({ id: 'def', title: 'Old pending', completed: false })).toMatchObject({ status: 'pending' });
    const v1File = JSON.stringify({ app: 'oopsie', schemaVersion: 1, tasks: [v1], reminders: [] });
    expect(parseImport(v1File, NOW).tasks[0]?.status).toBe('completed');
  });

  it('closes stray open sessions on tasks that are not active', () => {
    const t = sanitizeTask({ id: 'x', title: 'x', status: 'completed', sessions: [{ start: 10, end: null }] }, 100);
    expect(t?.sessions).toEqual([{ start: 10, end: 10 }]);
  });

  it('sanitizers refuse records without ids or titles', () => {
    expect(sanitizeTask({ title: 'no id' })).toBeNull();
    expect(sanitizeReminder({ id: 'a', title: 'x', anchorDate: '2026-10-26' })).toBeNull();
  });
});
