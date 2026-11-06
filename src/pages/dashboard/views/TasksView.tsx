import { useMemo, type RefObject } from 'react';
import { ArrowDownUp, Search, Trash2, X } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { QuickAdd } from '@/features/quickadd/QuickAdd';
import { TaskList } from '@/features/tasks/components/TaskList';
import { groupByDueDate, isOverdue, selectTasks } from '@/features/tasks/services/taskQueries';
import type { TaskFilters, TaskView } from '@/features/tasks/types';
import { useOopsie } from '@/hooks/useOopsie';
import { toLocalDate } from '@/utils/date';
import { copy } from '@/utils/copy';
import { formatRelativeDay, pluralize } from '@/utils/format';

interface TasksViewProps {
  view: TaskView;
  label: string | null;
  now: number;
  filters: TaskFilters;
  setFilters: (f: TaskFilters) => void;
  searchRef: RefObject<HTMLInputElement>;
  quickAddRef: RefObject<HTMLInputElement>;
}

const EMPTY = {
  today: copy.emptyToday,
  upcoming: copy.emptyUpcoming,
  overdue: copy.emptyOverdue,
  all: copy.emptyAll,
  completed: copy.emptyCompleted,
} as const;

export function TasksView({ view, label, now, filters, setFilters, searchRef, quickAddRef }: TasksViewProps) {
  const { data, service } = useOopsie();
  const actions = useActions();
  const toast = useToast();
  const showStatusFilter = view !== 'completed' && view !== 'overdue';
  const effective = useMemo(
    () => ({ ...filters, label, status: showStatusFilter ? filters.status : 'all' }) as TaskFilters,
    [filters, label, showStatusFilter],
  );
  const tasks = useMemo(() => selectTasks(data.tasks, view, effective, now), [data.tasks, view, effective, now]);
  const filtering = !!filters.search.trim() || filters.priority !== 'all' || (showStatusFilter && filters.status !== 'all');
  const today = toLocalDate(now);

  const clearCompleted = async () => {
    const res = await actions.confirm({
      title: 'Clear completed tasks?',
      message: `This permanently deletes ${pluralize(tasks.length, 'completed task')}. Linked reminders are kept.`,
      confirmLabel: 'Clear completed',
    });
    if (!res.confirmed) return;
    const n = await service.clearCompleted();
    toast({ message: `Cleared ${pluralize(n, 'task')}.`, tone: 'info' });
  };

  const empty = filtering ? copy.emptySearch : EMPTY[view];

  const renderBody = () => {
    if (tasks.length === 0) {
      return (
        <EmptyState
          title={empty.title}
          message={empty.message}
          mood={view === 'overdue' || view === 'today' ? 'happy' : 'calm'}
          action={
            filtering ? (
              <Button size="sm" onClick={() => setFilters({ ...filters, search: '', priority: 'all', status: 'all' })}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      );
    }
    if (view === 'today') {
      // Completed tasks stay in place, just marked done. Active work is pinned on top.
      const active = tasks.filter((t) => t.status === 'active');
      const overdue = tasks.filter((t) => t.status === 'pending' && isOverdue(t, now) && t.dueDate! < today);
      const rest = tasks.filter((t) => !active.includes(t) && !overdue.includes(t));
      const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed');
      return (
        <>
          {active.length > 0 && (
            <section className="group group--active">
              <h3 className="group__title">
                In progress <span className="group__count">{active.length}</span>
              </h3>
              <TaskList tasks={active} reminders={data.reminders} now={now} label="Active tasks" />
            </section>
          )}
          {overdue.length > 0 && (
            <section className="group group--overdue">
              <h3 className="group__title">
                Oops, {overdue.length === 1 ? 'this one is' : 'these are'} still waiting <span className="group__count">{overdue.length}</span>
              </h3>
              <TaskList tasks={overdue} reminders={data.reminders} now={now} label="Overdue tasks" />
            </section>
          )}
          {rest.length > 0 && (
            <section className="group">
              {(overdue.length > 0 || active.length > 0) && (
                <h3 className="group__title">
                  Today <span className="group__count">{rest.length}</span>
                </h3>
              )}
              <TaskList tasks={rest} reminders={data.reminders} now={now} label="Today's tasks" />
            </section>
          )}
          {allDone && <p className="group__note">{copy.allDone}</p>}
        </>
      );
    }
    if (view === 'upcoming' && filters.sort === 'due') {
      return groupByDueDate(tasks).map((g) => (
        <section key={g.date} className="group">
          <h3 className="group__title">
            {formatRelativeDay(g.date, now)} <span className="group__count">{g.tasks.length}</span>
          </h3>
          <TaskList tasks={g.tasks} reminders={data.reminders} now={now} label={`Tasks for ${formatRelativeDay(g.date, now)}`} />
        </section>
      ));
    }
    if (view === 'completed') {
      const groups = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const key = t.completedAt ? toLocalDate(t.completedAt) : '';
        groups.set(key, [...(groups.get(key) ?? []), t]);
      }
      return [...groups.entries()].map(([date, list]) => (
        <section key={date} className="group">
          <h3 className="group__title">
            {date ? formatRelativeDay(date, now) : 'Earlier'} <span className="group__count">{list.length}</span>
          </h3>
          <TaskList tasks={list} reminders={data.reminders} now={now} label="Completed tasks" />
        </section>
      ));
    }
    return <TaskList tasks={tasks} reminders={data.reminders} now={now} label="Tasks" />;
  };

  return (
    <div className="view">
      {view !== 'completed' && view !== 'overdue' && (
        <QuickAdd
          ref={quickAddRef}
          key={view}
          defaultDate={view === 'today' ? today : null}
          placeholder={view === 'today' ? 'Add a task for today… or “Call Sam Friday at 3pm”' : undefined}
        />
      )}

      <div className="toolbar" role="search">
        <div className="search">
          <Search size={16} className="search__icon" aria-hidden />
          <input
            ref={searchRef}
            className="search__input"
            type="search"
            placeholder="Search tasks"
            aria-label="Search tasks by title"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filters.search) {
                e.stopPropagation();
                setFilters({ ...filters, search: '' });
              }
            }}
          />
          {filters.search && (
            <IconButton label="Clear search" size="sm" className="search__clear" onClick={() => setFilters({ ...filters, search: '' })}>
              <X size={14} />
            </IconButton>
          )}
        </div>
        <select
          className="input input--select input--sm"
          aria-label="Filter by priority"
          value={filters.priority}
          onChange={(e) => setFilters({ ...filters, priority: e.target.value as TaskFilters['priority'] })}
        >
          <option value="all">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {showStatusFilter && (
          <select
            className="input input--select input--sm"
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as TaskFilters['status'] })}
          >
            <option value="all">Any status</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        )}
        {view !== 'completed' && (
          <label className="sort">
            <ArrowDownUp size={14} aria-hidden />
            <span className="sr-only">Sort by</span>
            <select
              className="input input--select input--sm"
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value as TaskFilters['sort'] })}
            >
              <option value="due">Due time</option>
              <option value="priority">Priority</option>
              <option value="created">Newest first</option>
            </select>
          </label>
        )}
        {view === 'completed' && tasks.length > 0 && !filtering && (
          <Button size="sm" variant="ghost" className="btn--danger-ghost toolbar__end" icon={<Trash2 size={14} />} onClick={() => void clearCompleted()}>
            Clear completed
          </Button>
        )}
      </div>

      <div className="view__body">{renderBody()}</div>
    </div>
  );
}
