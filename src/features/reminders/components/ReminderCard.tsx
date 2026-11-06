import { forwardRef } from 'react';
import { AlarmClock, Bell, BellRing, Check, ExternalLink, ListTodo, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { openUrl } from '@/services/chromeApi';
import { formatSnooze } from '@/services/notifications/notificationService';
import { SNOOZE_OPTIONS, type Reminder, type Task } from '@/types';
import { formatClock, formatCountdown, formatDateTime } from '@/utils/format';
import { describeRecurrence } from '../services/recurrence';
import { fireTime, isDue, occurrenceEpoch } from '../services/reminderLogic';

interface ReminderCardProps {
  reminder: Reminder;
  task: Task | null;
  now: number;
  compact?: boolean;
  highlighted?: boolean;
}

export function SnoozeMenu({ reminder, size = 'sm' }: { reminder: Reminder; size?: 'sm' | 'md' }) {
  const actions = useActions();
  return (
    <Menu
      label="Snooze for"
      items={SNOOZE_OPTIONS.map((m) => ({ label: `Snooze ${formatSnooze(m)}`, onSelect: () => void actions.snooze(reminder, m) }))}
      trigger={({ ref, ...p }) => (
        <Button ref={ref} size={size} variant="secondary" icon={<AlarmClock size={14} />} {...p}>
          Snooze
        </Button>
      )}
    />
  );
}

export const ReminderCard = forwardRef<HTMLLIElement, ReminderCardProps>(function ReminderCard({ reminder: r, task, now, compact, highlighted }, ref) {
  const actions = useActions();
  const active = r.status === 'active';
  const due = isDue(r, now);
  const when = fireTime(r);
  const snoozed = active && r.snoozedUntil !== null;
  const late = due && now - occurrenceEpoch(r) > 5 * 60_000;

  let status: string;
  if (!active) status = r.status === 'done' ? 'Done' : 'Dismissed';
  else if (due) status = late ? `Oops, this one's still waiting — was due ${formatDateTime(occurrenceEpoch(r), now)}` : 'Due now';
  else if (snoozed) status = `Snoozed until ${formatClock(when)}`;
  else status = `${formatDateTime(when, now)} · ${formatCountdown(when, now)}`;

  return (
    <li ref={ref} className={`reminder ${due ? 'reminder--due' : ''} ${!active ? 'reminder--inactive' : ''} ${highlighted ? 'reminder--highlight' : ''} ${compact ? 'reminder--compact' : ''}`}>
      <span className="reminder__icon" aria-hidden>
        {due ? <BellRing size={16} /> : snoozed ? <AlarmClock size={16} /> : <Bell size={16} />}
      </span>
      <div className="reminder__body">
        <button type="button" className="reminder__title" onClick={() => actions.openReminder(r)}>
          {r.title}
        </button>
        <p className={`reminder__when ${due ? 'is-due' : ''}`}>{status}</p>
        {!compact && (r.recurrence !== 'none' || task || r.description) && (
          <div className="reminder__meta">
            {r.recurrence !== 'none' && <span className="meta">{describeRecurrence(r.recurrence, r.anchorDate)}</span>}
            {task && (
              <button type="button" className="meta meta--link" onClick={() => actions.openTask(task)}>
                <ListTodo size={12} aria-hidden /> {task.title}
              </button>
            )}
            {r.description && <span className="meta reminder__desc">{r.description}</span>}
          </div>
        )}
      </div>
      <div className="reminder__actions">
        {r.url && (
          <IconButton label="Open link" size="sm" onClick={() => openUrl(r.url!)}>
            <ExternalLink size={15} />
          </IconButton>
        )}
        {active ? (
          <>
            {due && <SnoozeMenu reminder={r} />}
            {due ? (
              <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => void actions.resolve(r, 'done')}>
                Done
              </Button>
            ) : null}
            <Menu
              label="Reminder actions"
              items={[
                { label: 'Edit or reschedule', icon: <Pencil size={14} />, onSelect: () => actions.openReminder(r) },
                ...(!due ? SNOOZE_OPTIONS.slice(0, 2).map((m) => ({ label: `Snooze ${formatSnooze(m)}`, icon: <AlarmClock size={14} />, onSelect: () => void actions.snooze(r, m) })) : []),
                ...(!due ? [{ label: r.recurrence === 'none' ? 'Mark done' : 'Done (skip to next)', icon: <Check size={14} />, onSelect: () => void actions.resolve(r, 'done') }] : []),
                { label: r.recurrence === 'none' ? 'Dismiss' : 'Dismiss this one', icon: <X size={14} />, onSelect: () => void actions.resolve(r, 'dismissed') },
                { label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger', onSelect: () => actions.deleteReminder(r) },
              ]}
              trigger={({ ref, ...p }) => (
                <IconButton ref={ref} label="More actions" size="sm" {...p}>
                  <MoreHorizontal size={16} />
                </IconButton>
              )}
            />
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => void actions.reactivate(r)}>
              Reactivate
            </Button>
            <IconButton label="Delete reminder" size="sm" tone="danger" onClick={() => actions.deleteReminder(r)}>
              <Trash2 size={15} />
            </IconButton>
          </>
        )}
      </div>
    </li>
  );
});
