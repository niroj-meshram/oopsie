import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, ListChecks, Settings2, Sparkles } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { STATUS_META } from '@/features/tasks/components/TaskStatusControl';
import { buildDayReport, buildPrompt, localSummary, type EntryKind } from '@/features/timesheet/timesheetLogic';
import { useOopsie } from '@/hooks/useOopsie';
import { GeminiError } from '@/services/ai/gemini';
import { addDays, isValidLocalDate, toLocalDate } from '@/utils/date';
import { formatDuration, formatRelativeDay } from '@/utils/format';

const KIND_LABEL: Record<EntryKind, string> = { completed: 'Completed', 'in-progress': 'In progress', planned: 'Planned' };

type Source = 'quick' | 'ai' | 'edited';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where the async clipboard API is unavailable.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function TimesheetView({ now, onOpenSettings }: { now: number; onOpenSettings: () => void }) {
  const { data, service } = useOopsie();
  const actions = useActions();
  const toast = useToast();
  const [date, setDate] = useState(() => toLocalDate(Date.now()));
  // Defaults follow the usual timesheet style: what was done, no durations.
  const [includePlanned, setIncludePlanned] = useState(false);
  const [includeTime, setIncludeTime] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [text, setText] = useState('');
  const [source, setSource] = useState<Source>('quick');
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const report = useMemo(() => buildDayReport(data.tasks, date, now, { includePlanned }), [data.tasks, date, now, includePlanned]);
  const quick = useMemo(() => localSummary(report, { includeTime }, now), [report, includeTime, now]);
  const isToday = date === toLocalDate(now);

  useEffect(() => {
    void service.getAiConfig().then((c) => setHasKey(c.keySource !== 'none'));
  }, [service]);

  // Keep the quick summary in sync until the user edits it or asks Gemini.
  useEffect(() => {
    if (source === 'quick') setText(quick);
  }, [quick, source]);

  // A different day starts fresh.
  useEffect(() => {
    abortRef.current?.abort();
    setSource('quick');
    setModel(null);
    setError(null);
  }, [date]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async () => {
    if (!report.entries.length) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const res = await service.generateTimesheet(buildPrompt(report, { includeTime, includeNotes, styleExamples: data.settings.timesheetExamples }), controller.signal);
      if (controller.signal.aborted) return;
      setText(res.text);
      setSource('ai');
      setModel(res.model);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof GeminiError ? err.message : 'Something went wrong talking to Gemini.');
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  };

  const copy = async () => {
    if (!text.trim()) return;
    const ok = await copyText(text.trim());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast({ message: 'Timesheet copied. Paste away!' });
    } else {
      toast({ tone: 'error', message: "Couldn't copy automatically — select the text and press Ctrl+C." });
    }
  };

  const counts = report.entries.reduce<Record<EntryKind, number>>(
    (acc, e) => ({ ...acc, [e.kind]: acc[e.kind] + 1 }),
    { completed: 0, 'in-progress': 0, planned: 0 },
  );

  return (
    <div className="timesheet">
      <section className="card timesheet__day" aria-labelledby="ts-day-title">
        <div className="card__head">
          <h2 id="ts-day-title" className="card__title">
            <ListChecks size={16} aria-hidden /> {formatRelativeDay(date, now)}
          </h2>
          <div className="datenav">
            <IconButton label="Previous day" size="sm" onClick={() => setDate((d) => addDays(d, -1))}>
              <ChevronLeft size={16} />
            </IconButton>
            <input
              type="date"
              className="input input--sm datenav__input"
              aria-label="Timesheet date"
              value={date}
              max={toLocalDate(now)}
              onChange={(e) => isValidLocalDate(e.target.value) && setDate(e.target.value)}
            />
            <IconButton label="Next day" size="sm" disabled={isToday} onClick={() => setDate((d) => addDays(d, 1))}>
              <ChevronRight size={16} />
            </IconButton>
            {!isToday && (
              <Button size="sm" variant="ghost" onClick={() => setDate(toLocalDate(Date.now()))}>
                Today
              </Button>
            )}
          </div>
        </div>

        <div className="timesheet__totals">
          <span>
            <strong>{formatDuration(report.totalMs)}</strong> tracked
          </span>
          <span>{counts.completed} completed</span>
          <span>{counts['in-progress']} in progress</span>
          {includePlanned && <span>{counts.planned} planned</span>}
        </div>

        {report.entries.length ? (
          <ul className="ts-list">
            {report.entries.map((e) => {
              const Icon = STATUS_META[e.status].icon;
              return (
                <li key={e.task.id} className={`ts-row ts-row--${e.kind}`}>
                  <Icon size={15} className="ts-row__icon" aria-hidden />
                  <button type="button" className="ts-row__title" onClick={() => actions.openTask(e.task)}>
                    {e.task.title}
                  </button>
                  <span className={`ts-kind ts-kind--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                  <span className="ts-row__time">{e.timeMs > 0 ? formatDuration(e.timeMs) : '—'}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            compact
            mood="calm"
            title="Nothing tracked for this day."
            message="Press ▶ on a task when you start it and tick it when it's done — it will show up here."
          />
        )}

        <fieldset className="ts-options">
          <legend className="sr-only">Summary options</legend>
          <label className="confirm__check">
            <input type="checkbox" checked={includePlanned} onChange={(e) => setIncludePlanned(e.target.checked)} />
            <span>Include planned tasks that weren't started</span>
          </label>
          <label className="confirm__check">
            <input type="checkbox" checked={includeTime} onChange={(e) => setIncludeTime(e.target.checked)} />
            <span>Include time spent</span>
          </label>
          <label className="confirm__check">
            <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
            <span>Let Gemini use task notes and subtasks for detail</span>
          </label>
        </fieldset>
      </section>

      <section className="card timesheet__summary" aria-labelledby="ts-sum-title">
        <div className="card__head">
          <h2 id="ts-sum-title" className="card__title">
            Timesheet summary
          </h2>
          <span className="muted small">{source === 'ai' && model ? `Written by ${model}` : source === 'edited' ? 'Edited' : 'Quick summary'}</span>
        </div>

        <div className="ts-actions">
          <Button variant="primary" icon={<Sparkles size={16} />} loading={busy} disabled={!report.entries.length || hasKey === false} onClick={() => void generate()}>
            {busy ? 'Writing…' : source === 'ai' ? 'Regenerate with Gemini' : 'Generate with Gemini'}
          </Button>
          <Button
            disabled={!report.entries.length}
            onClick={() => {
              abortRef.current?.abort();
              setBusy(false);
              setSource('quick');
              setText(quick);
              setModel(null);
              setError(null);
            }}
          >
            Quick summary
          </Button>
        </div>
        {hasKey === false && (
          <p className="ts-hint">
            Add your Gemini API key to write polished summaries.{' '}
            <button type="button" className="link-btn" onClick={onOpenSettings}>
              <Settings2 size={12} aria-hidden /> Open AI settings
            </button>
          </p>
        )}
        {error && (
          <p className="field__error" role="alert">
            {error}{' '}
            {/key/i.test(error) && (
              <button type="button" className="link-btn" onClick={onOpenSettings}>
                Open AI settings
              </button>
            )}
          </p>
        )}

        <label className="sr-only" htmlFor="ts-output">
          Timesheet text
        </label>
        <textarea
          id="ts-output"
          className="input input--textarea ts-output"
          rows={12}
          value={text}
          placeholder="- Worked on …"
          onChange={(e) => {
            setText(e.target.value);
            setSource('edited');
          }}
        />

        <div className="ts-footer">
          <span className="muted small">
            {text.trim() ? `${text.trim().split('\n').length} points` : 'Nothing to copy yet'}
          </span>
          <Button variant="primary" icon={copied ? <Check size={16} /> : <Copy size={16} />} disabled={!text.trim()} onClick={() => void copy()}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
        <p className="muted small ts-privacy">
          “Generate with Gemini” sends this day's task titles, statuses and times{includeNotes ? ', plus notes and subtasks,' : ''} to Google Gemini using your
          key. The quick summary never leaves your browser.
        </p>
      </section>
    </div>
  );
}
