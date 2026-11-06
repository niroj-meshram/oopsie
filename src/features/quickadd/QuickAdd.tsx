import { forwardRef, useMemo, useState, type KeyboardEvent } from 'react';
import { Bell, BellOff, CalendarDays, Clock, Flag, Hash, Plus, Repeat, X } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { describeRecurrence } from '@/features/reminders/services/recurrence';
import { useOopsie } from '@/hooks/useOopsie';
import type { Priority } from '@/types';
import { localToEpoch, toLocalDate } from '@/utils/date';
import { copy } from '@/utils/copy';
import { formatRelativeDay, formatTime } from '@/utils/format';
import { parseQuickAdd, type TokenKind } from './parser';

interface QuickAddProps {
  /** Date applied when the text doesn't mention one (e.g. "today" in the Today view). */
  defaultDate?: string | null;
  placeholder?: string;
  compact?: boolean;
}

const PRIORITY_CYCLE: (Priority | null)[] = [null, 'high', 'medium', 'low'];

/**
 * Type, see what Oopsie understood as chips, press Enter. Any chip can be
 * dismissed (its words go back into the title) before saving.
 */
export const QuickAdd = forwardRef<HTMLInputElement, QuickAddProps>(function QuickAdd(
  { defaultDate = null, placeholder = 'Add a task… try “Call Sam Friday at 3pm #work”', compact },
  ref,
) {
  const { data, service } = useOopsie();
  const toast = useToast();
  const [text, setText] = useState('');
  const [disabled, setDisabled] = useState<Set<TokenKind>>(new Set());
  const [useDefaultDate, setUseDefaultDate] = useState(true);
  // undefined = follow the text; null/Priority = user override via the chip.
  const [manualPriority, setManualPriority] = useState<Priority | null | undefined>(undefined);
  const [remind, setRemind] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseQuickAdd(text, Date.now(), { disabled }), [text, disabled]);
  const dueDate = parsed.dueDate ?? (useDefaultDate ? defaultDate : null);
  const dueTime = parsed.dueDate ? parsed.dueTime : null;
  const priority = manualPriority !== undefined ? manualPriority : parsed.priority;
  const canRemind = !!dueDate && !!dueTime;
  const remindOn = canRemind && (remind ?? data.settings.autoReminderFromQuickAdd);
  const hasInput = text.trim().length > 0;

  const reset = () => {
    setText('');
    setDisabled(new Set());
    setUseDefaultDate(true);
    setManualPriority(undefined);
    setRemind(null);
    setError(null);
  };

  const dismiss = (kind: TokenKind) => setDisabled((s) => new Set(s).add(kind));

  const submit = async () => {
    const title = parsed.title || text.trim();
    if (!title) {
      setError('Type what you need to do first.');
      return;
    }
    setBusy(true);
    try {
      let reminder: { title: string; date: string; time: string; recurrence: typeof parsed.recurrence } | undefined;
      let skippedReminder = false;
      if (remindOn && dueDate && dueTime) {
        if (parsed.recurrence !== 'none' || localToEpoch(dueDate, dueTime) > Date.now()) {
          reminder = { title, date: dueDate, time: dueTime, recurrence: parsed.recurrence };
        } else skippedReminder = true;
      }
      await service.addTask(
        {
          title,
          dueDate,
          dueTime,
          recurrence: dueDate ? parsed.recurrence : 'none',
          priority: priority ?? undefined,
          labels: parsed.labels,
        },
        reminder,
      );
      toast({
        message: reminder ? copy.reminderCreated : skippedReminder ? 'Task added. That time already passed, so no reminder was set.' : 'Task added.',
        tone: skippedReminder ? 'info' : 'success',
      });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that task.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && hasInput) {
      e.preventDefault();
      e.stopPropagation();
      reset();
    }
  };

  const token = (kind: TokenKind) => parsed.tokens.find((t) => t.kind === kind)?.text;
  const isToday = dueDate === toLocalDate(Date.now());

  return (
    <div className={`quickadd ${compact ? 'quickadd--compact' : ''} ${hasInput ? 'is-active' : ''}`}>
      <div className="quickadd__bar">
        <Plus size={18} className="quickadd__plus" aria-hidden />
        <input
          ref={ref}
          className="quickadd__input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Quick add task"
          aria-describedby="quickadd-preview"
          maxLength={400}
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="button" className="btn btn--primary btn--sm quickadd__submit" onClick={() => void submit()} disabled={!hasInput || busy}>
          Add
        </button>
      </div>

      {hasInput && (
        <div className="quickadd__chips" id="quickadd-preview" aria-live="polite">
          {dueDate ? (
            <span className="chip chip--accent" title={token('date') ? `From “${token('date')}”` : 'Default date'}>
              <CalendarDays size={12} aria-hidden />
              {isToday ? 'Today' : formatRelativeDay(dueDate)}
              <button
                type="button"
                className="chip__x"
                aria-label="Remove date"
                onClick={() => (parsed.dueDate ? dismiss('date') : setUseDefaultDate(false))}
              >
                <X size={11} />
              </button>
            </span>
          ) : (
            <span className="chip chip--ghost">
              <CalendarDays size={12} aria-hidden /> No date
            </span>
          )}
          {dueTime && (
            <span className="chip chip--accent">
              <Clock size={12} aria-hidden />
              {formatTime(dueTime)}
              <button type="button" className="chip__x" aria-label="Remove time" onClick={() => dismiss('time')}>
                <X size={11} />
              </button>
            </span>
          )}
          {parsed.recurrence !== 'none' && (
            <span className="chip chip--accent">
              <Repeat size={12} aria-hidden />
              {describeRecurrence(parsed.recurrence, dueDate)}
              <button type="button" className="chip__x" aria-label="Remove repeat" onClick={() => dismiss('recurrence')}>
                <X size={11} />
              </button>
            </span>
          )}
          {parsed.labels.map((l) => (
            <span key={l} className="chip">
              <Hash size={12} aria-hidden />
              {l}
            </span>
          ))}
          <button
            type="button"
            className={`chip chip--button ${priority ? `chip--prio-${priority}` : ''}`}
            title="Change priority"
            onClick={() => {
              const i = PRIORITY_CYCLE.indexOf(priority);
              setManualPriority(PRIORITY_CYCLE[(i + 1) % PRIORITY_CYCLE.length] ?? null);
            }}
          >
            <Flag size={12} aria-hidden />
            {priority ? `${priority[0]!.toUpperCase()}${priority.slice(1)}` : `Priority: ${data.settings.defaultPriority}`}
          </button>
          {canRemind && (
            <button
              type="button"
              className={`chip chip--button ${remindOn ? 'chip--on' : ''}`}
              aria-pressed={remindOn}
              onClick={() => setRemind(!remindOn)}
            >
              {remindOn ? <Bell size={12} aria-hidden /> : <BellOff size={12} aria-hidden />}
              {remindOn ? 'Remind me' : 'No reminder'}
            </button>
          )}
          {parsed.title && parsed.title !== text.trim() && (
            <span className="quickadd__title-preview">
              Title: <strong>{parsed.title}</strong>
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="field__error quickadd__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
