/**
 * Minimal key-value surface Oopsie needs from chrome.storage.local.
 * Keeping it this small lets tests and the `vite dev` preview swap in
 * an in-memory implementation.
 */
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageListener = (changes: Record<string, StorageChange>) => void;

export interface StorageArea {
  getAll(): Promise<Record<string, unknown>>;
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: StorageListener): () => void;
}

export function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export function createChromeStorageArea(): StorageArea {
  const area = chrome.storage.local;
  return {
    getAll: () => area.get(null),
    get: (keys) => area.get(keys),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
    clear: () => area.clear(),
    subscribe(listener) {
      const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName === 'local') listener(changes);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

/** In-memory storage that mirrors chrome.storage semantics (values are deep-copied). */
export function createMemoryStorageArea(initial: Record<string, unknown> = {}): StorageArea & {
  snapshot(): Record<string, unknown>;
} {
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  let data: Record<string, unknown> = clone(initial);
  const listeners = new Set<StorageListener>();
  const emit = (changes: Record<string, StorageChange>) => {
    if (Object.keys(changes).length === 0) return;
    // chrome.storage fires asynchronously; mimic that.
    queueMicrotask(() => listeners.forEach((l) => l(changes)));
  };
  return {
    snapshot: () => clone(data),
    getAll: async () => clone(data),
    get: async (keys) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    set: async (items) => {
      const changes: Record<string, StorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      emit(changes);
    },
    remove: async (keys) => {
      const changes: Record<string, StorageChange> = {};
      for (const k of keys) {
        if (k in data) {
          changes[k] = { oldValue: data[k] };
          delete data[k];
        }
      }
      emit(changes);
    },
    clear: async () => {
      const changes: Record<string, StorageChange> = {};
      for (const k of Object.keys(data)) changes[k] = { oldValue: data[k] };
      data = {};
      emit(changes);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Used only by `vite dev` outside Chrome: memory storage persisted to localStorage. */
export function createDevStorageArea(): StorageArea {
  const KEY = 'oopsie-dev-storage';
  let initial: Record<string, unknown> = {};
  try {
    initial = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    initial = {};
  }
  const mem = createMemoryStorageArea(initial);
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(mem.snapshot()));
    } catch {
      // Dev-only convenience; ignore quota or privacy-mode failures.
    }
  };
  mem.subscribe(persist);
  return mem;
}
