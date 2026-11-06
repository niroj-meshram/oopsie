export type { Task, Subtask, Priority, Recurrence } from '@/types';

export type TaskView = 'today' | 'upcoming' | 'overdue' | 'all' | 'completed';
export type TaskSort = 'due' | 'priority' | 'created';
export type StatusFilter = 'all' | 'pending' | 'active' | 'completed';
export type PriorityFilter = 'all' | 'low' | 'medium' | 'high';

export interface TaskFilters {
  search: string;
  priority: PriorityFilter;
  status: StatusFilter;
  label: string | null;
  sort: TaskSort;
}

export interface TaskInput {
  title: string;
  description?: string;
  priority?: import('@/types').Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  labels?: string[];
  subtasks?: { id?: string; title: string; done?: boolean }[];
  url?: string | null;
  recurrence?: import('@/types').Recurrence;
  status?: import('@/types').TaskStatus;
}
