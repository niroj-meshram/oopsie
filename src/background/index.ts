/**
 * Oopsie service worker.
 *
 * All listeners are registered synchronously at the top level so Chrome can
 * wake the worker for them after it has been suspended. No state is kept in
 * memory between wake-ups — everything lives in chrome.storage.local.
 */
import { createChromeAlarms, FOCUS_ALARM, HEARTBEAT_ALARM, reminderIdFromAlarm } from '@/services/alarms/alarmService';
import { MESSAGE_RECONCILE, openDashboard, type OopsieMessage } from '@/services/chromeApi';
import {
  createChromeNotifications,
  FOCUS_NOTIFICATION_BUTTONS,
  FOCUS_NOTIFICATION_ID,
  NOTIFICATION_BUTTONS,
  reminderIdFromNotification,
} from '@/services/notifications/notificationService';
import { FOCUS_KEY, REMINDER_PREFIX, Repository, SETTINGS_KEY, TASK_PREFIX } from '@/services/storage/repository';
import { createChromeStorageArea } from '@/services/storage/storageArea';
import { createEngine } from './engine';

const repo = new Repository(createChromeStorageArea());

const BADGE_COLORS = {
  default: { background: '#FFC93C', text: '#2B2118' },
  focus: { background: '#E5484D', text: '#FFFFFF' },
} as const;

/**
 * Rings the focus alarm from an offscreen document (service workers can't
 * play audio). The page plays its chime on load; Chrome closes it by itself
 * once the audio has stopped, so it is recreated fresh for every ring.
 */
async function ringAlarm() {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length) await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Ring the alarm when a focus session ends',
  });
}

const engine = createEngine({
  repo,
  alarms: createChromeAlarms(),
  notifications: createChromeNotifications(chrome.runtime.getURL('icons/icon-128.png')),
  iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
  badge: {
    async set(text, title, tone) {
      await chrome.action.setBadgeText({ text });
      await chrome.action.setTitle({ title });
      if (text) {
        const colors = BADGE_COLORS[tone ?? 'default'];
        await chrome.action.setBadgeBackgroundColor({ color: colors.background });
        await chrome.action.setBadgeTextColor?.({ color: colors.text });
      }
    },
  },
  sound: { ring: ringAlarm },
});

const reconcile = () =>
  engine.reconcile().catch((err: unknown) => console.error('Oopsie: reconcile failed', err));

const MENU = { page: 'oopsie-save-page', link: 'oopsie-save-link', selection: 'oopsie-save-selection' } as const;

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: 'Save this page to Oopsie', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.link, title: 'Save link to Oopsie', contexts: ['link'] });
    chrome.contextMenus.create({ id: MENU.selection, title: 'Create Oopsie task from “%s”', contexts: ['selection'] });
  });
}

/** Opens the compact capture form in a small window, pre-filled with the page. */
async function openCapture(title: string, url: string) {
  const params = new URLSearchParams({ capture: '1', title: title.slice(0, 300), url: url.slice(0, 2048) });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?${params.toString()}`),
    type: 'popup',
    width: 400,
    height: 560,
    focused: true,
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  setupContextMenus();
  void repo.ensureInitialized().then(reconcile);
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void openDashboard('today?welcome=1');
});

chrome.runtime.onStartup.addListener(() => {
  void reconcile();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM || alarm.name === FOCUS_ALARM || reminderIdFromAlarm(alarm.name)) void reconcile();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === FOCUS_NOTIFICATION_ID) {
    void engine.dismissFocus();
    return;
  }
  const id = reminderIdFromNotification(notificationId);
  if (!id) return;
  chrome.notifications.clear(notificationId);
  void openDashboard(`reminders?focus=${encodeURIComponent(id)}`);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === FOCUS_NOTIFICATION_ID) {
    const action = buttonIndex === FOCUS_NOTIFICATION_BUTTONS.extend ? engine.extendFocus() : engine.dismissFocus();
    action.catch((err: unknown) => console.error('Oopsie: focus action failed', err));
    return;
  }
  const id = reminderIdFromNotification(notificationId);
  if (!id) return;
  void (async () => {
    if (buttonIndex === NOTIFICATION_BUTTONS.snooze) {
      const settings = await repo.getSettings();
      await engine.snooze(id, settings.defaultSnoozeMinutes);
    } else if (buttonIndex === NOTIFICATION_BUTTONS.done) {
      await engine.resolve(id, 'done');
    }
  })().catch((err: unknown) => console.error('Oopsie: notification action failed', err));
});

// Any change to reminders, tasks (badge), the focus timer or settings from any page re-syncs the schedule.
let changeTimer: ReturnType<typeof setTimeout> | undefined;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const relevant = Object.keys(changes).some(
    (k) => k.startsWith(REMINDER_PREFIX) || k.startsWith(TASK_PREFIX) || k === SETTINGS_KEY || k === FOCUS_KEY,
  );
  if (!relevant) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => void reconcile(), 250);
});

chrome.runtime.onMessage.addListener((message: OopsieMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== MESSAGE_RECONCILE) return false;
  void reconcile().then(() => sendResponse({ ok: true }));
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const pageUrl = info.pageUrl ?? tab?.url ?? '';
  if (info.menuItemId === MENU.page) void openCapture(tab?.title ?? pageUrl, pageUrl);
  else if (info.menuItemId === MENU.link && info.linkUrl) void openCapture(info.selectionText || info.linkUrl, info.linkUrl);
  else if (info.menuItemId === MENU.selection && info.selectionText) void openCapture(info.selectionText, pageUrl);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-dashboard') void openDashboard('today');
  else if (command === 'save-page') {
    if (tab?.url && /^https?:/i.test(tab.url)) void openCapture(tab.title ?? tab.url, tab.url);
    else void openCapture('', '');
  }
});

// Every wake-up (restart, update, suspension) re-checks the schedule.
void reconcile();
