import { useCallback, useEffect, useState } from 'react';

export type ViewId = 'today' | 'upcoming' | 'overdue' | 'all' | 'completed' | 'reminders' | 'timesheet' | 'settings';
const VIEWS: ViewId[] = ['today', 'upcoming', 'overdue', 'all', 'completed', 'reminders', 'timesheet', 'settings'];

export interface Route {
  view: ViewId;
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const view = (VIEWS as string[]).includes(path) ? (path as ViewId) : 'today';
  return { view, params: new URLSearchParams(query) };
}

/** Tiny hash router: #today, #reminders?focus=<id>, #all?label=work */
export function useHashRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((view: ViewId, params?: Record<string, string>) => {
    const q = params ? new URLSearchParams(params).toString() : '';
    window.location.hash = `${view}${q ? `?${q}` : ''}`;
  }, []);
  return { route, navigate };
}
