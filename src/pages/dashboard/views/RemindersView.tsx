import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ReminderCard } from '@/features/reminders/components/ReminderCard';
import { compareReminders, isDue } from '@/features/reminders/services/reminderLogic';
import { useOopsie } from '@/hooks/useOopsie';
import type { Reminder } from '@/types';
import { copy } from '@/utils/copy';

interface RemindersViewProps {
  now: number;
  focusId: string | null;
  search: string;
  setSearch: (s: string) => void;
  searchRef: RefObject<HTMLInputElement>;
}

export function RemindersView({ now, focusId, search, setSearch, searchRef }: RemindersViewProps) {
  const { data } = useOopsie();
  const actions = useActions();
  const [showFinished, setShowFinished] = useState(false);
  const focusRef = useRef<HTMLLIElement>(null);
  const tasksById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);

  const q = search.trim().toLowerCase();
  const list = useMemo(
    () => data.reminders.filter((r) => !q || `${r.title} ${r.description}`.toLowerCase().includes(q)).sort(compareReminders),
    [data.reminders, q],
  );
  const due = list.filter((r) => isDue(r, now));
  const scheduled = list.filter((r) => r.status === 'active' && !isDue(r, now));
  const finished = list.filter((r) => r.status !== 'active').sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    if (!focusId) return;
    if (finished.some((r) => r.id === focusId)) setShowFinished(true);
    const t = setTimeout(() => focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const render = (items: Reminder[], label: string) => (
    <ul className="reminder-list" aria-label={label}>
      {items.map((r) => (
        <ReminderCard
          key={r.id}
          ref={r.id === focusId ? focusRef : undefined}
          reminder={r}
          task={r.taskId ? tasksById.get(r.taskId) ?? null : null}
          now={now}
          highlighted={r.id === focusId}
        />
      ))}
    </ul>
  );

  return (
    <div className="view">
      <div className="toolbar" role="search">
        <div className="search">
          <Search size={16} className="search__icon" aria-hidden />
          <input
            ref={searchRef}
            className="search__input"
            type="search"
            placeholder="Search reminders"
            aria-label="Search reminders"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button className="toolbar__end" variant="primary" icon={<Plus size={16} />} onClick={() => actions.openReminder(null)}>
          New reminder
        </Button>
      </div>
      {list.length === 0 ? (
        <EmptyState
          title={q ? copy.emptySearch.title : copy.emptyReminders.title}
          message={q ? copy.emptySearch.message : copy.emptyReminders.message}
          action={
            !q && (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => actions.openReminder(null)}>
                Set your first reminder
              </Button>
            )
          }
        />
      ) : (
        <div className="view__body">
          {due.length > 0 && (
            <section className="group group--due">
              <h3 className="group__title">
                Needs attention <span className="group__count">{due.length}</span>
              </h3>
              {render(due, 'Due reminders')}
            </section>
          )}
          <section className="group">
            <h3 className="group__title">
              Scheduled <span className="group__count">{scheduled.length}</span>
            </h3>
            {scheduled.length ? render(scheduled, 'Scheduled reminders') : <p className="muted small group__empty">Nothing scheduled. Enjoy the quiet.</p>}
          </section>
          {finished.length > 0 && (
            <section className="group group--done">
              <button type="button" className="group__toggle" aria-expanded={showFinished} onClick={() => setShowFinished((v) => !v)}>
                <ChevronDown size={16} className={showFinished ? 'is-open' : ''} aria-hidden /> Done &amp; dismissed{' '}
                <span className="group__count">{finished.length}</span>
              </button>
              {showFinished && render(finished, 'Finished reminders')}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
