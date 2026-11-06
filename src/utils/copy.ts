/** Oopsie's voice — used sparingly, mostly in confirmations and empty states. */

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export const copy = {
  taskDone: () => pick(['One less thing to forget. Nice!', 'Done and dusted.', 'Checked off. Brain space reclaimed.', 'Nice! That one’s handled.']),
  allDone: 'Look at you, getting things done!',
  reminderCreated: 'Reminder set. Future you says thanks.',
  overdue: "Oops, this one's still waiting!",
  emptyToday: { title: 'Nothing on your plate.', message: "Let's keep it that way. Or add something below." },
  emptyUpcoming: { title: 'The future looks wide open.', message: 'Tasks with a due date after today show up here.' },
  emptyOverdue: { title: 'Nothing overdue.', message: 'Not a single oops in sight.' },
  emptyAll: { title: 'No tasks yet.', message: 'Type something like “Call mom tomorrow at 6pm” to get started.' },
  emptyCompleted: { title: 'Nothing completed yet.', message: 'Finished tasks land here. Go get one!' },
  emptyReminders: { title: 'No reminders yet.', message: 'Set one and Oopsie will nudge you, even when the popup is closed.' },
  emptySearch: { title: 'No matches.', message: 'Try a different word or clear the filters.' },
  taskDeleted: 'Task deleted.',
  reminderDeleted: 'Reminder deleted.',
};
