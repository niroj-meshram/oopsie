import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { requestReconcile } from '@/services/chromeApi';
import { createOopsieService, type OopsieService } from '@/services/oopsieService';
import { Repository } from '@/services/storage/repository';
import { createChromeStorageArea, createDevStorageArea, hasChromeStorage } from '@/services/storage/storageArea';
import { DEFAULT_SETTINGS, type AppData } from '@/types';

interface OopsieContextValue {
  data: AppData;
  loading: boolean;
  error: string | null;
  service: OopsieService;
}

const OopsieContext = createContext<OopsieContextValue | null>(null);

const EMPTY: AppData = { tasks: [], reminders: [], settings: DEFAULT_SETTINGS, focus: null };

/**
 * Loads all data once and keeps it live: any write from any context (popup,
 * dashboard, service worker) arrives through chrome.storage.onChanged.
 */
export function OopsieProvider({ children }: { children: ReactNode }) {
  const [repo] = useState(() => new Repository(hasChromeStorage() ? createChromeStorageArea() : createDevStorageArea()));
  const service = useMemo(() => createOopsieService(repo, requestReconcile), [repo]);
  const [data, setData] = useState<AppData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      repo
        .loadAll()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError("Oopsie couldn't read its saved data. Try reopening this page.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void repo.ensureInitialized().finally(load);
    const unsubscribe = repo.area.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 30);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [repo]);

  useTheme(data.settings.theme);

  const value = useMemo(() => ({ data, loading, error, service }), [data, loading, error, service]);
  return <OopsieContext.Provider value={value}>{children}</OopsieContext.Provider>;
}

export function useOopsie(): OopsieContextValue {
  const ctx = useContext(OopsieContext);
  if (!ctx) throw new Error('useOopsie must be used inside <OopsieProvider>');
  return ctx;
}

function useTheme(pref: AppData['settings']['theme']) {
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
  }, [pref]);
}
