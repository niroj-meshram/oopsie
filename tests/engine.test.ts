import { describe, expect, it } from 'vitest';
import { createReminder, snoozeReminder } from '@/features/reminders/services/reminderLogic';
import { createTask } from '@/features/tasks/services/taskLogic';
import { HEARTBEAT_ALARM, planAlarms, reminderAlarmName } from '@/services/alarms/alarmService';
import { notificationId } from '@/services/notifications/notificationService';
import { createOopsieService } from '@/services/oopsieService';
import { at, setupEngine } from './helpers';

const NOW = at('2026-10-26', '08:00');

describe('alarm planning', () => {
  it('creates missing alarms, clears stale ones and leaves unchanged ones alone', () => {
    const plan = planAlarms(
      [
        { name: 'reminder:a', scheduledTime: 1000 },
        { name: 'reminder:b', scheduledTime: 2000 },
        { name: HEARTBEAT_ALARM, scheduledTime: 5 },
      ],
      new Map([
        ['reminder:a', 1000],
        ['reminder:c', 3000],
      ]),
    );
    expect(plan.clear).toEqual(['reminder:b']);
    expect(plan.create).toEqual([{ name: 'reminder:c', when: 3000 }]);
  });

  it('reschedules an alarm whose time changed', () => {
    const plan = planAlarms([{ name: 'reminder:a', scheduledTime: 1000 }], new Map([['reminder:a', 90_000]]));
    expect(plan.create).toEqual([{ name: 'reminder:a', when: 90_000 }]);
  });
});

describe('background engine', () => {
  it('schedules an alarm and a heartbeat for a new reminder', async () => {
    const { repo, engine, alarms, notifications } = setupEngine(NOW);
    const r = createReminder({ title: 'Call client', date: '2026-10-26', time: '15:00' }, NOW);
    await repo.save({ reminders: [r] });
    await engine.reconcile();
    expect(alarms.alarms.get(reminderAlarmName(r.id))?.scheduledTime).toBe(at('2026-10-26', '15:00'));
    expect(alarms.alarms.get(HEARTBEAT_ALARM)?.periodInMinutes).toBe(15);
    expect(notifications.log).toHaveLength(0);
  });

  it('shows one notification when due, even if woken repeatedly', async () => {
    const env = setupEngine(NOW);
    const r = createReminder({ title: 'Call client', date: '2026-10-26', time: '15:00' }, NOW);
    await env.repo.save({ reminders: [r] });
    await env.engine.reconcile();
    env.clock.now = at('2026-10-26', '15:00');
    await Promise.all([env.engine.reconcile(), env.engine.reconcile(), env.engine.reconcile()]);
    await env.engine.reconcile();
    expect(env.notifications.log).toHaveLength(1);
    expect(env.notifications.log[0]!.options.title).toBe('Call client');
    expect(env.alarms.alarms.has(reminderAlarmName(r.id))).toBe(false);
    expect(env.badge.text).toBe('1');
  });

  it('includes the linked task in the notification context', async () => {
    const env = setupEngine(NOW);
    const task = createTask({ title: 'Submit the project report', dueDate: '2026-10-27' }, NOW);
    const r = createReminder({ title: 'Report reminder', date: '2026-10-26', time: '09:00', taskId: task.id }, NOW);
    await env.repo.save({ tasks: [task], reminders: [r] });
    env.clock.now = at('2026-10-26', '09:00');
    await env.engine.reconcile();
    expect(env.notifications.log[0]!.options.message).toContain('For task: Submit the project report');
  });

  it('snoozes from the notification button without duplicating', async () => {
    const env = setupEngine(NOW);
    const r = createReminder({ title: 'Stand up', date: '2026-10-26', time: '09:00' }, NOW);
    await env.repo.save({ reminders: [r] });
    env.clock.now = at('2026-10-26', '09:00');
    await env.engine.reconcile();
    expect(env.notifications.shown.has(notificationId(r.id))).toBe(true);

    env.clock.now += 5_000;
    await env.engine.snooze(r.id, 10);
    expect(env.notifications.shown.has(notificationId(r.id))).toBe(false);
    expect(env.alarms.alarms.get(reminderAlarmName(r.id))?.scheduledTime).toBe(env.clock.now + 10 * 60_000);

    env.clock.now += 10 * 60_000;
    await env.engine.reconcile();
    await env.engine.reconcile();
    expect(env.notifications.log).toHaveLength(2);
    expect(env.notifications.log[1]!.options.contextMessage).toMatch(/snooze/i);
  });

  it('marks done from the notification and moves a recurring reminder forward', async () => {
    const env = setupEngine(NOW);
    const r = createReminder({ title: 'Meds', date: '2026-10-26', time: '09:00', recurrence: 'daily' }, NOW);
    await env.repo.save({ reminders: [r] });
    env.clock.now = at('2026-10-26', '09:00');
    await env.engine.reconcile();
    await env.engine.resolve(r.id, 'done');
    const stored = await env.repo.getReminder(r.id);
    expect(stored?.occurrence).toBe('2026-10-27T09:00');
    expect(env.alarms.alarms.get(reminderAlarmName(r.id))?.scheduledTime).toBe(at('2026-10-27', '09:00'));
    expect(env.notifications.shown.size).toBe(0);
  });

  it('survives a browser restart: data persists, alarms are rebuilt, missed reminders alert once', async () => {
    const env = setupEngine(NOW);
    const r = createReminder({ title: 'Pay invoice', date: '2026-10-26', time: '10:00' }, NOW);
    await env.repo.save({ reminders: [r] });
    await env.engine.reconcile();

    // Chrome closes: the alarm list is lost, storage survives. It reopens at 13:00.
    const restarted = setupEngine(at('2026-10-26', '13:00'), env.area.snapshot());
    await restarted.engine.reconcile();
    expect(restarted.notifications.log).toHaveLength(1);
    expect(restarted.notifications.log[0]!.options.contextMessage).toMatch(/missed/i);

    // Another restart doesn't repeat the alert.
    const again = setupEngine(at('2026-10-26', '13:30'), restarted.area.snapshot());
    await again.engine.reconcile();
    expect(again.notifications.log).toHaveLength(0);
  });

  it('removes the alarm and notification when a reminder is deleted', async () => {
    const env = setupEngine(NOW);
    const r = createReminder({ title: 'Ping', date: '2026-10-26', time: '09:00' }, NOW);
    await env.repo.save({ reminders: [r] });
    env.clock.now = at('2026-10-26', '08:30');
    await env.engine.reconcile();
    expect(env.alarms.alarms.has(reminderAlarmName(r.id))).toBe(true);
    await env.repo.remove({ reminders: [r.id] });
    await env.engine.reconcile();
    expect(env.alarms.alarms.has(reminderAlarmName(r.id))).toBe(false);
  });

  it('respects the notifications setting but still tracks the occurrence', async () => {
    const env = setupEngine(NOW);
    await env.repo.updateSettings({ notificationsEnabled: false });
    const r = createReminder({ title: 'Quiet', date: '2026-10-26', time: '09:00' }, NOW);
    await env.repo.save({ reminders: [r] });
    env.clock.now = at('2026-10-26', '09:00');
    await env.engine.reconcile();
    expect(env.notifications.log).toHaveLength(0);
    expect((await env.repo.getReminder(r.id))?.notifiedKey).not.toBeNull();
  });

  it('does not clobber a concurrent UI edit while reconciling', async () => {
    const env = setupEngine(NOW);
    const r = createReminder({ title: 'Original', date: '2026-10-26', time: '09:00' }, NOW);
    await env.repo.save({ reminders: [r] });
    env.clock.now = at('2026-10-26', '09:00');
    const pending = env.engine.reconcile();
    await env.repo.updateReminder(r.id, (cur) => ({ ...cur, title: 'Edited in popup' }));
    await pending;
    await env.engine.reconcile();
    const stored = await env.repo.getReminder(r.id);
    expect(stored?.title).toBe('Edited in popup');
    expect(env.notifications.log).toHaveLength(1);
  });

  it('counts overdue tasks on the badge', async () => {
    const env = setupEngine(NOW);
    const t = createTask({ title: 'Old thing', dueDate: '2026-10-24' }, NOW);
    await env.repo.save({ tasks: [t] });
    await env.engine.reconcile();
    expect(env.badge.text).toBe('1');
    await env.repo.updateSettings({ showBadge: false });
    await env.engine.reconcile();
    expect(env.badge.text).toBe('');
  });

  it('re-arms a snoozed reminder after a restart', async () => {
    const env = setupEngine(at('2026-10-26', '09:00'));
    const r = snoozeReminder(
      { ...createReminder({ title: 'Snoozy', date: '2026-10-26', time: '09:00' }, NOW), notifiedKey: '2026-10-26T09:00@0' },
      30,
      at('2026-10-26', '09:00'),
    );
    await env.repo.save({ reminders: [r] });
    const restarted = setupEngine(at('2026-10-26', '09:10'), env.area.snapshot());
    await restarted.engine.reconcile();
    expect(restarted.notifications.log).toHaveLength(0);
    expect(restarted.alarms.alarms.get(reminderAlarmName(r.id))?.scheduledTime).toBe(at('2026-10-26', '09:30'));
  });
});

describe('task ↔ reminder relationships', () => {
  const service = (env: ReturnType<typeof setupEngine>) => createOopsieService(env.repo, () => env.engine.reconcile());

  it('keeps linked reminders when a task is completed, and can dismiss them explicitly', async () => {
    const env = setupEngine(Date.now());
    const svc = service(env);
    const { task, reminder } = await svc.addTask(
      { title: 'Submit the project report' },
      { title: 'Submit the project report', date: '2099-01-01', time: '10:00' },
    );
    await svc.completeTask(task.id);
    expect((await env.repo.getReminder(reminder!.id))?.status).toBe('active');
    expect(await svc.dismissRemindersForTask(task.id)).toBe(1);
    expect((await env.repo.getReminder(reminder!.id))?.status).toBe('dismissed');
  });

  it('unlinks or deletes reminders when a task is deleted, as chosen', async () => {
    const env = setupEngine(Date.now());
    const svc = service(env);
    const a = await svc.addTask({ title: 'A' }, { title: 'A', date: '2099-01-01', time: '10:00' });
    const b = await svc.addTask({ title: 'B' }, { title: 'B', date: '2099-01-01', time: '10:00' });
    await svc.deleteTask(a.task.id, { deleteReminders: false });
    expect((await env.repo.getReminder(a.reminder!.id))?.taskId).toBeNull();
    await svc.deleteTask(b.task.id, { deleteReminders: true });
    expect(await env.repo.getReminder(b.reminder!.id)).toBeNull();
    expect(env.alarms.alarms.has(reminderAlarmName(b.reminder!.id))).toBe(false);
  });
});
