import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmOptions } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ReminderDialog, type ReminderDraft } from '@/features/reminders/components/ReminderDialog';
import type { ReminderInput } from '@/features/reminders/types';
import { TaskDialog, type TaskDraft } from '@/features/tasks/components/TaskDialog';
import { dailyStats } from '@/features/tasks/services/taskQueries';
import type { TaskInput } from '@/features/tasks/types';
import { useOopsie } from '@/hooks/useOopsie';
import type { Reminder, Task, TaskStatus } from '@/types';
import { copy } from '@/utils/copy';
import { formatSnooze } from '@/services/notifications/notificationService';

/**
 * Owns every dialog, confirmation and toast tied to a task or reminder action,
 * so popup and dashboard components just call `actions.toggleTask(task)` etc.
 */
interface Actions {
  openTask(task: Task | null, draft?: TaskDraft): void;
  openReminder(reminder: Reminder | null, draft?: ReminderDraft): void;
  toggleTask(task: Task): Promise<void>;
  setStatus(task: Task, status: TaskStatus): Promise<void>;
  deleteTask(task: Task): void;
  deleteReminder(reminder: Reminder): void;
  snooze(reminder: Reminder, minutes: number): Promise<void>;
  resolve(reminder: Reminder, outcome: 'done' | 'dismissed'): Promise<void>;
  reactivate(reminder: Reminder): Promise<void>;
  toggleSubtask(task: Task, subtaskId: string): Promise<void>;
  confirm(opts: ConfirmOptions): Promise<{ confirmed: boolean; checked: boolean }>;
}

const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used inside <ActionsProvider>');
  return ctx;
}

interface ConfirmState extends ConfirmOptions {
  resolve(value: { confirmed: boolean; checked: boolean }): void;
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { data, service } = useOopsie();
  const toast = useToast();
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: Task | null; draft?: TaskDraft }>({ open: false, task: null });
  const [reminderDialog, setReminderDialog] = useState<{ open: boolean; reminder: Reminder | null; draft?: ReminderDraft }>({
    open: false,
    reminder: null,
  });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const fail = useCallback(
    (err: unknown) => toast({ tone: 'error', message: err instanceof Error ? err.message : 'Something went wrong. Please try again.' }),
    [toast],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<{ confirmed: boolean; checked: boolean }>((resolve) => setConfirmState({ ...opts, resolve })),
    [],
  );

  const deleteTask = useCallback(
    async (task: Task) => {
      const linked = data.reminders.filter((r) => r.taskId === task.id);
      const res = await confirm({
        title: 'Delete this task?',
        message: `“${task.title}” will be removed. You can undo right after.`,
        confirmLabel: 'Delete task',
        checkbox: linked.length
          ? { label: `Also delete ${linked.length} linked reminder${linked.length === 1 ? '' : 's'} (otherwise they're kept on their own)`, defaultChecked: true }
          : undefined,
      });
      if (!res.confirmed) return;
      try {
        const removed = await service.deleteTask(task.id, { deleteReminders: res.checked });
        setTaskDialog((s) => (s.task?.id === task.id ? { open: false, task: null } : s));
        toast({
          message: copy.taskDeleted,
          tone: 'info',
          action: {
            label: 'Undo',
            onClick: () =>
              void service
                .restore({ tasks: removed.task ? [removed.task] : [], reminders: removed.reminders })
                .catch(fail),
          },
        });
      } catch (err) {
        fail(err);
      }
    },
    [confirm, data.reminders, fail, service, toast],
  );

  const deleteReminder = useCallback(
    async (reminder: Reminder) => {
      const res = await confirm({
        title: 'Delete this reminder?',
        message: `“${reminder.title}” won't notify you any more.`,
        confirmLabel: 'Delete reminder',
      });
      if (!res.confirmed) return;
      try {
        const removed = await service.deleteReminder(reminder.id);
        setReminderDialog((s) => (s.reminder?.id === reminder.id ? { open: false, reminder: null } : s));
        toast({
          message: copy.reminderDeleted,
          tone: 'info',
          action: removed ? { label: 'Undo', onClick: () => void service.restore({ reminders: [removed] }).catch(fail) } : undefined,
        });
      } catch (err) {
        fail(err);
      }
    },
    [confirm, fail, service, toast],
  );

  const setStatus = useCallback(
    async (task: Task, status: TaskStatus) => {
      if (task.status === status) return;
      const previous = task.status;
      const undo = { label: 'Undo', onClick: () => void service.setTaskStatus(task.id, previous).catch(fail) };
      try {
        if (status !== 'completed') {
          await service.setTaskStatus(task.id, status);
          toast({
            message: status === 'active' ? 'On it! Oopsie is tracking time for this one.' : previous === 'active' ? 'Paused. Back to pending.' : 'Back to pending.',
            tone: 'info',
            action: undo,
          });
          return;
        }
        const { spawned } = await service.setTaskStatus(task.id, 'completed');
        const remaining = dailyStats(
          data.tasks.map((t) => (t.id === task.id ? { ...t, status: 'completed' as const, completedAt: Date.now() } : t)),
        );
        const activeLinked = data.reminders.filter((r) => r.taskId === task.id && r.status === 'active' && r.recurrence === 'none');
        const allDone = remaining.remainingToday + remaining.overdue === 0 && remaining.completedToday > 1;
        toast({
          message: allDone ? copy.allDone : spawned ? `${copy.taskDone()} Next one is queued up.` : copy.taskDone(),
          action: activeLinked.length
            ? {
                label: `Turn off ${activeLinked.length === 1 ? 'reminder' : 'reminders'}`,
                onClick: () => void service.dismissRemindersForTask(task.id).catch(fail),
              }
            : undo,
        });
      } catch (err) {
        fail(err);
      }
    },
    [data.reminders, data.tasks, fail, service, toast],
  );

  /** The checkbox: completed ↔ pending. */
  const toggleTask = useCallback(
    (task: Task) => setStatus(task, task.status === 'completed' ? 'pending' : 'completed'),
    [setStatus],
  );

  const actions = useMemo<Actions>(
    () => ({
      openTask: (task, draft) => setTaskDialog({ open: true, task, draft }),
      openReminder: (reminder, draft) => setReminderDialog({ open: true, reminder, draft }),
      toggleTask,
      setStatus,
      deleteTask: (task) => void deleteTask(task),
      deleteReminder: (r) => void deleteReminder(r),
      async snooze(r, minutes) {
        try {
          await service.snoozeReminder(r.id, minutes);
          toast({ message: `Snoozed for ${formatSnooze(minutes)}. Oopsie will ask again.`, tone: 'info' });
        } catch (err) {
          fail(err);
        }
      },
      async resolve(r, outcome) {
        try {
          await service.resolveReminder(r.id, outcome);
          toast({
            message: outcome === 'done' ? 'Nice — handled.' : 'Reminder dismissed.',
            tone: outcome === 'done' ? 'success' : 'info',
          });
        } catch (err) {
          fail(err);
        }
      },
      async reactivate(r) {
        try {
          await service.reactivateReminder(r.id);
          toast({ message: 'Reminder is back on.', tone: 'info' });
        } catch (err) {
          fail(err);
        }
      },
      async toggleSubtask(task, subtaskId) {
        await service.toggleSubtask(task.id, subtaskId).catch(fail);
      },
      confirm,
    }),
    [confirm, deleteReminder, deleteTask, fail, service, setStatus, toast, toggleTask],
  );

  const saveTask = async (input: TaskInput, opts: { remindAtDue: boolean }) => {
    if (taskDialog.task) {
      await service.updateTask(taskDialog.task.id, input);
      toast({ message: 'Task updated.' });
    } else {
      const reminder =
        opts.remindAtDue && input.dueDate && input.dueTime
          ? { title: input.title, date: input.dueDate, time: input.dueTime, url: input.url ?? null }
          : undefined;
      await service.addTask(input, reminder);
      toast({ message: reminder ? copy.reminderCreated : 'Task added.' });
    }
    setTaskDialog({ open: false, task: null });
  };

  const saveReminder = async (input: ReminderInput) => {
    if (reminderDialog.reminder) {
      await service.updateReminder(reminderDialog.reminder.id, input);
      toast({ message: 'Reminder updated.' });
    } else {
      await service.addReminder(input);
      toast({ message: copy.reminderCreated });
    }
    setReminderDialog({ open: false, reminder: null });
  };

  const currentTask = taskDialog.task ? data.tasks.find((t) => t.id === taskDialog.task?.id) ?? taskDialog.task : null;

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <TaskDialog
        open={taskDialog.open}
        task={currentTask}
        draft={taskDialog.draft}
        defaultPriority={data.settings.defaultPriority}
        linkedReminders={currentTask ? data.reminders.filter((r) => r.taskId === currentTask.id) : []}
        onClose={() => setTaskDialog({ open: false, task: null })}
        onSave={saveTask}
        onDelete={currentTask ? () => void deleteTask(currentTask) : undefined}
        onAddReminder={currentTask ? () => setReminderDialog({ open: true, reminder: null, draft: { taskId: currentTask.id } }) : undefined}
        onEditReminder={(r) => setReminderDialog({ open: true, reminder: r })}
      />
      <ReminderDialog
        open={reminderDialog.open}
        reminder={reminderDialog.reminder}
        draft={reminderDialog.draft}
        tasks={data.tasks}
        onClose={() => setReminderDialog({ open: false, reminder: null })}
        onSave={saveReminder}
        onDelete={reminderDialog.reminder ? () => void deleteReminder(reminderDialog.reminder!) : undefined}
      />
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone}
        checkbox={confirmState?.checkbox}
        onCancel={() => {
          confirmState?.resolve({ confirmed: false, checked: false });
          setConfirmState(null);
        }}
        onConfirm={(checked) => {
          confirmState?.resolve({ confirmed: true, checked });
          setConfirmState(null);
        }}
      />
    </ActionsContext.Provider>
  );
}
