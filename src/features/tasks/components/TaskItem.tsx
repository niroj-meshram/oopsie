import { memo } from 'react';
import { Bell, CalendarDays, Clock, ExternalLink, ListChecks, Pencil, Repeat, Trash2 } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { IconButton } from '@/components/ui/Button';
import { TaskCheckbox } from '@/components/ui/Checkbox';
import { openUrl } from '@/services/chromeApi';
import type { Task } from '@/types';
import { copy } from '@/utils/copy';
import { formatClock, formatDue, formatDuration } from '@/utils/format';
import { describeRecurrence } from '@/features/reminders/services/recurrence';
import { timeSpentMs } from '../services/taskLogic';
import { isOverdue } from '../services/taskQueries';
import { StartPauseButton, TaskStatusPill } from './TaskStatusControl';

interface TaskItemProps {
  task: Task;
  now: number;
  reminderCount: number;
  compact?: boolean;
  showSubtasks?: boolean;
}

const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export const TaskItem = memo(function TaskItem({ task, now, reminderCount, compact, showSubtasks = !compact }: TaskItemProps) {
  const actions = useActions();
  const overdue = isOverdue(task, now);
  const doneSubtasks = task.subtasks.filter((s) => s.done).length;
  const done = task.status === 'completed';
  const spent = timeSpentMs(task, now);

  return (
    <li
      className={`task task--${task.status} ${overdue ? 'task--overdue' : ''} ${compact ? 'task--compact' : ''}`}
      onKeyDown={(e) => {
        // Delete key while focus is on the task's title, checkbox or buttons.
        if (e.key === 'Delete' && (e.target as HTMLElement).tagName === 'BUTTON') {
          e.preventDefault();
          actions.deleteTask(task);
        }
      }}
    >
      <TaskCheckbox
        checked={done}
        priority={task.priority}
        size={compact ? 'sm' : 'md'}
        label={done ? `Mark “${task.title}” as pending` : `Mark “${task.title}” as completed`}
        onChange={() => void actions.toggleTask(task)}
      />
      <div className="task__body">
        <button type="button" className="task__title" onClick={() => actions.openTask(task)} title="Open task">
          {task.title}
        </button>
        <div className="task__meta">
          <TaskStatusPill task={task} compact={compact} />
          {done && task.completedAt !== null && !compact && <span className="meta">Done {formatClock(task.completedAt)}</span>}
          {spent > 0 && (
            <span className={`meta ${task.status === 'active' ? 'meta--active' : ''}`} title="Time spent active">
              <Clock size={12} aria-hidden />
              {formatDuration(spent)}
            </span>
          )}
          {task.dueDate && (
            <span className={`meta ${overdue ? 'meta--danger' : ''}`} title={overdue ? copy.overdue : 'Due'}>
              <CalendarDays size={12} aria-hidden />
              {formatDue(task.dueDate, task.dueTime, now)}
              {overdue && !compact && <span className="meta__oops"> · {copy.overdue}</span>}
            </span>
          )}
          {task.priority !== 'medium' && (
            <span className={`prio prio--${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
          )}
          {task.recurrence !== 'none' && (
            <span className="meta" title={describeRecurrence(task.recurrence, task.recurrenceAnchor)}>
              <Repeat size={12} aria-hidden />
              <span className="sr-only">{describeRecurrence(task.recurrence, task.recurrenceAnchor)}</span>
            </span>
          )}
          {reminderCount > 0 && (
            <span className="meta" title={`${reminderCount} reminder${reminderCount === 1 ? '' : 's'}`}>
              <Bell size={12} aria-hidden />
              <span className="sr-only">{reminderCount} reminders</span>
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="meta" title="Subtasks">
              <ListChecks size={12} aria-hidden />
              {doneSubtasks}/{task.subtasks.length}
            </span>
          )}
          {!compact && task.labels.map((l) => <span key={l} className="label">#{l}</span>)}
        </div>
        {showSubtasks && task.subtasks.length > 0 && !done && (
          <ul className="task__subtasks">
            {task.subtasks.map((s) => (
              <li key={s.id}>
                <label className={s.done ? 'is-done' : ''}>
                  <input type="checkbox" checked={s.done} onChange={() => void actions.toggleSubtask(task, s.id)} />
                  <span>{s.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="task__actions">
        <StartPauseButton task={task} className={task.status === 'active' ? '' : 'task__hover'} />
        {task.url && (
          <IconButton label="Open saved page" size="sm" onClick={() => openUrl(task.url!)}>
            <ExternalLink size={15} />
          </IconButton>
        )}
        {!compact && (
          <IconButton label="Edit task" size="sm" className="task__hover" onClick={() => actions.openTask(task)}>
            <Pencil size={15} />
          </IconButton>
        )}
        <IconButton label={`Delete “${task.title}”`} size="sm" tone="danger" className="task__hover" onClick={() => actions.deleteTask(task)}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </li>
  );
});
