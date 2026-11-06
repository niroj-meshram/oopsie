import { Bell, CalendarClock, CalendarDays, CircleAlert, CircleCheck, ClipboardList, Inbox, Moon, Settings, Sun, Tag } from 'lucide-react';
import type { ReactNode } from 'react';
import { Mascot } from '@/components/ui/Mascot';
import { useOopsie } from '@/hooks/useOopsie';
import type { ViewId } from './useHashRoute';

interface NavItem {
  id: ViewId;
  label: string;
  icon: ReactNode;
  count?: number;
  tone?: 'danger' | 'accent';
}

interface SidebarProps {
  view: ViewId;
  label: string | null;
  labels: string[];
  counts: { today: number; upcoming: number; overdue: number; all: number; reminders: number; due: number };
  onNavigate: (view: ViewId, params?: Record<string, string>) => void;
}

export function Sidebar({ view, label, labels, counts, onNavigate }: SidebarProps) {
  const { data, service } = useOopsie();
  const items: NavItem[] = [
    { id: 'today', label: 'Today', icon: <CalendarDays size={18} />, count: counts.today },
    { id: 'upcoming', label: 'Upcoming', icon: <CalendarClock size={18} />, count: counts.upcoming },
    { id: 'overdue', label: 'Overdue', icon: <CircleAlert size={18} />, count: counts.overdue, tone: 'danger' },
    { id: 'all', label: 'All tasks', icon: <Inbox size={18} />, count: counts.all },
    { id: 'reminders', label: 'Reminders', icon: <Bell size={18} />, count: counts.due || counts.reminders, tone: counts.due ? 'accent' : undefined },
    { id: 'completed', label: 'Completed', icon: <CircleCheck size={18} /> },
    { id: 'timesheet', label: 'Timesheet', icon: <ClipboardList size={18} /> },
  ];
  const dark =
    data.settings.theme === 'dark' || (data.settings.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <nav className="sidebar" aria-label="Oopsie navigation">
      <div className="brand">
        <Mascot size={36} />
        <div>
          <div className="brand__name">Oopsie</div>
          <div className="brand__tag">Oops less. Do more.</div>
        </div>
      </div>
      <ul className="nav">
        {items.map((it) => {
          const active = view === it.id && !(it.id === 'all' && label);
          return (
            <li key={it.id}>
              <button
                type="button"
                className={`nav__item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(it.id)}
              >
                {it.icon}
                <span className="nav__label">{it.label}</span>
                {!!it.count && <span className={`nav__count ${it.tone ? `nav__count--${it.tone}` : ''}`}>{it.count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {labels.length > 0 && (
        <>
          <h2 className="nav__heading">Labels</h2>
          <ul className="nav nav--labels">
            {labels.map((l) => (
              <li key={l}>
                <button
                  type="button"
                  className={`nav__item nav__item--sm ${view === 'all' && label === l ? 'is-active' : ''}`}
                  aria-current={view === 'all' && label === l ? 'page' : undefined}
                  onClick={() => onNavigate('all', { label: l })}
                >
                  <Tag size={15} />
                  <span className="nav__label">{l}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="sidebar__foot">
        <button
          type="button"
          className={`nav__item ${view === 'settings' ? 'is-active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={18} />
          <span className="nav__label">Settings</span>
        </button>
        <button
          type="button"
          className="nav__item"
          onClick={() => void service.updateSettings({ theme: dark ? 'light' : 'dark' })}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          <span className="nav__label">{dark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <p className="sidebar__hint">
          <kbd>N</kbd> new task · <kbd>/</kbd> search
        </p>
      </div>
    </nav>
  );
}
