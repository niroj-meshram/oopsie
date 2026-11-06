/**
 * Small helpers for Chrome APIs used by the UI pages. Every function degrades
 * gracefully when run outside an extension (e.g. `vite dev` preview).
 */

export const isExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;

export const MESSAGE_RECONCILE = 'oopsie:reconcile';

export interface OopsieMessage {
  type: typeof MESSAGE_RECONCILE;
}

/** Ask the service worker to re-sync alarms, notifications and the badge. */
export async function requestReconcile(): Promise<void> {
  if (!isExtension()) return;
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_RECONCILE } satisfies OopsieMessage);
  } catch {
    // The worker also reacts to storage changes, so a missed message is harmless.
  }
}

export function extensionUrl(path: string): string {
  return isExtension() ? chrome.runtime.getURL(path) : `/${path}`;
}

/** Opens the dashboard, reusing an existing dashboard tab when there is one. */
export async function openDashboard(hash = ''): Promise<void> {
  const url = extensionUrl(`dashboard.html${hash ? `#${hash}` : ''}`);
  if (!isExtension()) {
    window.open(url, '_blank');
    return;
  }
  const tabId = await findDashboardTab();
  if (tabId !== null) {
    const tab = await chrome.tabs.update(tabId, { active: true, url });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

/** Uses runtime.getContexts so no "tabs" permission is needed to find our own page. */
async function findDashboardTab(): Promise<number | null> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.TAB],
      documentUrls: [chrome.runtime.getURL('dashboard.html')],
    });
    const match = contexts.find((c) => c.tabId >= 0);
    return match ? match.tabId : null;
  } catch {
    return null;
  }
}

export interface PageInfo {
  title: string;
  url: string;
}

/**
 * Title and URL of the active tab. Readable only because the user just
 * opened the popup, which grants the activeTab permission for that tab.
 */
export async function getActivePage(): Promise<PageInfo | null> {
  if (!isExtension()) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/i.test(tab.url)) return null;
    return { title: tab.title || tab.url, url: tab.url };
  } catch {
    return null;
  }
}

export function openUrl(url: string): void {
  if (isExtension()) void chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function openShortcutSettings(): void {
  if (isExtension()) void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

export async function getCommandShortcuts(): Promise<Record<string, string>> {
  if (!isExtension() || !chrome.commands?.getAll) return {};
  const all = await chrome.commands.getAll();
  return Object.fromEntries(all.map((c) => [c.name ?? '', c.shortcut ?? '']));
}

export function extensionVersion(): string {
  return isExtension() ? chrome.runtime.getManifest().version : 'dev';
}
