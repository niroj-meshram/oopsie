import { useState } from 'react';
import { BellRing, Play, Plus, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useNow } from '@/hooks/useNow';
import { useOopsie } from '@/hooks/useOopsie';
import { formatClock } from '@/utils/format';
import {
  FOCUS_EXTEND_MINUTES,
  FOCUS_PRESETS,
  focusProgress,
  focusRemainingMs,
  formatCountdown,
  isValidFocusMinutes,
  MAX_FOCUS_MINUTES,
  MIN_FOCUS_MINUTES,
} from '../services/focusLogic';

/**
 * Start a focus timer, watch it count down, and see when it's over. The
 * background worker owns the alarm, badge and notification, so closing the
 * popup or dashboard never stops the timer.
 */
export function FocusCard({ compact }: { compact?: boolean }) {
  const { data, service } = useOopsie();
  const toast = useToast();
  const now = useNow(1000);
  const focus = data.focus;
  const [minutesText, setMinutesText] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const text = minutesText ?? String(data.settings.defaultFocusMinutes);
  const minutes = Number(text);
  const valid = isValidFocusMinutes(minutes);

  const run = (action: Promise<unknown>, failure: string) => void action.catch(() => toast({ tone: 'error', message: failure }));
  const start = () => {
    run(service.startFocus(minutes, label), "Couldn't start the focus timer.");
    setLabel('');
  };

  if (focus && now < focus.endsAt) {
    const left = focusRemainingMs(focus, now);
    return (
      <section className={`card focus focus--running ${compact ? 'card--flat focus--compact' : ''}`} aria-labelledby="focus-title">
        <div className="card__head">
          <h3 id="focus-title" className="card__title">
            <Timer size={16} aria-hidden /> Focusing
          </h3>
          <span className="muted small">ends {formatClock(focus.endsAt)}</span>
        </div>
        <div className="focus__clock" role="timer" aria-live="off" aria-label={`${Math.ceil(left / 60_000)} minutes left`}>
          {formatCountdown(left)}
        </div>
        {focus.label && <p className="focus__label">{focus.label}</p>}
        <div className="focus__bar" aria-hidden>
          <span style={{ width: `${focusProgress(focus, now) * 100}%` }} />
        </div>
        <div className="focus__actions">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => run(service.extendFocus(FOCUS_EXTEND_MINUTES), "Couldn't add time.")}>
            {FOCUS_EXTEND_MINUTES} min
          </Button>
          <Button size="sm" variant="ghost" icon={<Square size={13} />} onClick={() => run(service.stopFocus(), "Couldn't stop the timer.")}>
            Stop
          </Button>
        </div>
      </section>
    );
  }

  if (focus) {
    return (
      <section className={`card focus focus--ended ${compact ? 'card--flat focus--compact' : ''}`} aria-labelledby="focus-title" role="alert">
        <div className="card__head">
          <h3 id="focus-title" className="card__title">
            <BellRing size={16} aria-hidden /> Focus time&apos;s up!
          </h3>
          <span className="muted small">ended {formatClock(focus.endsAt)}</span>
        </div>
        <p className="small">
          {focus.durationMinutes} min{focus.label ? ` on “${focus.label}”` : ''} done. Take a breather.
        </p>
        <div className="focus__actions">
          <Button size="sm" variant="primary" icon={<Play size={14} />} onClick={() => run(service.startFocus(focus.durationMinutes, focus.label), "Couldn't start the focus timer.")}>
            Again ({focus.durationMinutes} min)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run(service.stopFocus(), "Couldn't dismiss the timer.")}>
            Dismiss
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={`card focus ${compact ? 'card--flat focus--compact' : ''}`} aria-labelledby="focus-title">
      <div className="card__head">
        <h3 id="focus-title" className="card__title">
          <Timer size={16} aria-hidden /> Focus time
        </h3>
      </div>
      <form
        className="focus__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) start();
        }}
      >
        <div className="focus__picker">
          <div className="segmented focus__presets" role="radiogroup" aria-label="Focus length">
            {FOCUS_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                className={`segmented__opt ${minutes === m ? 'is-active' : ''}`}
                onClick={() => setMinutesText(String(m))}
              >
                {m}m
              </button>
            ))}
          </div>
          <label className="focus__custom">
            <Input
              type="number"
              inputMode="numeric"
              min={MIN_FOCUS_MINUTES}
              max={MAX_FOCUS_MINUTES}
              step={1}
              value={text}
              aria-label="Focus length in minutes"
              aria-invalid={!valid || undefined}
              className="input--sm"
              onChange={(e) => setMinutesText(e.target.value)}
            />
            <span className="muted small">min</span>
          </label>
        </div>
        {!compact && (
          <Input
            className="input--sm"
            placeholder="What are you focusing on? (optional)"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="What are you focusing on?"
          />
        )}
        {!valid && (
          <p className="field__error" role="alert">
            Pick between {MIN_FOCUS_MINUTES} and {MAX_FOCUS_MINUTES} minutes.
          </p>
        )}
        <Button type="submit" size="sm" variant="primary" icon={<Play size={14} />} disabled={!valid}>
          Start {valid ? `${minutes} min ` : ''}focus
        </Button>
      </form>
    </section>
  );
}
