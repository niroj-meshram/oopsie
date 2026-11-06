import type { Reminder, Task } from '@/types';
import { TaskItem } from './TaskItem';

export function TaskList({ tasks, reminders, now, compact, label }: { tasks: Task[]; reminders: Reminder[]; now: number; compact?: boolean; label: string }) {
  const counts = new Map<string, number>();
  for (const r of reminders) if (r.taskId && r.status === 'active') counts.set(r.taskId, (counts.get(r.taskId) ?? 0) + 1);
  return (
    <ul className="task-list" aria-label={label}>
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} now={now} reminderCount={counts.get(t.id) ?? 0} compact={compact} />
      ))}
    </ul>
  );
}
