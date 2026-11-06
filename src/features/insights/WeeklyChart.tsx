import { weeklyCompletions } from '@/features/tasks/services/taskQueries';
import type { Task } from '@/types';
import { formatRelativeDay, formatShortWeekday } from '@/utils/format';

/** Tasks completed per day over the last seven days. Single series: no legend. */
export function WeeklyChart({ tasks, now }: { tasks: Task[]; now: number }) {
  const days = weeklyCompletions(tasks, now);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const best = days.reduce((a, b) => (b.count > a.count ? b : a), days[0]!);
  return (
    <section className="card weekly" aria-labelledby="weekly-title">
      <div className="card__head">
        <h3 id="weekly-title" className="card__title">
          Last 7 days
        </h3>
        <span className="muted small">{total} completed</span>
      </div>
      <div className="weekly__chart" aria-hidden="true">
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          const label = `${formatRelativeDay(d.date, now)}: ${d.count} completed`;
          return (
            <div key={d.date} className="weekly__col" title={label} data-tip={label}>
              <span className="weekly__value">{d.count > 0 ? d.count : ''}</span>
              <div className="weekly__track">
                <div
                  className={`weekly__bar ${isToday ? 'is-today' : ''} ${d.count === 0 ? 'is-zero' : ''}`}
                  style={{ height: `${d.count === 0 ? 3 : Math.max(8, (d.count / max) * 100)}%` }}
                />
              </div>
              <span className={`weekly__day ${isToday ? 'is-today' : ''}`}>{isToday ? 'Today' : formatShortWeekday(d.date)}</span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Tasks completed per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatRelativeDay(d.date, now)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small weekly__foot">
        {total === 0 ? 'Finish a task and it shows up here.' : best.count > 0 ? `Best day: ${formatRelativeDay(best.date, now)} (${best.count}).` : ''}
      </p>
    </section>
  );
}
