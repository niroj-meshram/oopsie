import { timeSpentMs } from '@/features/tasks/services/taskLogic';
import type { Task, TaskStatus } from '@/types';
import { addDays, localToEpoch, toLocalDate, type LocalDate } from '@/utils/date';
import { formatDuration } from '@/utils/format';

/**
 * Builds the material for a daily timesheet from task statuses and work
 * sessions. Everything here is pure so it can be tested and reused for both
 * the local (no-AI) summary and the Gemini prompt.
 */

export type EntryKind = 'completed' | 'in-progress' | 'planned';

export interface TimesheetEntry {
  task: Task;
  kind: EntryKind;
  /** Current status of the task (may differ from what it was during the day). */
  status: TaskStatus;
  /** Time spent active inside the selected day. */
  timeMs: number;
  completedThatDay: boolean;
}

export interface DayReport {
  date: LocalDate;
  entries: TimesheetEntry[];
  totalMs: number;
}

export interface ReportOptions {
  /** Also list pending tasks due that day that weren't worked on. */
  includePlanned: boolean;
}

const KIND_ORDER: Record<EntryKind, number> = { completed: 0, 'in-progress': 1, planned: 2 };

export function dayBounds(date: LocalDate): { from: number; to: number } {
  return { from: localToEpoch(date), to: localToEpoch(addDays(date, 1)) };
}

/**
 * A task belongs on a day's timesheet when it was worked on that day (a
 * session overlaps it), completed that day, or — optionally — planned for it.
 */
export function buildDayReport(tasks: Task[], date: LocalDate, now: number, options: ReportOptions): DayReport {
  const { from, to } = dayBounds(date);
  const entries: TimesheetEntry[] = [];
  for (const task of tasks) {
    const timeMs = timeSpentMs(task, now, from, to);
    const completedThatDay = task.status === 'completed' && task.completedAt !== null && task.completedAt >= from && task.completedAt < to;
    const workedThatDay = timeMs > 0 || (task.status === 'active' && date === toLocalDate(now));
    let kind: EntryKind | null = null;
    if (completedThatDay) kind = 'completed';
    else if (workedThatDay) kind = 'in-progress';
    else if (options.includePlanned && task.status !== 'completed' && task.dueDate === date) kind = 'planned';
    if (kind) entries.push({ task, kind, status: task.status, timeMs, completedThatDay });
  }
  entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.timeMs - a.timeMs || a.task.title.localeCompare(b.task.title));
  return { date, entries, totalMs: entries.reduce((sum, e) => sum + e.timeMs, 0) };
}

// ---------------------------------------------------------------------------
// Quick (offline) summary in the user's timesheet style
// ---------------------------------------------------------------------------

/** Irregular or consonant-doubling verbs: [past, -ing]. */
const IRREGULAR: Record<string, [string, string]> = {
  write: ['wrote', 'writing'], build: ['built', 'building'], meet: ['met', 'meeting'], send: ['sent', 'sending'],
  set: ['set', 'setting'], plan: ['planned', 'planning'], debug: ['debugged', 'debugging'], run: ['ran', 'running'],
  get: ['got', 'getting'], make: ['made', 'making'], do: ['did', 'doing'], read: ['read', 'reading'],
  lead: ['led', 'leading'], begin: ['began', 'beginning'], ship: ['shipped', 'shipping'], chat: ['chatted', 'chatting'],
  rerun: ['reran', 'rerunning'], rewrite: ['rewrote', 'rewriting'],
};

/** Words that read as an action at the start of a task title ("Fix login bug"). */
const ACTION_VERBS = new Set([
  ...Object.keys(IRREGULAR),
  'add', 'analyse', 'analyze', 'attend', 'call', 'check', 'clean', 'complete', 'configure', 'create', 'deploy', 'design',
  'discuss', 'document', 'draft', 'email', 'explain', 'finish', 'fix', 'follow', 'handle', 'implement', 'improve',
  'inform', 'integrate', 'investigate', 'merge', 'migrate', 'optimise', 'optimize', 'prepare', 'refactor', 'release',
  'remove', 'research', 'resolve', 'retest', 'review', 'support', 'test', 'update', 'upgrade', 'verify',
]);

function pastTense(verb: string): string {
  const v = verb.toLowerCase();
  if (IRREGULAR[v]) return IRREGULAR[v][0];
  if (v.endsWith('e')) return `${v}d`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`;
  return `${v}ed`;
}

function gerund(verb: string): string {
  const v = verb.toLowerCase();
  if (IRREGULAR[v]) return IRREGULAR[v][1];
  if (v.endsWith('e') && !v.endsWith('ee')) return `${v.slice(0, -1)}ing`;
  return `${v}ing`;
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Lower-cases a leading word unless it looks like an acronym, ticket or name with inner capitals. */
const softLower = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const endSentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/** "Fix login bug" → { verb: "Fix", rest: "login bug" } when the title starts with an action. */
function splitAction(title: string): { verb: string; rest: string } | null {
  const m = /^([A-Za-z]+)\s+(.+)$/.exec(title.trim());
  if (!m || !ACTION_VERBS.has(m[1]!.toLowerCase())) return null;
  return { verb: m[1]!, rest: m[2]! };
}

/** First sentence/line of the notes, trimmed, for a little extra detail. */
function noteDetail(task: Task): string {
  const first = task.description.split(/\n|(?<=[.!?])\s/)[0]?.trim() ?? '';
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

function sentenceFor(e: TimesheetEntry, now: number, report: DayReport): string {
  const title = e.task.title.trim();
  const action = splitAction(title);
  const { from } = dayBounds(report.date);
  const firstSession = e.task.sessions[0]?.start ?? e.task.startedAt ?? now;
  const startedThatDay = firstSession >= from;
  switch (e.kind) {
    case 'completed':
      return action ? `${capitalise(pastTense(action.verb))} ${action.rest}` : `Completed ${softLower(title)}`;
    case 'in-progress': {
      const work = action ? `${gerund(action.verb)} ${action.rest}` : softLower(title);
      return `${startedThatDay ? 'Started working on' : 'Continued working on'} ${work}`;
    }
    case 'planned':
      return `Planned to work on ${action ? `${gerund(action.verb)} ${action.rest}` : softLower(title)}`;
  }
}

/**
 * Deterministic, offline summary in timesheet style: one "- " sentence per
 * task, past tense, ending with a full stop, e.g.
 *   - Fixed the login redirect bug. Verified the flow on staging.
 *   - Started working on ticket #392.
 */
export function localSummary(report: DayReport, opts: { includeTime: boolean }, now: number = Date.now()): string {
  return report.entries
    .map((e) => {
      let line = sentenceFor(e, now, report);
      if (opts.includeTime && e.timeMs > 0) line += ` (${formatDuration(e.timeMs)})`;
      line = endSentence(line);
      const detail = noteDetail(e.task);
      if (detail) line += ` ${endSentence(capitalise(detail))}`;
      return `- ${line}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Gemini prompt
// ---------------------------------------------------------------------------

export interface PromptOptions {
  includeTime: boolean;
  includeNotes: boolean;
  /** The user's own past timesheets, used purely as a style reference. */
  styleExamples?: string;
}

export const TIMESHEET_SYSTEM_PROMPT = `You write a professional's daily timesheet from their task list.

FORMAT
- Output ONLY bullet lines. Every line starts with "- " (hyphen + space) and is one or two complete sentences ending with a full stop.
- No headings, no bold, no numbering, no intro or closing text, no time durations unless a "timeSpent" value is provided.
- Usually 2–6 bullets. Merge closely related tasks (same ticket or same piece of work) into one bullet.
- Cover EVERY task in the input, and always keep the main action from its title (e.g. a task titled "Deploy #396 to production" must mention deploying #396 to production), then add the details from its notes.

STYLE
- Past tense, starting with a strong action verb: Investigated, Completed, Implemented, Fixed, Improved, Deployed, Reviewed, Verified, Explained, Informed, Upgraded, Analysed, Identified.
- Each bullet tells the small story of the work: what was done, then the follow-through or outcome joined with "and" (e.g. "…and deployed the changes to staging for client review.").
- Keep every ticket reference exactly as written (e.g. "#392", "ticket #379"), and keep environments (locally, staging, production), people and clients only when they appear in the input.
- Work that is not finished: "Started working on …" for work begun that day, or "Continued working on …"; you may add "Currently …ing …" for the ongoing step.
- Completed work: describe it as done (e.g. "Completed ticket #379 and …", "Fixed the issue where …").
- Planned tasks that were not started: include only if present, as "Planned …".
- Professional, client-ready British English (e.g. "analysing"). Use the task notes and subtasks to add concrete detail, but NEVER invent work, tickets, people, environments or results that are not in the input.

EXAMPLE (style only — never reuse these facts)
Input: "Upgrade framework for security patch" (completed, notes: tested locally and on staging, released to production), "#212 export fix" (completed, notes: deployed to staging for client review), "#215 reporting" (in progress, notes: reviewing requirements)
Output:
- Investigated the reported framework security vulnerability, upgraded to the patched version locally and on staging, verified application functionality, and deployed the update to production.
- Completed ticket #212 and deployed the export fix to staging for client review.
- Started working on ticket #215 by reviewing the requirements and analysing the existing reporting workflow.`;

/** The user part of the prompt: optional style samples, then the day's tasks as compact JSON. */
export function buildPrompt(report: DayReport, opts: PromptOptions): string {
  const { from } = dayBounds(report.date);
  const items = report.entries.map((e) => {
    const firstSession = e.task.sessions[0]?.start ?? e.task.startedAt;
    return {
      title: e.task.title,
      status:
        e.kind === 'completed'
          ? 'completed'
          : e.kind === 'planned'
            ? 'planned, not started'
            : firstSession !== null && firstSession !== undefined && firstSession < from
              ? 'in progress (continued from an earlier day)'
              : 'in progress (started this day)',
      ...(opts.includeTime && e.timeMs > 0 ? { timeSpent: formatDuration(e.timeMs) } : {}),
      ...(opts.includeNotes && e.task.description ? { notes: e.task.description.slice(0, 600) } : {}),
      ...(opts.includeNotes && e.task.subtasks.length
        ? { subtasks: e.task.subtasks.slice(0, 15).map((s) => `${s.done ? '[done]' : '[todo]'} ${s.title}`) }
        : {}),
      ...(e.task.labels.length ? { labels: e.task.labels } : {}),
    };
  });
  const examples = opts.styleExamples?.trim();
  const styleBlock = examples
    ? `Here are some of my own past timesheets. Match their tone, sentence structure and level of detail closely, but do NOT copy their facts:\n"""\n${examples.slice(0, 4000)}\n"""\n\n`
    : '';
  return `${styleBlock}Date: ${report.date}\nTasks:\n${JSON.stringify(items, null, 1)}\n\nWrite my timesheet bullets for this day.`;
}

/**
 * Forces model output into the required shape: every non-empty line becomes
 * "- …" (converting *, •, numbered lists), with markdown emphasis removed.
 */
export function normalizeBullets(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line))
    .map((line) =>
      line
        .replace(/^(?:[-*•–]|\d+[.)])\s*/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .map((line) => `- ${/[.!?]$/.test(line) ? line : `${line}.`}`)
    .join('\n');
}
