import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Menu as MenuIcon, Plus } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { FocusCard } from '@/features/focus/components/FocusCard';
import { DailyOverview } from '@/features/insights/DailyOverview';
import { WeeklyChart } from '@/features/insights/WeeklyChart';
import { NextReminder } from '@/features/reminders/components/NextReminder';
import { dueReminders, fireTime, nextUpcomingReminder } from '@/features/reminders/services/reminderLogic';
import { SettingsView } from '@/features/settings/SettingsView';
import { allLabels, DEFAULT_FILTERS, matchesView } from '@/features/tasks/services/taskQueries';
import type { TaskFilters, TaskView } from '@/features/tasks/types';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useNow } from '@/hooks/useNow';
import { useOopsie } from '@/hooks/useOopsie';
import { toLocalDate } from '@/utils/date';
import { formatDateTime, formatLongDate, greeting, pluralize } from '@/utils/format';
import { Sidebar } from './Sidebar';
import { useHashRoute, type ViewId } from './useHashRoute';
import { RemindersView } from './views/RemindersView';
import { TasksView } from './views/TasksView';
import { TimesheetView } from './views/TimesheetView';

const TITLES: Record<ViewId, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  overdue: 'Overdue',
  all: 'All tasks',
  completed: 'Completed',
  reminders: 'Reminders',
  timesheet: 'Timesheet',
  settings: 'Settings',
};

const TASK_VIEWS: ViewId[] = ['today', 'upcoming', 'overdue', 'all', 'completed'];

export function Dashboard() {
  const { data } = useOopsie();
  const actions = useActions();
  const now = useNow();
  const { route, navigate } = useHashRoute();
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [reminderSearch, setReminderSearch] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const view = route.view;
  const label = view === 'all' ? route.params.get('label') : null;
  const isTaskView = TASK_VIEWS.includes(view);

  useEffect(() => {
    document.title = `${TITLES[view]} · Oopsie`;
    setNavOpen(false);
  }, [view]);

  const counts = useMemo(() => {
    const count = (v: TaskView) => data.tasks.filter((t) => matchesView(t, v, now)).length;
    return {
      today: count('today'),
      upcoming: count('upcoming'),
      overdue: count('overdue'),
      all: data.tasks.filter((t) => t.status !== 'completed').length,
      reminders: data.reminders.filter((r) => r.status === 'active').length,
      due: dueReminders(data.reminders, now).length,
    };
  }, [data.tasks, data.reminders, now]);

  useHotkeys({
    n: () => (quickAddRef.current ? quickAddRef.current.focus() : actions.openTask(null)),
    r: () => actions.openReminder(null),
    '/': () => searchRef.current?.focus(),
  });

  const next = nextUpcomingReminder(data.reminders, now);
  const summary = [
    counts.today ? `${pluralize(counts.today, 'task')} on today's list` : 'Nothing due today',
    counts.overdue ? `${counts.overdue} overdue` : null,
    counts.due ? `${pluralize(counts.due, 'reminder')} need attention` : next ? `next reminder ${formatDateTime(fireTime(next), now).toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`dash ${navOpen ? 'dash--nav-open' : ''}`}>
      <Sidebar view={view} label={label} labels={allLabels(data.tasks)} counts={counts} onNavigate={navigate} />
      <div className="dash__scrim" onClick={() => setNavOpen(false)} aria-hidden />
      <main className="dash__main">
        <header className="dash__header">
          <IconButton label="Open navigation" className="dash__menu" onClick={() => setNavOpen(true)}>
            <MenuIcon size={18} />
          </IconButton>
          <div className="dash__heading">
            {view === 'today' ? (
              <>
                <p className="dash__eyebrow">{formatLongDate(now)}</p>
                <h1 className="dash__title">{data.settings.playfulCopy ? `${greeting(now)}!` : 'Today'}</h1>
                <p className="dash__summary">{summary}</p>
              </>
            ) : (
              <>
                <p className="dash__eyebrow">{formatLongDate(now)}</p>
                <h1 className="dash__title">{label ? `#${label}` : TITLES[view]}</h1>
              </>
            )}
          </div>
          {view !== 'settings' && (
            <div className="dash__header-actions">
              <Button icon={<Bell size={16} />} onClick={() => actions.openReminder(null)}>
                Reminder
              </Button>
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => actions.openTask(null, view === 'today' ? { dueDate: toLocalDate(now) } : undefined)}>
                Task
              </Button>
            </div>
          )}
        </header>

        <div className={`dash__content ${view === 'settings' || view === 'timesheet' ? 'dash__content--single' : ''}`}>
          <div className="dash__primary">
            {isTaskView && (
              <TasksView
                view={view as TaskView}
                label={label}
                now={now}
                filters={filters}
                setFilters={setFilters}
                searchRef={searchRef}
                quickAddRef={quickAddRef}
              />
            )}
            {view === 'reminders' && (
              <RemindersView now={now} focusId={route.params.get('focus')} search={reminderSearch} setSearch={setReminderSearch} searchRef={searchRef} />
            )}
            {view === 'timesheet' && <TimesheetView now={now} onOpenSettings={() => navigate('settings', { section: 'ai' })} />}
            {view === 'settings' && <SettingsView />}
          </div>
          {view !== 'settings' && view !== 'timesheet' && (
            <aside className="dash__rail" aria-label="Overview">
              <FocusCard />
              <DailyOverview tasks={data.tasks} now={now} />
              {view !== 'reminders' && <NextReminder reminders={data.reminders} tasks={data.tasks} now={now} />}
              <WeeklyChart tasks={data.tasks} now={now} />
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
