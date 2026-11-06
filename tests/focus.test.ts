import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extendFocus,
  focusBadgeText,
  formatCountdown,
  nextFocusTick,
  sanitizeFocus,
  startFocus,
} from '@/features/focus/services/focusLogic';
import { createReminder } from '@/features/reminders/services/reminderLogic';
import { FOCUS_ALARM } from '@/services/alarms/alarmService';
import { FOCUS_NOTIFICATION_ID } from '@/services/notifications/notificationService';
import { createOopsieService } from '@/services/oopsieService';
import { at, setupEngine } from './helpers';

const NOW = at('2026-10-30', '10:00');
const MIN = 60_000;

describe('focus logic', () => {
  it('starts a session of the chosen length', () => {
    const f = startFocus(25, '  Write report ', NOW);
    expect(f).toEqual({ label: 'Write report', durationMinutes: 25, startedAt: NOW, endsAt: NOW + 25 * MIN, notifiedAt: null });
  });

  it('rejects lengths outside 1–240 whole minutes', () => {
    for (const bad of [0, -5, 241, 2.5, NaN]) expect(() => startFocus(bad, '', NOW)).toThrow();
  });

  it('shows whole minutes left in the badge, rounded up', () => {
    const f = startFocus(25, '', NOW);
    expect(focusBadgeText(f, NOW)).toBe('25m');
    expect(focusBadgeText(f, NOW + 30_000)).toBe('25m');
    expect(focusBadgeText(f, NOW + MIN)).toBe('24m');
    expect(focusBadgeText(f, NOW + 24 * MIN + 1)).toBe('<1m');
    expect(focusBadgeText(f, NOW + 25 * MIN)).toBe('');
  });

  it('ticks on each whole minute counted back from the end', () => {
    const f = startFocus(3, '', NOW);
    expect(nextFocusTick(f, NOW)).toBe(NOW + MIN);
    expect(nextFocusTick(f, NOW + 10_000)).toBe(NOW + MIN);
    expect(nextFocusTick(f, NOW + MIN)).toBe(NOW + 2 * MIN);
    expect(nextFocusTick(f, NOW + 2 * MIN)).toBeNull();
  });

  it('extends a running session, and restarts an ended one from now', () => {
    const f = startFocus(25, 'Deep work', NOW);
    expect(extendFocus(f, 5, NOW + MIN).endsAt).toBe(NOW + 30 * MIN);
    const later = NOW + 40 * MIN;
    const restarted = extendFocus({ ...f, notifiedAt: NOW + 25 * MIN }, 5, later);
    expect(restarted).toMatchObject({ label: 'Deep work', startedAt: later, endsAt: later + 5 * MIN, notifiedAt: null });
  });

  it('formats the countdown', () => {
    expect(formatCountdown(25 * MIN)).toBe('25:00');
    expect(formatCountdown(61_500)).toBe('1:02');
    expect(formatCountdown(90 * MIN)).toBe('1:30:00');
    expect(formatCountdown(-1)).toBe('0:00');
  });

  it('drops malformed stored sessions', () => {
    expect(sanitizeFocus(null)).toBeNull();
    expect(sanitizeFocus({ startedAt: 10, endsAt: 5 })).toBeNull();
    expect(sanitizeFocus({ startedAt: NOW, endsAt: NOW + 10 * MIN, label: 7 })).toMatchObject({ label: '', durationMinutes: 10, notifiedAt: null });
  });
});

describe('focus timer in the background engine', () => {
  // The service reads Date.now(); keep it in step with the engine's test clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows the countdown as a red badge and schedules the next tick', async () => {
    const env = setupEngine(NOW);
    const service = createOopsieService(env.repo, () => env.engine.reconcile());
    await service.startFocus(25, 'Write report');
    expect(env.badge).toMatchObject({ text: '25m', tone: 'focus' });
    expect(env.badge.title).toContain('Write report');
    expect(env.alarms.alarms.get(FOCUS_ALARM)?.scheduledTime).toBe(NOW + MIN);

    env.clock.now = NOW + 10 * MIN;
    await env.engine.reconcile();
    expect(env.badge.text).toBe('15m');
    expect(env.alarms.alarms.get(FOCUS_ALARM)?.scheduledTime).toBe(NOW + 11 * MIN);
  });

  it('remembers the chosen length as the new default', async () => {
    const env = setupEngine(NOW);
    const service = createOopsieService(env.repo, () => env.engine.reconcile());
    await service.startFocus(50);
    expect((await env.repo.getSettings()).defaultFocusMinutes).toBe(50);
  });

  it('rings and notifies exactly once when focus ends, then restores the normal badge', async () => {
    const env = setupEngine(NOW);
    const service = createOopsieService(env.repo, () => env.engine.reconcile());
    await env.repo.save({ reminders: [createReminder({ title: 'Due', date: '2026-10-30', time: '09:00' }, NOW - 120 * MIN)] });
    await service.startFocus(25);
    expect(env.badge.tone).toBe('focus');

    env.clock.now = NOW + 25 * MIN;
    await Promise.all([env.engine.reconcile(), env.engine.reconcile()]);
    await env.engine.reconcile();
    const focusAlerts = env.notifications.log.filter((n) => n.id === FOCUS_NOTIFICATION_ID);
    expect(focusAlerts).toHaveLength(1);
    expect(focusAlerts[0]!.options.requireInteraction).toBe(true);
    expect(env.sound.rings).toBe(1);
    expect(env.alarms.alarms.has(FOCUS_ALARM)).toBe(false);
    expect(env.badge).toMatchObject({ text: '1', tone: undefined });
  });

  it('respects the sound setting', async () => {
    const env = setupEngine(NOW);
    await env.repo.updateSettings({ focusSound: false });
    await createOopsieService(env.repo, () => env.engine.reconcile()).startFocus(5);
    env.clock.now = NOW + 5 * MIN;
    await env.engine.reconcile();
    expect(env.notifications.shown.has(FOCUS_NOTIFICATION_ID)).toBe(true);
    expect(env.sound.rings).toBe(0);
  });

  it('"+5 min" restarts the countdown and "Done" clears everything', async () => {
    const env = setupEngine(NOW);
    await createOopsieService(env.repo, () => env.engine.reconcile()).startFocus(5);
    env.clock.now = NOW + 5 * MIN;
    await env.engine.reconcile();

    await env.engine.extendFocus();
    expect(env.notifications.shown.has(FOCUS_NOTIFICATION_ID)).toBe(false);
    expect(env.badge).toMatchObject({ text: '5m', tone: 'focus' });

    env.clock.now += 5 * MIN;
    await env.engine.reconcile();
    expect(env.notifications.log.filter((n) => n.id === FOCUS_NOTIFICATION_ID)).toHaveLength(2);

    await env.engine.dismissFocus();
    expect(await env.repo.getFocus()).toBeNull();
    expect(env.notifications.shown.has(FOCUS_NOTIFICATION_ID)).toBe(false);
  });

  it('stopping early cancels the alarm and the badge', async () => {
    const env = setupEngine(NOW);
    const service = createOopsieService(env.repo, () => env.engine.reconcile());
    await service.startFocus(25);
    await service.stopFocus();
    expect(env.alarms.alarms.has(FOCUS_ALARM)).toBe(false);
    expect(env.badge.text).toBe('');
    env.clock.now = NOW + 30 * MIN;
    await env.engine.reconcile();
    expect(env.notifications.log).toHaveLength(0);
  });

  it('alarms once after Chrome was closed past the end time', async () => {
    const env = setupEngine(NOW);
    await createOopsieService(env.repo, () => env.engine.reconcile()).startFocus(25);
    env.clock.now = NOW + 3 * 60 * MIN;
    await env.engine.reconcile();
    expect(env.notifications.log.filter((n) => n.id === FOCUS_NOTIFICATION_ID)).toHaveLength(1);
  });
});
