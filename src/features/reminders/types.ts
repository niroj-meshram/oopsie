export type { Reminder, ReminderStatus, OccurrenceRecord, OccurrenceOutcome } from '@/types';

export interface ReminderInput {
  title: string;
  description?: string;
  url?: string | null;
  taskId?: string | null;
  date: string;
  time: string;
  recurrence?: import('@/types').Recurrence;
}
