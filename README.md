# Oopsie

**Oops less. Do more.**

Oopsie is a friendly Chrome extension for daily to-dos, reminders and follow-ups. It runs entirely in your browser with no account, server or analytics. The only optional extra is AI timesheet summaries using your own Gemini API key.

- **Popup:** greeting, natural-language quick add, today's tasks, the next reminder, and "Save this page".
- **Dashboard (a full tab):** Today, Upcoming, Overdue, All tasks, Completed, Reminders and Settings, plus search, filters, sorting, labels, a daily overview, and a 7-day summary.
- **Reminders:** first-class, independent of tasks. One-time, daily, weekly or monthly. Desktop notifications with **Snooze** and **Mark done** buttons. Snooze for 5, 10 or 30 minutes or 1 hour. They fire while the popup is closed.

---

## Quick start

Requirements: Node 20 (tested on 20.10) and npm.

```bash
npm install
npm run build        # typecheck + production build → dist/
```

### Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`dist/`** folder.
4. Pin Oopsie from the puzzle-piece menu. The dashboard opens once on first install.

After changing the source, run `npm run build` again, then click the reload ↻ icon on the Oopsie card in `chrome://extensions`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | TypeScript check, then Vite production build into `dist/` |
| `npm run check` | Typecheck, ESLint, tests and build (everything CI should run) |
| `npm test` | Vitest unit and integration tests (runs in `America/New_York` to exercise DST) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (strict mode) |
| `npm run dev` | UI preview at `localhost:5173/dashboard.html` using localStorage instead of Chrome APIs (no notifications) |
| `npm run icons` | Regenerates `public/icons/*.png` from code |
| `npm run package` | Builds and zips `dist/` into `oopsie.zip` |

---

## Using Oopsie

### Quick add (natural language)

Type and press **Enter**. Chips under the input show what Oopsie understood **before** you save. Click **×** on a chip to undo that detection, and its words go back into the title. Click the priority chip to cycle priority.

| You type | You get |
| --- | --- |
| `Finish report tomorrow at 10 AM` | "Finish report", tomorrow 10:00 |
| `Call the client Friday at 3 PM` | "Call the client", next Friday 15:00 |
| `Pay electricity bill every month on the 5th` | Monthly on the 5th, starting at the next 5th |
| `Team sync every Monday 9:30am` | Weekly on Mondays |
| `Check oven in 20 minutes`, `Renew passport in 3 days` | Relative times and dates |
| `Dentist Nov 3 at 14:15`, `Tax 2027-04-15`, `Lunch at noon` | Absolute dates and times |
| `Ship release #work !high` (or `p1`, `!!!`) | Label `work`, high priority |

When the text includes a time, quick add also creates a linked reminder by default. Toggle the 🔔 chip to skip it, or change the default in Settings. Parsing is local and rule-based. If it doesn't recognise something, the text simply stays in the title.

In the Today view and the popup, tasks without a date in the text default to today. Remove the date chip to save a task with no date.

### Tasks

Tasks have a title, notes, priority (Low, Medium, High), an optional due date and time, labels, subtasks, a link, and an optional repeat (daily, weekly or monthly).

Each task has one of three **statuses**:

| Status | Meaning | How to set it |
| --- | --- | --- |
| **Pending** | Not started | The default. Click ⏸ on an active task, or untick a completed one. |
| **Active** | Being worked on now. Oopsie tracks the time. | Click ▶ on the task, or use the status pill → *Mark active* |
| **Completed** | Done | Tick the round checkbox, or use the status pill → *Mark completed* |

- **Completed tasks are never removed or hidden.** They stay in their list and position, struck through and labelled *Completed · Done 13:27*. Use the **Completed** view or the *Status* filter to focus on them.
- Today shows active tasks under **In progress** at the top, then overdue, then everything due today, including the ones already completed.
- The task editor has a Status switch and shows time spent, the start time and the completion time. Every status change shows a toast with **Undo**. If the task has active reminders, completing it offers **Turn off reminders** instead.
- **Repeating tasks** create their next instance when completed. This happens once per completion, and an overdue daily task comes back today rather than on a past date. Repeating reminders linked to the task move to the new instance.
- **Overdue:** date-only tasks become overdue after their day ends. Timed tasks become overdue after their time.
- **Delete** from the 🗑 button on a task row (dashboard and popup), the status pill menu → *Delete task*, the task editor, or by pressing the **Delete** key while a task's title or buttons are focused. It asks for confirmation. If the task has reminders, you choose whether to delete them too or keep them as standalone reminders. **Undo** is available right after.

### Reminders

- Create one from the popup, the dashboard (press **R**), or inside a task. Presets: *In 1 hour*, *This evening*, *Tomorrow 9 AM*, *Next Monday*.
- **Due** reminders appear under **Needs attention** with **Snooze** (5, 10 or 30 minutes, or 1 hour) and **Done**. Upcoming ones offer edit/reschedule, early snooze, done, dismiss and delete.
- Clicking a notification opens the dashboard on that reminder. Its buttons are **Snooze N min** (set N in Settings) and **Mark done**.
- **Done** and **Dismiss** finish a one-time reminder. For a repeating one they move it to its next occurrence. Finished reminders can be **reactivated**.

### Focus timer

- Start one from the **Focus time** card in the popup or the dashboard's right-hand column. Pick 15, 25, 45 or 60 minutes, or type any length from 1 to 240 minutes. In the dashboard you can also say what you're focusing on.
- While it runs, the Oopsie toolbar icon shows the minutes left in a **red badge** (`25m` … `1m`, then `<1m`). The badge updates every minute and takes priority over the usual count. The card shows a live `mm:ss` countdown with **+5 min** and **Stop**.
- When time is up, Oopsie rings a short chime and shows a notification that stays on screen, with **+5 min** and **Done** buttons. This works with the popup closed. The card then shows *Focus time's up!* with **Again** and **Dismiss**.
- Settings → **Focus timer** sets the default length and turns the chime on or off. Starting a session with a different length makes that length the new default.

### Rules for tasks and reminders

| Action | What happens to linked reminders |
| --- | --- |
| Complete a task | **Kept.** The toast offers "Turn off reminders" (dismisses them). Nothing is silently removed. |
| Reopen a task (back to pending) or start it (active) | Unchanged |
| Delete a task | You choose in the confirmation: delete them too (default), or keep them unlinked |
| Complete a repeating task | Repeating reminders move to the next instance; one-time ones stay with the completed task |

### Save the current page

- **Popup → Save page**, or
- **Right-click → "Save this page to Oopsie"**, "Save link to Oopsie", or "Create Oopsie task from '…'" on a text selection, or
- **Alt+Shift+P**.

Oopsie pre-fills the page title (which you can edit) and attaches the URL. Choose when (Someday, Today, Tomorrow or a date), an optional time with a reminder, and a priority. Saved pages open from the ↗ button on the task.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+O` | Open the popup (quick add is focused-ready) |
| `Alt+Shift+U` | Open the dashboard |
| `Alt+Shift+P` | Save the current page as a task |
| `N` / `R` / `/` | Dashboard: new task (focus quick add), new reminder, search |
| `Enter` / `Esc` | Save quick add or close dialogs and menus (Esc also clears the quick-add text) |
| `↑ ↓ Home End` | Navigate menus such as Snooze |

Customise the global shortcuts at **`chrome://extensions/shortcuts`**, or use Settings → **Customize in Chrome**. Chrome can refuse a suggested key that is already taken by another extension. If so, it shows as "Not set" in Settings and you can assign one there.

### Time tracking data (for timesheets)

Every task stores what a timesheet needs. Exported JSON contains the same fields.

```ts
status: 'pending' | 'active' | 'completed'
startedAt: number | null      // first time it became active (epoch ms)
completedAt: number | null
sessions: { start: number; end: number | null }[]  // each active stretch; end is null while still active
```

A session opens when a task becomes **Active** and closes when it leaves that status. Pausing back to pending, or completing, both close it. `timeSpentMs(task, now, from, to)` in `src/features/tasks/services/taskLogic.ts` totals the time inside any window, for example a day or an hour. Several tasks can be active at the same time, and each one records its own time.

### Daily timesheet

Open **Timesheet** in the dashboard sidebar, or the 📋 button in the popup.

1. Pick a day (today by default; ‹ › moves between days). Oopsie lists every task that was **completed** that day, **worked on** that day (it was Active), and, optionally, **planned** for that day but not started. Each shows the time spent within that day. Sessions that cross midnight are split between the two days.
2. A **Quick summary** is filled in immediately, with no AI and nothing sent anywhere. It is written as **2–4 detailed points**, depending on how much was done:
   - 1 task → 2 points (the work, then its progress or outcome);
   - 2–4 tasks → one point each, and a task with lots of notes/subtasks may get a second point;
   - 5+ tasks → smaller tasks with the same status are merged so there are at most 4 points.

   Each point mentions the **task number** (from the title like `#392`, `Ticket 392`, `PROJ-12`, or from the task's GitHub/Jira link or a `#392` label) and reflects the **status**: completed, started that day, continued from an earlier day, still active, paused, or planned but not started. Notes and subtasks add the detail:
   ```
   - Completed ticket #379 – export fix. Fixed the CSV encoding and deployed to staging.
   - Continued working on ticket #392 – scheduling changes. Wrapped up validation, with the UI still pending.
   - Started fixing login bug (ticket #12). This is still in progress.
   ```
3. **Generate with Gemini** rewrites it as polished, natural bullets. Gemini gets each task's ticket number, status, subtask progress and (if allowed) notes, and is asked for the same number of points (2–4). Every line is forced to start with `- `, and anything past 4 points is folded into the last one.
4. Edit the text if you like, then click **Copy** and paste it into your timesheet tool.

Options: include planned tasks and include time spent (both **off** by default, matching a typical timesheet), and let Gemini use notes and subtasks.

**Style:** summaries are written as client-ready, past-tense sentences that each end with a full stop. Ticket numbers like `#392` are kept, the follow-through is chained ("Completed ticket #379 and deployed the changes to staging for client review."), and unfinished work reads "Started/Continued working on…". To match your own voice even more closely, paste a few past timesheets into Settings → AI timesheet → **Your example timesheets**. Gemini copies their tone and level of detail, never their facts.

**Tips for good timesheets:** put the ticket number in the task title (`#401 invoice totals wrong`), and jot what happened in the task's notes (e.g. "Fixed rounding; deployed to staging; asked client to verify"). Gemini turns those notes into the sentence.

**Set up Gemini — option A, a `.env` file (personal builds):** copy `.env.example` to `.env`, set `VITE_GEMINI_API_KEY=...`, then run `npm run build`.
- Vite builds the key into the extension's JavaScript, so anyone with that `dist/` folder can read it. Don't share a build made this way.
- `npm run package` deliberately builds **without** the key, so `oopsie.zip` is safe to share.
- `.env` is gitignored. A key saved in Settings takes priority over the `.env` one.

**Option B, Settings (one time):** go to Settings → **AI timesheet (Gemini)**, paste your API key from aistudio.google.com, click **Save key**, then **Test connection**.
- The key is stored only in this browser's extension storage (`secret:ai`). It is never written into the code, exports or backups.
- It is sent only to Google, in a request header, when you click Generate or Test.
- The default model is `gemini-flash-lite-latest`, which is fast. If a model is busy (503), rate-limited (429), retired (404) or takes more than 30 seconds, Oopsie automatically tries `gemini-flash-latest`, then `gemini-3.8-flash`.

### Settings and data

Settings include theme (system, light or dark), default priority, playful greetings, quick-add reminders, notifications (on/off, keep on screen, silent), snooze length for the notification button, and the toolbar badge count.

- **Export:** downloads `oopsie-backup-YYYY-MM-DD.json` with tasks, reminders and settings.
- **Import:** the file is validated first, and you see counts and warnings before anything changes.
  - **Merge** (the default) adds new items. For items that exist in both, the most recently edited copy wins. Nothing is deleted.
  - **Replace** swaps all tasks and reminders for the backup's, after an explicit choice.
  - Malformed files are rejected with a clear message. Bad individual records are skipped and counted. Unsafe links such as `javascript:` are stripped.
- **Clear all data** asks for confirmation first.

---

## Testing reminders by hand

1. **One-time:** create a reminder for 1–2 minutes from now, then close the popup and the dashboard. A desktop notification appears at that time, and the toolbar badge shows **1**.
2. **Click the notification:** the dashboard opens with that reminder highlighted under *Needs attention*.
3. **Snooze:** click **Snooze 10 min** on the notification, or Snooze → **5 min** in the dashboard. The notification disappears and comes back once after the snooze. In `chrome://extensions` → Oopsie → *service worker* → Console, run `await chrome.alarms.getAll()` to see the rescheduled alarm.
4. **Recurring:** create a daily reminder a minute from now and mark it **Done** when it fires. It moves to tomorrow at the same time. Monthly reminders on the 31st land on the last day of shorter months, then return to the 31st.
5. **Missed or restart:** set a reminder 2 minutes out and quit Chrome completely. Reopen it after the time has passed. You get **one** notification marked "Missed · was due …", not a duplicate.
6. **No duplicates:** reload the extension or reopen Chrome while a reminder is already showing. It is not shown again.

If no notification ever appears, check that your OS allows notifications from Chrome (macOS: System Settings → Notifications → Google Chrome; Windows: Focus Assist / Do Not Disturb), and that **Desktop notifications** is on in Oopsie's settings.

---

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Saves tasks, reminders and settings in `chrome.storage.local` on your computer |
| `alarms` | Wakes the background service worker when a reminder is due, plus a 15-minute safety check |
| `notifications` | Shows reminder notifications with Snooze and Done buttons |
| `contextMenus` | Adds the right-click "Save … to Oopsie" items |
| `offscreen` | Plays the focus-timer chime (service workers can't play audio, so a hidden page does it) |
| `activeTab` | Reads the current tab's **title and URL only when you invoke Oopsie** (open the popup, use the context menu or the shortcut). No access to page content and no browsing history. |
| Host: `https://generativelanguage.googleapis.com/*` | Lets the Timesheet call the Gemini API, only when you click "Generate with Gemini" or "Test connection". No other site is accessible. |

There is no `tabs` permission, no remote code, and no access to the pages you visit. Oopsie finds its own dashboard tab with `chrome.runtime.getContexts`, which needs no permission.

## Privacy

All data stays in the browser's local extension storage and survives restarts. There is no analytics, tracking or backend. The **only** network request Oopsie ever makes is the optional Gemini call. When you click "Generate with Gemini", it sends that day's task titles, statuses and times, plus notes and subtasks if you leave that option on, to Google using your own key. Google's Gemini API terms apply to that request. The quick summary never leaves your browser. User text is rendered as plain text, never as HTML. Links are limited to `http(s)`. Uninstalling the extension deletes its data, so export a backup first if you want to keep it.

---

## How reminders are scheduled (reliability)

All scheduling lives in the background service worker (`src/background/`), never in the React UI. The rules themselves are pure functions in `src/features/reminders/services/`, so they are unit-tested.

- **Local-time storage.** Each reminder stores its current occurrence as a local wall-clock value (`2026-11-05T09:00`), not an epoch. The epoch is computed at scheduling time, so 9 AM stays 9 AM across DST changes and time-zone moves.
- **Calendar recurrence.** The next occurrence is computed from a fixed anchor on the calendar (daily +1 day, weekly +7 days, monthly with day clamping), never by adding 24 h × n. This means no drift across DST, and the 31st survives February.
- **Exactly-once notifications.** A reminder records a `notifiedKey` (`occurrence@snoozedUntil`). The notification is created only if the key changed, and its ID is per reminder, so recreating it replaces rather than duplicates. Snoozing changes the key, so the snoozed alert fires exactly once more.
- **Idempotent reconcile.** On every wake-up (install, update, browser start, alarm, storage change from any page, UI message, and a **15-minute heartbeat**), the worker re-reads storage and brings everything in line:
  - It recreates missing alarms, clears stale ones, and leaves unchanged ones alone.
  - It notifies due reminders once and clears notifications that no longer apply.
  - It updates the badge.
- **Missed reminders.** If Chrome was closed or asleep, a one-time reminder alerts once, labelled *Missed*. A repeating reminder that missed several occurrences collapses the backlog into one catch-up notification and one `missed` history entry.
- **Safe storage writes.** Each task and reminder lives under its own key (`task:<id>`, `reminder:<id>`), so the popup, the dashboard and the worker never overwrite each other's unrelated changes. Writes within a context are serialized, and each update re-reads the latest value just before applying its change.

**Known timing limits:**
- Chrome may delay alarms, typically up to about a minute, and longer while the computer sleeps or Chrome is closed. Reminders can be late, never early.
- A time-zone change made while Chrome is running is picked up within 15 minutes by the heartbeat.
- A time that doesn't exist on a spring-forward day (e.g. 02:30) fires at the first valid moment after the gap (03:30).

---

## Project structure

```
popup.html, dashboard.html     Vite HTML entries
public/manifest.json           Manifest V3
public/icons/                  Generated PNG icons (scripts/generate-icons.mjs)
src/
  background/                  Service worker: listeners (index.ts) + scheduling engine (engine.ts)
  app/                         App bootstrap (providers) and ActionsProvider (dialogs, confirms, toasts)
  components/ui/               Button, Field, Toggle, Dialog (native <dialog>), Menu, Toast, Mascot, …
  features/
    tasks/                     types, services/taskLogic (pure), services/taskQueries (views/stats), components
    reminders/                 types, services/recurrence + reminderLogic (pure), components
    quickadd/                  Natural-language parser (pure) + QuickAdd component
    insights/                  Daily overview + weekly chart
    settings/                  Settings view (incl. AI key), import dialog
    timesheet/                 Day report, quick summary, Gemini prompt, bullet normaliser (pure)
  pages/popup, pages/dashboard Page shells and views
  services/
    storage/                   StorageArea (chrome | memory | dev), Repository, schema/validation, import/export
    alarms/, notifications/    Chrome API ports + pure planning (alarm diffing, notification building)
    ai/gemini.ts               Gemini client: header auth, timeout, model fallback, friendly errors
    chromeApi.ts               Tabs, dashboard navigation, messaging
    oopsieService.ts           Use-case layer used by the UI
  hooks/, utils/, styles/, types/
tests/                         Vitest (Chrome APIs replaced by in-memory fakes)
```

## Tests

`npm test` runs 92 tests in 7 files. Chrome APIs are replaced by in-memory fakes (`tests/helpers.ts`), and the background engine runs against a controllable clock. The tests cover:

- **Tasks:** creation, editing, validation, the pending/active/completed statuses with work sessions and time spent, completed tasks staying visible and in place, migration of old data, reopening and subtasks; recurring-task spawning; overdue rules; views, search, filters, sorting, daily stats and weekly counts.
- **Reminders:** creation and validation (including past times and unsafe URLs), editing and rescheduling, snooze, done/dismiss, and reactivation.
- **Recurrence:** daily, weekly and monthly series, including month-end clamping and catch-up. DST fall-back and spring-forward in New York. A time-zone change (New York → London).
- **Engine:**
  - Alarm creation, rescheduling and clearing.
  - Exactly-once notifications under repeated concurrent wake-ups.
  - Snooze and Done from notification buttons.
  - **Browser restart** with missed reminders, and a snoozed reminder after restart.
  - Deleting reminders.
  - Notifications disabled.
  - Concurrent UI edit during reconcile.
  - Badge counts and task ↔ reminder rules.
- **Timesheet:** which tasks belong to a day, per-day time including sessions that cross midnight, quick-summary format, prompt contents respecting options, bullet normalisation, and the Gemini client with mocked network (header-only key, model fallback, bad key, offline). The API key is never exported.
- **Storage and import/export:** persistence across a "restart", racing updates, cross-context isolation, corrupted records, export round-trip, malformed imports, skipping bad records, merge vs. replace.

## Known limitations

- No sync across devices (data is local by design). Use Export and Import to move data.
- Notification buttons and `requireInteraction` depend on the OS. On macOS, buttons appear only with the "Alerts" notification style.
- Repeat options are daily, weekly (same weekday as the start) and monthly (same day of month). Custom intervals, weekday sets and end dates are not supported yet.
- The quick-add parser is English-only and rule-based. Ambiguous numbers like `at 3` are read as working hours (3 PM).
- Reopening a completed repeating task doesn't remove the next instance that was already created.
- AI summaries need an internet connection and a Gemini key, and Google may be slow or busy at times. The quick summary always works. The light model can keep a task title's original wording, so edit before copying or choose a stronger model.
- `npm run dev` previews the UI only. Alarms, notifications and the context menu need the built extension.
