import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Globe } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { TaskValidationError } from '@/features/tasks/services/taskLogic';
import { useOopsie } from '@/hooks/useOopsie';
import type { Priority } from '@/types';
import { addDays, localToEpoch, toLocalDate } from '@/utils/date';
import { copy } from '@/utils/copy';

interface CaptureFormProps {
  initialTitle: string;
  url: string | null;
  /** Standalone window opened from the context menu or shortcut. */
  standalone: boolean;
  onDone: () => void;
}

type When = 'none' | 'today' | 'tomorrow' | 'pick';

/** "Save this page as a task": editable title, the page link attached. */
export function CaptureForm({ initialTitle, url, standalone, onDone }: CaptureFormProps) {
  const { data, service } = useOopsie();
  const toast = useToast();
  const [title, setTitle] = useState(initialTitle);
  const [link, setLink] = useState(url ?? '');
  const [when, setWhen] = useState<When>('none');
  const [date, setDate] = useState(toLocalDate(Date.now()));
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState<Priority>(data.settings.defaultPriority);
  const [remind, setRemind] = useState(true);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const today = toLocalDate(Date.now());
  const dueDate = when === 'none' ? null : when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : date || null;
  const canRemind = !!dueDate && !!time && localToEpoch(dueDate, time) > Date.now();

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const reminder = canRemind && remind && dueDate ? { title, date: dueDate, time, url: link || null } : undefined;
      await service.addTask({ title, url: link || null, dueDate, dueTime: dueDate ? time || null : null, priority, labels: [] }, reminder);
      toast({ message: reminder ? copy.reminderCreated : 'Page saved as a task.' });
      if (standalone) setTimeout(() => window.close(), 700);
      else onDone();
    } catch (err) {
      if (err instanceof TaskValidationError) setError({ field: err.field, message: err.message });
      else setError({ field: 'form', message: err instanceof Error ? err.message : "Couldn't save that." });
    } finally {
      setSaving(false);
    }
  };

  let host = '';
  try {
    host = link ? new URL(link).host : '';
  } catch {
    host = '';
  }

  return (
    <form className="capture" onSubmit={submit}>
      <div className="capture__head">
        {!standalone && (
          <IconButton label="Back" size="sm" onClick={onDone}>
            <ArrowLeft size={16} />
          </IconButton>
        )}
        <h2 className="capture__title">Save this page as a task</h2>
      </div>
      {host && (
        <p className="capture__url" title={link}>
          <Globe size={13} aria-hidden /> {host}
        </p>
      )}
      <Field label="Task title" error={error?.field === 'title' ? error.message : null}>
        {(p) => <Input {...p} ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="Read this later" />}
      </Field>
      {!url && (
        <Field label="Link" error={error?.field === 'url' ? error.message : null} hint="Oopsie can only read normal web pages (http/https).">
          {(p) => <Input {...p} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />}
        </Field>
      )}
      <div className="field">
        <span className="field__label" id="cap-when">
          When
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="cap-when">
          {(['none', 'today', 'tomorrow', 'pick'] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={when === w} className={`segmented__opt ${when === w ? 'is-active' : ''}`} onClick={() => setWhen(w)}>
              {w === 'none' ? 'Someday' : w === 'pick' ? 'Pick…' : w[0]!.toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {when !== 'none' && (
        <div className="form__row">
          {when === 'pick' && (
            <Field label="Date" error={error?.field === 'dueDate' ? error.message : null}>
              {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
          )}
          <Field label="Time (optional)">{(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
      )}
      {canRemind && (
        <label className="confirm__check">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
          <span>Remind me at that time</span>
        </label>
      )}
      <div className="field">
        <span className="field__label" id="cap-prio">
          Priority
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="cap-prio">
          {(['low', 'medium', 'high'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} className={`segmented__opt segmented__opt--${p} ${priority === p ? 'is-active' : ''}`} onClick={() => setPriority(p)}>
              {p[0]!.toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {error?.field === 'form' && (
        <p className="field__error" role="alert">
          {error.message}
        </p>
      )}
      <div className="capture__actions">
        <Button onClick={standalone ? () => window.close() : onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          Save task
        </Button>
      </div>
    </form>
  );
}
