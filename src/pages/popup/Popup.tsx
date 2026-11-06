import { useEffect, useMemo, useState } from 'react';
import { Bell, BookmarkPlus, ClipboardList, LayoutDashboard } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mascot } from '@/components/ui/Mascot';
import { useToast } from '@/components/ui/Toast';
import { FocusCard } from '@/features/focus/components/FocusCard';
import { QuickAdd } from '@/features/quickadd/QuickAdd';
import { NextReminder } from '@/features/reminders/components/NextReminder';
import { TaskList } from '@/features/tasks/components/TaskList';
import { dailyStats, DEFAULT_FILTERS, selectTasks } from '@/features/tasks/services/taskQueries';
import { useNow } from '@/hooks/useNow';
import { useOopsie } from '@/hooks/useOopsie';
import { getActivePage, isExtension, openDashboard, type PageInfo } from '@/services/chromeApi';
import { copy } from '@/utils/copy';
import { toLocalDate } from '@/utils/date';
import { formatLongDate, greeting } from '@/utils/format';
import { CaptureForm } from './CaptureForm';

const MAX_TASKS = 6;

function readCaptureParams(): { title: string; url: string | null } | null {
  const p = new URLSearchParams(window.location.search);
  if (p.get('capture') !== '1') return null;
  return { title: p.get('title') ?? '', url: p.get('url') || null };
}

export function Popup() {
  const { data } = useOopsie();
  const actions = useActions();
  const toast = useToast();
  const now = useNow(30_000);
  const [standaloneCapture] = useState(readCaptureParams);
  const [capture, setCapture] = useState<PageInfo | null>(null);

  useEffect(() => {
    document.body.classList.toggle('popup-body--window', !!standaloneCapture);
  }, [standaloneCapture]);

  const today = useMemo(() => selectTasks(data.tasks, 'today', DEFAULT_FILTERS, now), [data.tasks, now]);
  const stats = dailyStats(data.tasks, now);
  const shown = today.slice(0, MAX_TASKS);

  // Wait for the tab to open before closing the popup, or Chrome may cut the call short.
  const go = (hash: string) =>
    void openDashboard(hash).finally(() => {
      if (isExtension()) window.close();
    });

  if (standaloneCapture) {
    return (
      <div className="popup popup--capture">
        <CaptureForm initialTitle={standaloneCapture.title} url={standaloneCapture.url} standalone onDone={() => window.close()} />
      </div>
    );
  }

  if (capture) {
    return (
      <div className="popup">
        <CaptureForm initialTitle={capture.title} url={capture.url} standalone={false} onDone={() => setCapture(null)} />
      </div>
    );
  }

  const savePage = async () => {
    const page = await getActivePage();
    if (!page) {
      toast({ tone: 'info', message: "Oopsie can't read this tab (only regular web pages). You can still add the link by hand." });
      setCapture({ title: '', url: '' });
      return;
    }
    setCapture(page);
  };

  return (
    <div className="popup">
      <header className="popup__header">
        <Mascot size={34} mood={stats.overdue ? 'oops' : 'happy'} />
        <div className="popup__hello">
          <h1>{data.settings.playfulCopy ? greeting(now) : 'Oopsie'}</h1>
          <p className="muted small">{formatLongDate(now)}</p>
        </div>
        <IconButton label="Daily timesheet" onClick={() => go('timesheet')}>
          <ClipboardList size={18} />
        </IconButton>
        <IconButton label="Open dashboard" onClick={() => go('today')}>
          <LayoutDashboard size={18} />
        </IconButton>
      </header>

      <QuickAdd compact defaultDate={toLocalDate(now)} placeholder="Add a task… “Pay rent Friday 9am”" />

      <section className="popup__section" aria-labelledby="popup-today">
        <div className="popup__section-head">
          <h2 id="popup-today">Today</h2>
          <span className="muted small">
            {stats.completedToday} done · {stats.remainingToday + stats.overdue} left
          </span>
        </div>
        {shown.length ? (
          <>
            <TaskList tasks={shown} reminders={data.reminders} now={now} compact label="Today's tasks" />
            {today.length > MAX_TASKS && (
              <button type="button" className="link-btn" onClick={() => go('today')}>
                +{today.length - MAX_TASKS} more in the dashboard
              </button>
            )}
          </>
        ) : (
          <EmptyState
            compact
            mood={stats.completedToday ? 'happy' : 'calm'}
            title={stats.completedToday ? copy.allDone : copy.emptyToday.title}
            message={stats.completedToday ? undefined : copy.emptyToday.message}
          />
        )}
      </section>

      <FocusCard compact />

      <NextReminder reminders={data.reminders} tasks={data.tasks} now={now} compact />

      <footer className="popup__footer">
        <Button size="sm" icon={<BookmarkPlus size={15} />} onClick={() => void savePage()}>
          Save page
        </Button>
        <Button size="sm" icon={<Bell size={15} />} onClick={() => actions.openReminder(null)}>
          Reminder
        </Button>
      </footer>
    </div>
  );
}
