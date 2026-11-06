import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import type { Recurrence, Reminder, Task } from '@/types';
import { addDays, toLocalDate, toLocalTime, weekdayOf } from '@/utils/date';
import { describeRecurrence } from '../services/recurrence';
import { ReminderValidationError } from '../services/reminderLogic';
import type { ReminderInput } from '../types';

export interface ReminderDraft {
  title?: string;
  taskId?: string | null;
  date?: string;
  time?: string;
  url?: string | null;
}

interface ReminderDialogProps {
  open: boolean;
  reminder: Reminder | null;
  draft?: ReminderDraft;
  tasks: Task[];
  onClose: () => void;
  onSave: (input: ReminderInput) => Promise<void>;
  onDelete?: () => void;
}

interface Preset {
  label: string;
  get(now: number): { date: string; time: string };
}

const roundUp = (epoch: number, minutes: number) => Math.ceil(epoch / (minutes * 60_000)) * minutes * 60_000;

const PRESETS: Preset[] = [
  { label: 'In 1 hour', get: (now) => { const t = roundUp(now + 60 * 60_000, 5); return { date: toLocalDate(t), time: toLocalTime(t) }; } },
  {
    label: 'This evening',
    get: (now) => {
      const today = toLocalDate(now);
      const evening = new Date(now).getHours() < 18;
      return { date: evening ? today : addDays(today, 1), time: '18:00' };
    },
  },
  { label: 'Tomorrow 9 AM', get: (now) => ({ date: addDays(toLocalDate(now), 1), time: '09:00' }) },
  {
    label: 'Next Monday',
    get: (now) => {
      const today = toLocalDate(now);
      const delta = ((1 - weekdayOf(today) + 7) % 7) || 7;
      return { date: addDays(today, delta), time: '09:00' };
    },
  },
];

function defaultWhen(now: number) {
  const t = roundUp(now + 30 * 60_000, 15);
  return { date: toLocalDate(t), time: toLocalTime(t) };
}

export function ReminderDialog({ open, reminder, draft, tasks, onClose, onSave, onDelete }: ReminderDialogProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [taskId, setTaskId] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'title' | 'date' | 'time' | 'url' | 'form', string>>>({});
  const [saving, setSaving] = useState(false);
  // Live data reloads must not reset a form the user is typing in, so the
  // form only re-initialises when the dialog opens or the reminder changes.
  const latest = useRef({ reminder, draft, tasks });
  latest.current = { reminder, draft, tasks };
  const reminderId = reminder?.id;

  useEffect(() => {
    if (!open) return;
    const { reminder, draft, tasks } = latest.current;
    const when = defaultWhen(Date.now());
    const linked = draft?.taskId ? tasks.find((t) => t.id === draft.taskId) : undefined;
    setTitle(reminder?.title ?? draft?.title ?? linked?.title ?? '');
    setDate(reminder?.anchorDate ?? draft?.date ?? linked?.dueDate ?? when.date);
    setTime(reminder?.time ?? draft?.time ?? linked?.dueTime ?? when.time);
    setRecurrence(reminder?.recurrence ?? 'none');
    setDescription(reminder?.description ?? '');
    setUrl(reminder?.url ?? draft?.url ?? linked?.url ?? '');
    setTaskId(reminder?.taskId ?? draft?.taskId ?? '');
    setErrors({});
  }, [open, reminderId]);

  const taskOptions = useMemo(
    () => tasks.filter((t) => t.status !== 'completed' || t.id === taskId).sort((a, b) => a.title.localeCompare(b.title)),
    [tasks, taskId],
  );

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await onSave({ title, date, time, recurrence, description, url: url.trim() || null, taskId: taskId || null });
    } catch (err) {
      if (err instanceof ReminderValidationError) setErrors({ [err.field]: err.message });
      else setErrors({ form: err instanceof Error ? err.message : 'Something went wrong while saving.' });
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!reminder;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit reminder' : 'New reminder'}
      description={isEdit ? undefined : "Oopsie will nudge you with a desktop notification, even if the popup is closed."}
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
            {isEdit ? 'Save changes' : 'Set reminder'}
          </Button>
        </>
      }
    >
      <form className="form" onSubmit={submit}>
        <Field label="Remind me to…" error={errors.title}>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up with Priya" maxLength={300} autoComplete="off" />}
        </Field>

        <div className="presets" role="group" aria-label="Quick times">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip chip--button"
              onClick={() => {
                const v = p.get(Date.now());
                setDate(v.date);
                setTime(v.time);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="form__row">
          <Field label="Date" error={errors.date}>
            {(p) => <Input {...p} type="date" value={date} required onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Time" error={errors.time}>
            {(p) => <Input {...p} type="time" value={time} required onChange={(e) => setTime(e.target.value)} />}
          </Field>
        </div>

        <div className="form__row">
          <Field label="Repeat">
            {(p) => (
              <Select {...p} value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                {(['none', 'daily', 'weekly', 'monthly'] as const).map((r) => (
                  <option key={r} value={r}>
                    {describeRecurrence(r, date || null)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="For task" hint="Optional">
            {(p) => (
              <Select {...p} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">No task</option>
                {taskOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title.length > 60 ? `${t.title.slice(0, 57)}…` : t.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Notes">
          {(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown in the notification" maxLength={5000} />}
        </Field>
        <Field label="Link" error={errors.url} hint="Optional — handy for follow-ups">
          {(p) => <Input {...p} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
        </Field>
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
