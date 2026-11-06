import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Plus, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { describeRecurrence } from '@/features/reminders/services/recurrence';
import { fireTime } from '@/features/reminders/services/reminderLogic';
import type { Priority, Recurrence, Reminder, Task, TaskStatus } from '@/types';
import { formatDateTime, formatDuration } from '@/utils/format';
import { cleanLabels } from '@/utils/validation';
import { TaskValidationError, timeSpentMs } from '../services/taskLogic';
import { STATUS_META } from './TaskStatusControl';
import type { TaskInput } from '../types';

export interface TaskDraft {
  title?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  url?: string | null;
  priority?: Priority;
}

interface TaskDialogProps {
  open: boolean;
  task: Task | null;
  draft?: TaskDraft;
  defaultPriority: Priority;
  linkedReminders: Reminder[];
  onClose: () => void;
  onSave: (input: TaskInput, opts: { remindAtDue: boolean }) => Promise<void>;
  onDelete?: () => void;
  onAddReminder?: () => void;
  onEditReminder?: (r: Reminder) => void;
}

interface SubtaskDraft {
  id?: string;
  title: string;
  done: boolean;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function TaskDialog({
  open,
  task,
  draft,
  defaultPriority,
  linkedReminders,
  onClose,
  onSave,
  onDelete,
  onAddReminder,
  onEditReminder,
}: TaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>(defaultPriority);
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [labels, setLabels] = useState('');
  const [url, setUrl] = useState('');
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [remindAtDue, setRemindAtDue] = useState(false);
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [errors, setErrors] = useState<Partial<Record<'title' | 'dueDate' | 'dueTime' | 'url' | 'form', string>>>({});
  const [saving, setSaving] = useState(false);
  // Only re-initialise on open / task switch; live reloads must not clobber edits.
  const latest = useRef({ task, draft, defaultPriority });
  latest.current = { task, draft, defaultPriority };
  const taskId = task?.id;

  useEffect(() => {
    if (!open) return;
    const { task, draft, defaultPriority } = latest.current;
    setTitle(task?.title ?? draft?.title ?? '');
    setDescription(task?.description ?? '');
    setPriority(task?.priority ?? draft?.priority ?? defaultPriority);
    setDueDate(task?.dueDate ?? draft?.dueDate ?? '');
    setDueTime(task?.dueTime ?? draft?.dueTime ?? '');
    setRecurrence(task?.recurrence ?? 'none');
    setLabels(task?.labels.map((l) => `#${l}`).join(' ') ?? '');
    setUrl(task?.url ?? draft?.url ?? '');
    setSubtasks(task?.subtasks.map((s) => ({ ...s })) ?? []);
    setNewSubtask('');
    setRemindAtDue(false);
    setStatus(task?.status ?? 'pending');
    setErrors({});
  }, [open, taskId]);

  const addSubtask = () => {
    const t = newSubtask.trim();
    if (!t) return;
    setSubtasks((list) => [...list, { title: t, done: false }]);
    setNewSubtask('');
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (newSubtask.trim()) addSubtask();
    const input: TaskInput = {
      title,
      description,
      priority,
      dueDate: dueDate || null,
      dueTime: dueDate ? dueTime || null : null,
      recurrence: dueDate ? recurrence : 'none',
      status,
      labels: cleanLabels(labels.split(/[\s,]+/)),
      url: url.trim() || null,
      subtasks: [...subtasks, ...(newSubtask.trim() ? [{ title: newSubtask.trim(), done: false }] : [])],
    };
    setSaving(true);
    setErrors({});
    try {
      await onSave(input, { remindAtDue: remindAtDue && !!dueDate && !!dueTime });
    } catch (err) {
      if (err instanceof TaskValidationError) setErrors({ [err.field]: err.message });
      else setErrors({ form: err instanceof Error ? err.message : 'Something went wrong while saving.' });
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!task;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit task' : 'New task'}
      size="md"
      footer={
        <>
          {isEdit && onDelete && (
            <Button variant="ghost" className="dialog__footer-start btn--danger-ghost" icon={<Trash2 size={16} />} onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {isEdit ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      <form className="form" onSubmit={submit}>
        <Field label="Title" error={errors.title}>
          {(p) => (
            <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={300} autoComplete="off" />
          )}
        </Field>

        <div className="form__row">
          <Field label="Due date" error={errors.dueDate}>
            {(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
          <Field label="Time" error={errors.dueTime} hint={!dueDate ? 'Pick a date first' : undefined}>
            {(p) => <Input {...p} type="time" value={dueTime} disabled={!dueDate} onChange={(e) => setDueTime(e.target.value)} />}
          </Field>
        </div>

        <div className="form__row">
          <div className="field">
            <span className="field__label" id="prio-label">
              Priority
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="prio-label">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === p.value}
                  className={`segmented__opt segmented__opt--${p.value} ${priority === p.value ? 'is-active' : ''}`}
                  onClick={() => setPriority(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Repeat" hint={!dueDate ? 'Needs a due date' : undefined}>
            {(p) => (
              <Select {...p} value={dueDate ? recurrence : 'none'} disabled={!dueDate} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                {(['none', 'daily', 'weekly', 'monthly'] as const).map((r) => (
                  <option key={r} value={r}>
                    {describeRecurrence(r, dueDate || null)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="field">
          <span className="field__label" id="status-label">
            Status
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="status-label">
            {(['pending', 'active', 'completed'] as const).map((st) => {
              const Icon = STATUS_META[st].icon;
              return (
                <button
                  key={st}
                  type="button"
                  role="radio"
                  aria-checked={status === st}
                  className={`segmented__opt segmented__opt--status-${st} ${status === st ? 'is-active' : ''}`}
                  onClick={() => setStatus(st)}
                >
                  <Icon size={13} aria-hidden /> {STATUS_META[st].label}
                </button>
              );
            })}
          </div>
          {task && (task.sessions.length > 0 || task.completedAt) && (
            <p className="field__hint">
              {task.sessions.length > 0 && <>Time spent: {formatDuration(timeSpentMs(task))} across {task.sessions.length} session{task.sessions.length === 1 ? '' : 's'}. </>}
              {task.startedAt && <>Started {formatDateTime(task.startedAt)}. </>}
              {task.completedAt && <>Completed {formatDateTime(task.completedAt)}.</>}
            </p>
          )}
        </div>

        <Field label="Notes">
          {(p) => <Textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, context, links…" maxLength={5000} />}
        </Field>

        <div className="form__row">
          <Field label="Labels" hint="Separate with spaces, e.g. #work #errands">
            {(p) => <Input {...p} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="#work" autoComplete="off" />}
          </Field>
          <Field label="Link" error={errors.url}>
            {(p) => <Input {...p} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
          </Field>
        </div>

        <fieldset className="subtasks">
          <legend className="field__label">Subtasks</legend>
          {subtasks.length > 0 && (
            <ul className="subtasks__list">
              {subtasks.map((s, i) => (
                <li key={s.id ?? `new-${i}`} className="subtasks__item">
                  <input
                    type="checkbox"
                    checked={s.done}
                    aria-label={`Mark “${s.title}” ${s.done ? 'not done' : 'done'}`}
                    onChange={() => setSubtasks((list) => list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                  />
                  <input
                    className="subtasks__title"
                    value={s.title}
                    aria-label="Subtask title"
                    onChange={(e) => setSubtasks((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <IconButton label="Remove subtask" size="sm" onClick={() => setSubtasks((list) => list.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="subtasks__add">
            <Input
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              placeholder="Add a subtask and press Enter"
              aria-label="New subtask"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSubtask();
                }
              }}
            />
            <IconButton label="Add subtask" onClick={addSubtask} disabled={!newSubtask.trim()}>
              <Plus size={16} />
            </IconButton>
          </div>
        </fieldset>

        <section className="linked">
          <div className="linked__head">
            <span className="field__label">Reminders</span>
            {isEdit && onAddReminder && (
              <Button size="sm" variant="ghost" icon={<Bell size={14} />} onClick={onAddReminder}>
                Add reminder
              </Button>
            )}
          </div>
          {isEdit ? (
            linkedReminders.length ? (
              <ul className="linked__list">
                {linkedReminders.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="linked__item" onClick={() => onEditReminder?.(r)}>
                      <Bell size={14} aria-hidden />
                      <span>{r.status === 'active' ? formatDateTime(fireTime(r)) : `${r.status === 'done' ? 'Done' : 'Dismissed'}`}</span>
                      {r.recurrence !== 'none' && <span className="muted">· {describeRecurrence(r.recurrence, r.anchorDate)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No reminders for this task yet.</p>
            )
          ) : (
            <label className={`confirm__check ${!dueDate || !dueTime ? 'is-disabled' : ''}`}>
              <input type="checkbox" checked={remindAtDue} disabled={!dueDate || !dueTime} onChange={(e) => setRemindAtDue(e.target.checked)} />
              <span>{dueDate && dueTime ? 'Remind me at the due time' : 'Set a due date and time to add a reminder'}</span>
            </label>
          )}
        </section>

        {errors.form && (
          <p className="field__error" role="alert">
            {errors.form}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
