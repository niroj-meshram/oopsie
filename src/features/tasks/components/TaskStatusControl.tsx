import { CheckCircle2, Circle, Pause, Play, Timer, Trash2 } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import type { Task, TaskStatus } from '@/types';

export const STATUS_META: Record<TaskStatus, { label: string; icon: typeof Circle }> = {
  pending: { label: 'Pending', icon: Circle },
  active: { label: 'Active', icon: Timer },
  completed: { label: 'Completed', icon: CheckCircle2 },
};

const ORDER: TaskStatus[] = ['pending', 'active', 'completed'];

/** Status pill that opens a menu to switch between Pending, Active and Completed. */
export function TaskStatusPill({ task, compact }: { task: Task; compact?: boolean }) {
  const actions = useActions();
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;
  return (
    <Menu
      label={`Status of “${task.title}”`}
      align="start"
      items={[
        ...ORDER.filter((s) => s !== task.status).map((s) => {
          const ItemIcon = STATUS_META[s].icon;
          return {
            label: s === 'active' ? 'Mark active (start)' : `Mark ${STATUS_META[s].label.toLowerCase()}`,
            icon: <ItemIcon size={14} />,
            onSelect: () => void actions.setStatus(task, s),
          };
        }),
        { label: 'Delete task', icon: <Trash2 size={14} />, tone: 'danger' as const, onSelect: () => actions.deleteTask(task) },
      ]}
      trigger={({ ref, ...p }) => (
        <button
          ref={ref}
          type="button"
          className={`status-pill status-pill--${task.status} ${compact ? 'status-pill--compact' : ''}`}
          aria-label={`Status: ${meta.label}. Change status`}
          {...p}
        >
          {task.status === 'active' ? <span className="status-pill__dot" aria-hidden /> : <Icon size={12} aria-hidden />}
          {meta.label}
        </button>
      )}
    />
  );
}

/** One-click start / pause for pending and active tasks. */
export function StartPauseButton({ task, className = '' }: { task: Task; className?: string }) {
  const actions = useActions();
  if (task.status === 'completed') return null;
  const active = task.status === 'active';
  return (
    <IconButton
      label={active ? 'Pause (back to pending)' : 'Start (mark active)'}
      size="sm"
      className={`${active ? 'icon-btn--active' : ''} ${className}`}
      onClick={() => void actions.setStatus(task, active ? 'pending' : 'active')}
    >
      {active ? <Pause size={15} /> : <Play size={15} />}
    </IconButton>
  );
}
