import type { Priority, Subtask, Task, TaskStatus, WorkSession } from '@/types';
import { isValidLocalDate, isValidLocalTime, maxDate, addDays, toLocalDate } from '@/utils/date';
import { createId } from '@/utils/id';
import { LIMITS, cleanLabels, cleanText, cleanTitle, normalizeUrl } from '@/utils/validation';
import { nextDateAfter } from '@/features/reminders/services/recurrence';
import type { TaskInput } from '../types';

export class TaskValidationError extends Error {
  constructor(
    message: string,
    readonly field: 'title' | 'dueDate' | 'dueTime' | 'url',
  ) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

export function validateTaskInput(input: TaskInput): void {
  if (!cleanTitle(input.title)) throw new TaskValidationError('A task needs a title.', 'title');
  if (input.dueDate && !isValidLocalDate(input.dueDate)) throw new TaskValidationError('Pick a valid due date.', 'dueDate');
  if (input.dueTime && !isValidLocalTime(input.dueTime)) throw new TaskValidationError('Pick a valid time.', 'dueTime');
  if (input.dueTime && !input.dueDate) throw new TaskValidationError('Add a due date to go with that time.', 'dueDate');
  if (input.recurrence && input.recurrence !== 'none' && !input.dueDate) {
    throw new TaskValidationError('Repeating tasks need a due date to start from.', 'dueDate');
  }
  if (input.url && !normalizeUrl(input.url)) throw new TaskValidationError('That link should start with http:// or https://.', 'url');
}

function buildSubtasks(input: TaskInput['subtasks'], previous: Subtask[] = []): Subtask[] {
  if (!input) return previous;
  return input
    .map((s) => ({
      id: s.id ?? createId(),
      title: cleanTitle(s.title),
      done: s.done === true,
    }))
    .filter((s) => s.title)
    .slice(0, LIMITS.subtasks);
}

export function createTask(input: TaskInput, now: number = Date.now(), defaultPriority: Priority = 'medium'): Task {
  validateTaskInput(input);
  const dueDate = input.dueDate || null;
  const recurrence = dueDate ? input.recurrence ?? 'none' : 'none';
  return {
    id: createId(),
    title: cleanTitle(input.title),
    description: cleanText(input.description, LIMITS.description),
    priority: input.priority ?? defaultPriority,
    dueDate,
    dueTime: dueDate ? input.dueTime || null : null,
    labels: cleanLabels(input.labels),
    subtasks: buildSubtasks(input.subtasks),
    url: normalizeUrl(input.url),
    recurrence,
    recurrenceAnchor: recurrence === 'none' ? null : dueDate,
    spawnedNextId: null,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    sessions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function editTask(task: Task, input: TaskInput, now: number = Date.now()): Task {
  validateTaskInput(input);
  const dueDate = input.dueDate === undefined ? task.dueDate : input.dueDate || null;
  const recurrence = dueDate ? input.recurrence ?? task.recurrence : 'none';
  const recurrenceChanged = recurrence !== task.recurrence || dueDate !== task.dueDate;
  return {
    ...task,
    title: cleanTitle(input.title),
    description: input.description === undefined ? task.description : cleanText(input.description, LIMITS.description),
    priority: input.priority ?? task.priority,
    dueDate,
    dueTime: dueDate ? (input.dueTime === undefined ? task.dueTime : input.dueTime || null) : null,
    labels: input.labels === undefined ? task.labels : cleanLabels(input.labels),
    subtasks: buildSubtasks(input.subtasks, task.subtasks),
    url: input.url === undefined ? task.url : normalizeUrl(input.url),
    recurrence,
    recurrenceAnchor: recurrence === 'none' ? null : recurrenceChanged ? dueDate : task.recurrenceAnchor ?? dueDate,
    updatedAt: now,
  };
}

export interface StatusChangeResult {
  task: Task;
  /** The next instance of a recurring task, created when it was completed. */
  spawned: Task | null;
}

function closeOpenSession(sessions: WorkSession[], now: number): WorkSession[] {
  return sessions.map((s) => (s.end === null ? { ...s, end: Math.max(now, s.start) } : s));
}

/**
 * The single place task status changes. Entering "active" opens a work
 * session; leaving it closes the session, so `sessions` always describes
 * exactly when the task was being worked on. Completed tasks are only
 * marked done — never removed or hidden.
 *
 * Completing a recurring task creates its next instance (once). The next date
 * is the first occurrence after the later of the due date and yesterday, so
 * an overdue daily task comes back today rather than on a date in the past.
 */
export function setTaskStatus(task: Task, status: TaskStatus, now: number = Date.now()): StatusChangeResult {
  if (task.status === status) return { task, spawned: null };
  let sessions = task.status === 'active' ? closeOpenSession(task.sessions, now) : task.sessions;
  if (status === 'active') sessions = [...sessions, { start: now, end: null }].slice(-LIMITS.sessions);
  const next: Task = {
    ...task,
    status,
    sessions,
    startedAt: task.startedAt ?? (status === 'active' ? now : null),
    completedAt: status === 'completed' ? now : null,
    updatedAt: now,
  };
  if (status !== 'completed') return { task: next, spawned: null };
  return spawnNextInstance(next, now);
}

function spawnNextInstance(done: Task, now: number): StatusChangeResult {
  if (done.recurrence === 'none' || !done.dueDate || done.spawnedNextId) return { task: done, spawned: null };
  const anchor = done.recurrenceAnchor ?? done.dueDate;
  const after = maxDate(done.dueDate, addDays(toLocalDate(now), -1));
  const nextDate = nextDateAfter(anchor, done.recurrence, after);
  if (!nextDate) return { task: done, spawned: null };
  const spawned: Task = {
    ...done,
    id: createId(),
    dueDate: nextDate,
    subtasks: done.subtasks.map((s) => ({ ...s, id: createId(), done: false })),
    spawnedNextId: null,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    sessions: [],
    createdAt: now,
    updatedAt: now,
  };
  return { task: { ...done, spawnedNextId: spawned.id }, spawned };
}

export const completeTask = (task: Task, now: number = Date.now()) => setTaskStatus(task, 'completed', now);
export const startTask = (task: Task, now: number = Date.now()) => setTaskStatus(task, 'active', now).task;
/** Back to pending from active or completed. */
export const reopenTask = (task: Task, now: number = Date.now()) => setTaskStatus(task, 'pending', now).task;

/** Total time spent active, optionally only the part that falls inside [from, to). */
export function timeSpentMs(task: Task, now: number = Date.now(), from = -Infinity, to = Infinity): number {
  let total = 0;
  for (const s of task.sessions) {
    const start = Math.max(s.start, from);
    const end = Math.min(s.end ?? now, to);
    if (end > start) total += end - start;
  }
  return total;
}

export function toggleSubtask(task: Task, subtaskId: string, now: number = Date.now()): Task {
  return {
    ...task,
    subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)),
    updatedAt: now,
  };
}

export function toInput(task: Task): TaskInput {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    labels: task.labels,
    subtasks: task.subtasks,
    url: task.url,
    recurrence: task.recurrence,
  };
}
