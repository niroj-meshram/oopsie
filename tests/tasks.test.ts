import { describe, expect, it } from 'vitest';
import {
  completeTask,
  createTask,
  editTask,
  reopenTask,
  setTaskStatus,
  startTask,
  TaskValidationError,
  timeSpentMs,
  toggleSubtask,
} from '@/features/tasks/services/taskLogic';
import {
  DEFAULT_FILTERS,
  dailyStats,
  isOverdue,
  selectTasks,
  weeklyCompletions,
} from '@/features/tasks/services/taskQueries';
import { at } from './helpers';

const NOW = at('2026-10-26', '12:00');

describe('task lifecycle', () => {
  it('creates a task with sane defaults', () => {
    const t = createTask({ title: '  Buy   milk ' }, NOW, 'high');
    expect(t).toMatchObject({ title: 'Buy milk', priority: 'high', dueDate: null, status: 'pending', sessions: [], recurrence: 'none' });
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('validates input', () => {
    expect(() => createTask({ title: '' }, NOW)).toThrow(TaskValidationError);
    expect(() => createTask({ title: 'x', dueDate: '2026-13-01' }, NOW)).toThrow(/due date/);
    expect(() => createTask({ title: 'x', dueTime: '10:00' }, NOW)).toThrow(/due date/);
    expect(() => createTask({ title: 'x', recurrence: 'daily' }, NOW)).toThrow(/Repeating/);
    expect(() => createTask({ title: 'x', url: 'javascript:void(0)' }, NOW)).toThrow(/http/);
  });

  it('normalises labels, links and subtasks', () => {
    const t = createTask(
      { title: 'x', labels: ['#Work', 'work', 'Deep Focus'], url: 'example.com/a', subtasks: [{ title: 'one' }, { title: ' ' }] },
      NOW,
    );
    expect(t.labels).toEqual(['work', 'deep-focus']);
    expect(t.url).toBe('https://example.com/a');
    expect(t.subtasks.map((s) => s.title)).toEqual(['one']);
  });

  it('edits, completes and reopens', () => {
    const t = createTask({ title: 'Draft', dueDate: '2026-10-27' }, NOW);
    const edited = editTask(t, { title: 'Draft v2', priority: 'high', dueDate: null }, NOW + 1);
    expect(edited).toMatchObject({ title: 'Draft v2', priority: 'high', dueDate: null, dueTime: null });
    const { task: done, spawned } = completeTask(edited, NOW + 2);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBe(NOW + 2);
    expect(spawned).toBeNull();
    expect(reopenTask(done, NOW + 3)).toMatchObject({ status: 'pending', completedAt: null });
  });

  it('toggles subtasks', () => {
    const t = createTask({ title: 'x', subtasks: [{ title: 'a' }] }, NOW);
    const toggled = toggleSubtask(t, t.subtasks[0]!.id, NOW);
    expect(toggled.subtasks[0]!.done).toBe(true);
  });

  it('spawns the next instance of a recurring task exactly once', () => {
    const t = createTask({ title: 'Pay bill', dueDate: '2026-10-05', recurrence: 'monthly', subtasks: [{ title: 's', done: true }] }, NOW);
    const { task, spawned } = completeTask(t, NOW);
    expect(spawned?.dueDate).toBe('2026-11-05');
    expect(spawned?.subtasks[0]!.done).toBe(false);
    expect(task.spawnedNextId).toBe(spawned!.id);
    const again = completeTask(reopenTask(task, NOW), NOW);
    expect(again.spawned).toBeNull();
  });

  it('brings an overdue daily task back today rather than in the past', () => {
    const t = createTask({ title: 'Walk', dueDate: '2026-10-20', recurrence: 'daily' }, NOW);
    expect(completeTask(t, NOW).spawned?.dueDate).toBe('2026-10-26');
  });
});

describe('views, filters and stats', () => {
  const mk = (title: string, extra: Parameters<typeof createTask>[0] = { title }) => createTask({ ...extra, title }, NOW);
  const overdue = mk('overdue', { title: '', dueDate: '2026-10-25' });
  const earlierToday = mk('earlier', { title: '', dueDate: '2026-10-26', dueTime: '09:00', priority: 'low' });
  const today = mk('today', { title: '', dueDate: '2026-10-26', priority: 'high' });
  const upcoming = mk('upcoming', { title: '', dueDate: '2026-10-30', labels: ['work'] });
  const someday = mk('someday');
  const done = completeTask(mk('done', { title: '', dueDate: '2026-10-26' }), NOW).task;
  const all = [overdue, earlierToday, today, upcoming, someday, done];

  it('detects overdue by date and by time', () => {
    expect(isOverdue(overdue, NOW)).toBe(true);
    expect(isOverdue(earlierToday, NOW)).toBe(true);
    expect(isOverdue(today, NOW)).toBe(false);
    expect(isOverdue(someday, NOW)).toBe(false);
  });

  it('selects the right tasks per view', () => {
    const titles = (v: Parameters<typeof selectTasks>[1]) => selectTasks(all, v, DEFAULT_FILTERS, NOW).map((t) => t.title);
    // The completed task due today stays in Today, marked done.
    expect(titles('today')).toEqual(['overdue', 'earlier', 'today', 'done']);
    expect(titles('upcoming')).toEqual(['upcoming']);
    expect(titles('overdue').sort()).toEqual(['earlier', 'overdue']);
    expect(titles('completed')).toEqual(['done']);
    expect(titles('all')).toHaveLength(6);
  });

  it('searches, filters and sorts', () => {
    const f = { ...DEFAULT_FILTERS };
    expect(selectTasks(all, 'all', { ...f, search: 'UPCO' }, NOW).map((t) => t.title)).toEqual(['upcoming']);
    expect(selectTasks(all, 'all', { ...f, priority: 'high' }, NOW).map((t) => t.title)).toEqual(['today']);
    expect(selectTasks(all, 'all', { ...f, status: 'completed' }, NOW).map((t) => t.title)).toEqual(['done']);
    expect(selectTasks(all, 'all', { ...f, label: 'work' }, NOW).map((t) => t.title)).toEqual(['upcoming']);
    const byPriority = selectTasks(all, 'today', { ...f, sort: 'priority' }, NOW).map((t) => t.title);
    expect(byPriority[0]).toBe('today');
    expect(byPriority.at(-1)).toBe('earlier');
  });

  it('computes daily stats and weekly completions', () => {
    const stats = dailyStats(all, NOW);
    expect(stats).toMatchObject({ scheduledToday: 3, completedToday: 1, remainingToday: 1, activeNow: 0, overdue: 2 });
    expect(stats.progress).toBeCloseTo(0.25);
    const week = weeklyCompletions(all, NOW);
    expect(week).toHaveLength(7);
    expect(week.at(-1)).toEqual({ date: '2026-10-26', count: 1 });
  });
});

describe('task status: pending, active, completed', () => {
  const MIN = 60_000;

  it('tracks a work session for each active stretch', () => {
    const t = createTask({ title: 'Write spec', dueDate: '2026-10-26' }, NOW);
    const active = startTask(t, NOW);
    expect(active).toMatchObject({ status: 'active', startedAt: NOW, sessions: [{ start: NOW, end: null }] });
    expect(timeSpentMs(active, NOW + 25 * MIN)).toBe(25 * MIN);

    const paused = reopenTask(active, NOW + 30 * MIN);
    expect(paused.status).toBe('pending');
    expect(paused.sessions).toEqual([{ start: NOW, end: NOW + 30 * MIN }]);

    const resumed = startTask(paused, NOW + 60 * MIN);
    const { task: done } = completeTask(resumed, NOW + 75 * MIN);
    expect(done).toMatchObject({ status: 'completed', completedAt: NOW + 75 * MIN, startedAt: NOW });
    expect(done.sessions).toHaveLength(2);
    expect(timeSpentMs(done, NOW + 999 * MIN)).toBe(45 * MIN);
    // Time inside a window, e.g. for a timesheet hour or day.
    expect(timeSpentMs(done, NOW, NOW + 10 * MIN, NOW + 65 * MIN)).toBe(20 * MIN + 5 * MIN);
  });

  it('completing straight from pending records no time; same-status changes are no-ops', () => {
    const t = createTask({ title: 'Quick one' }, NOW);
    const { task: done } = setTaskStatus(t, 'completed', NOW);
    expect(done.sessions).toEqual([]);
    expect(setTaskStatus(done, 'completed', NOW + 5).task).toBe(done);
  });

  it('keeps completed tasks visible in their views and filters by status', () => {
    const due = createTask({ title: 'due today', dueDate: '2026-10-26' }, NOW);
    const done = completeTask(createTask({ title: 'done today', dueDate: '2026-10-26' }, NOW), NOW).task;
    const doneLate = completeTask(createTask({ title: 'overdue, done today', dueDate: '2026-10-20' }, NOW), NOW).task;
    const working = startTask(createTask({ title: 'no date, active' }, NOW), NOW);
    const later = completeTask(createTask({ title: 'done early', dueDate: '2026-11-02' }, NOW), NOW).task;
    const all = [due, done, doneLate, working, later];
    const titles = (v: Parameters<typeof selectTasks>[1], status: 'all' | 'pending' | 'active' | 'completed' = 'all') =>
      selectTasks(all, v, { ...DEFAULT_FILTERS, status }, NOW).map((t) => t.title).sort();
    expect(titles('today')).toEqual(['done today', 'due today', 'no date, active', 'overdue, done today']);
    expect(titles('upcoming')).toEqual(['done early']);
    expect(titles('all', 'active')).toEqual(['no date, active']);
    expect(titles('all', 'completed')).toHaveLength(3);
    expect(dailyStats(all, NOW).activeNow).toBe(1);
  });

  it('does not reorder a task when it is completed', () => {
    const a = createTask({ title: 'a', dueDate: '2026-10-26', dueTime: '09:00' }, NOW);
    const b = createTask({ title: 'b', dueDate: '2026-10-26', dueTime: '10:00' }, NOW);
    const c = createTask({ title: 'c', dueDate: '2026-10-26', dueTime: '11:00' }, NOW);
    const before = selectTasks([a, b, c], 'today', DEFAULT_FILTERS, NOW).map((t) => t.title);
    const after = selectTasks([completeTask(a, NOW).task, b, c], 'today', DEFAULT_FILTERS, NOW).map((t) => t.title);
    expect(after).toEqual(before);
  });
});
