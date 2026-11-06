import { CircleAlert, CircleCheck, ListTodo, Timer } from 'lucide-react';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { dailyStats } from '@/features/tasks/services/taskQueries';
import type { Task } from '@/types';
import { copy } from '@/utils/copy';

export function DailyOverview({ tasks, now }: { tasks: Task[]; now: number }) {
  const s = dailyStats(tasks, now);
  const plan = s.completedToday + s.remainingToday + s.overdue;
  const headline =
    plan === 0 ? 'A clean slate today.' : s.remainingToday + s.overdue === 0 ? copy.allDone : `${s.remainingToday + s.overdue} to go today`;
  return (
    <section className="card overview" aria-label="Today at a glance">
      <div className="overview__top">
        <ProgressRing value={s.progress} label={`${Math.round(s.progress * 100)}% of today's tasks done`} />
        <div>
          <h3 className="overview__headline">{headline}</h3>
          <p className="muted small">
            {s.completedToday} done · {s.scheduledToday} scheduled for today
          </p>
        </div>
      </div>
      <dl className="stats">
        <div className="stat">
          <dt>
            <ListTodo size={14} aria-hidden /> Remaining
          </dt>
          <dd>{s.remainingToday}</dd>
        </div>
        <div className="stat">
          <dt>
            <Timer size={14} aria-hidden /> Active
          </dt>
          <dd>{s.activeNow}</dd>
        </div>
        <div className="stat">
          <dt>
            <CircleCheck size={14} aria-hidden /> Done
          </dt>
          <dd>{s.completedToday}</dd>
        </div>
        <div className={`stat ${s.overdue ? 'stat--danger' : ''}`}>
          <dt>
            <CircleAlert size={14} aria-hidden /> Overdue
          </dt>
          <dd>{s.overdue}</dd>
        </div>
      </dl>
    </section>
  );
}
