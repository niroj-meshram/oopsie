import { Plus } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button } from '@/components/ui/Button';
import type { Reminder, Task } from '@/types';
import { dueReminders, nextUpcomingReminder } from '../services/reminderLogic';
import { ReminderCard } from './ReminderCard';

/** Due reminders first (they need action), otherwise the next one coming up. */
export function NextReminder({ reminders, tasks, now, compact }: { reminders: Reminder[]; tasks: Task[]; now: number; compact?: boolean }) {
  const actions = useActions();
  const due = dueReminders(reminders, now);
  const next = nextUpcomingReminder(reminders, now);
  const shown = [...due.slice(0, compact ? 2 : 3), ...(next ? [next] : [])];
  const taskOf = (r: Reminder) => (r.taskId ? tasks.find((t) => t.id === r.taskId) ?? null : null);

  return (
    <section className={`card next-reminder ${compact ? 'card--flat' : ''}`} aria-labelledby="next-reminder-title">
      <div className="card__head">
        <h3 id="next-reminder-title" className="card__title">
          {due.length ? `Needs attention${due.length > 1 ? ` (${due.length})` : ''}` : 'Next reminder'}
        </h3>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => actions.openReminder(null)}>
          Reminder
        </Button>
      </div>
      {shown.length ? (
        <ul className="reminder-list">
          {shown.map((r) => (
            <ReminderCard key={r.id} reminder={r} task={taskOf(r)} now={now} compact />
          ))}
        </ul>
      ) : (
        <p className="muted small next-reminder__empty">No reminders coming up. Future you is on their own… for now.</p>
      )}
    </section>
  );
}
