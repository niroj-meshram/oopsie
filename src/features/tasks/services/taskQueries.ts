import type { Priority, Task } from '@/types';
import { addDays, localToEpoch, toLocalDate } from '@/utils/date';
import type { TaskFilters, TaskSort, TaskView } from '../types';

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const DEFAULT_FILTERS: TaskFilters = {
  search: '',
  priority: 'all',
  status: 'all',
  label: null,
  sort: 'due',
};

/** Epoch of the due moment; date-only tasks are due at the end of their day. */
export function dueEpoch(task: Task): number | null {
  if (!task.dueDate) return null;
  if (task.dueTime) return localToEpoch(task.dueDate, task.dueTime);
  return localToEpoch(addDays(task.dueDate, 1)) - 1;
}

export function isOverdue(task: Task, now: number = Date.now()): boolean {
  if (task.status === 'completed' || !task.dueDate) return false;
  const due = dueEpoch(task);
  return due !== null && due < now;
}

export function isDueToday(task: Task, now: number = Date.now()): boolean {
  return task.dueDate === toLocalDate(now);
}

export function isCompletedToday(task: Task, now: number = Date.now()): boolean {
  return task.status === 'completed' && task.completedAt !== null && toLocalDate(task.completedAt) === toLocalDate(now);
}

export function matchesView(task: Task, view: TaskView, now: number = Date.now()): boolean {
  const today = toLocalDate(now);
  switch (view) {
    // Completed tasks stay in their lists (marked done) instead of disappearing.
    case 'today':
      if (task.status === 'active') return true;
      if (!task.dueDate || task.dueDate > today) return false;
      return task.dueDate === today || task.status !== 'completed' || isCompletedToday(task, now);
    case 'upcoming':
      return !!task.dueDate && task.dueDate > today;
    case 'overdue':
      return isOverdue(task, now);
    case 'completed':
      return task.status === 'completed';
    case 'all':
      return true;
  }
}

export function matchesFilters(task: Task, filters: TaskFilters): boolean {
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const haystack = `${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
  if (filters.status !== 'all' && task.status !== filters.status) return false;
  if (filters.label && !task.labels.includes(filters.label)) return false;
  return true;
}

export function compareTasks(sort: TaskSort): (a: Task, b: Task) => number {
  const byDue = (a: Task, b: Task) => {
    const da = dueEpoch(a);
    const db = dueEpoch(b);
    if (da === db) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  };
  const byPriority = (a: Task, b: Task) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const byCreated = (a: Task, b: Task) => b.createdAt - a.createdAt;
  switch (sort) {
    case 'due':
      return (a, b) => byDue(a, b) || byPriority(a, b) || byCreated(a, b);
    case 'priority':
      return (a, b) => byPriority(a, b) || byDue(a, b) || byCreated(a, b);
    case 'created':
      return byCreated;
  }
}

export function selectTasks(tasks: Task[], view: TaskView, filters: TaskFilters, now: number = Date.now()): Task[] {
  const list = tasks.filter((t) => matchesView(t, view, now) && matchesFilters(t, filters));
  if (view === 'completed') return list.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return list.sort(compareTasks(filters.sort));
}

export interface DailyStats {
  scheduledToday: number;
  completedToday: number;
  remainingToday: number;
  /** Tasks currently in the "active" status. */
  activeNow: number;
  overdue: number;
  /** 0..1 across today's plan: everything pending through today + what got done today. */
  progress: number;
}

export function dailyStats(tasks: Task[], now: number = Date.now()): DailyStats {
  const today = toLocalDate(now);
  let scheduledToday = 0;
  let completedToday = 0;
  let remainingToday = 0;
  let activeNow = 0;
  let overdue = 0;
  for (const t of tasks) {
    if (t.dueDate === today) scheduledToday++;
    if (isCompletedToday(t, now)) completedToday++;
    if (t.status === 'active') activeNow++;
    if (t.status !== 'completed' && t.dueDate && t.dueDate <= today) {
      if (isOverdue(t, now)) overdue++;
      else remainingToday++;
    }
  }
  const plan = completedToday + remainingToday + overdue;
  return {
    scheduledToday,
    completedToday,
    remainingToday,
    activeNow,
    overdue,
    progress: plan === 0 ? 0 : completedToday / plan,
  };
}

export interface DayCount {
  date: string;
  count: number;
}

/** Completed-task counts for the last seven days, oldest first, ending today. */
export function weeklyCompletions(tasks: Task[], now: number = Date.now()): DayCount[] {
  const today = toLocalDate(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const counts = new Map(days.map((d) => [d, 0]));
  for (const t of tasks) {
    if (t.status !== 'completed' || t.completedAt === null) continue;
    const d = toLocalDate(t.completedAt);
    if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return days.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

export function allLabels(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) for (const l of t.labels) set.add(l);
  return [...set].sort();
}

/** Groups tasks by due date for the Upcoming view. */
export function groupByDueDate(tasks: Task[]): { date: string; tasks: Task[] }[] {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.dueDate ?? '';
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([date, list]) => ({ date, tasks: list }));
}
