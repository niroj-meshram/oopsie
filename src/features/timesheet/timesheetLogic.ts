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
// Ticket numbers
// ---------------------------------------------------------------------------

/** A timesheet always has between 2 and 4 points, depending on how much was done. */
export const MIN_POINTS = 2;
export const MAX_POINTS = 4;

export interface TicketRef {
  /** How to mention it in a sentence: "ticket #392", "PR #45", "ticket PROJ-12". */
  ticket: string | null;
  /** True when `subject` still contains the reference (it sat in the middle of the title). */
  mentioned: boolean;
  /** The title without a leading/trailing ticket reference. */
  subject: string;
}

/** Case-insensitive alternation without making the Jira key part case-insensitive. */
const ci = (words: string[]) => words.map((w) => [...w].map((c) => `[${c.toUpperCase()}${c}]`).join('')).join('|');
const REF_WORDS = ['ticket', 'task', 'issue', 'bug', 'story', 'card', 'pr'];
const TITLE_REF_RE = new RegExp(`(?:\\b(${ci(REF_WORDS)})\\s*#?(\\d+)\\b|#(\\d+)\\b|\\b([A-Z][A-Z0-9]{1,9}-\\d+)\\b)`);
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

function refLabel(word: string | undefined, num: string | undefined, key: string | undefined): string {
  if (key) return `ticket ${key}`;
  const w = word?.toLowerCase();
  if (w === 'pr') return `PR #${num}`;
  return `${w ?? 'ticket'} #${num}`;
}

function refFromUrl(url: string | null): string | null {
  if (!url) return null;
  const gh = /\/(issues|pull|pulls|merge_requests)\/(\d+)/.exec(url);
  if (gh) return gh[1] === 'issues' ? `ticket #${gh[2]}` : `PR #${gh[2]}`;
  const jira = /[/=]([A-Z][A-Z0-9]{1,9}-\d+)(?:[/?#&]|$)/.exec(url);
  return jira ? `ticket ${jira[1]}` : null;
}

function refFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const l = label.trim();
    if (/^#?\d+$/.test(l)) return `ticket #${l.replace('#', '')}`;
    if (JIRA_KEY_RE.test(l)) return `ticket ${l}`;
  }
  return null;
}

/**
 * Finds the task/ticket number: in the title first ("#392 export fix",
 * "Ticket 392: …", "PROJ-12 …", "Fix login [#12]"), then the task link
 * (GitHub issue/PR, Jira), then a label such as "#392".
 */
export function extractTicket(task: Pick<Task, 'title' | 'url' | 'labels'>): TicketRef {
  const title = task.title.trim();
  const m = TITLE_REF_RE.exec(title);
  if (m) {
    const ticket = refLabel(m[1], m[2] ?? m[3], m[4]);
    const before = title.slice(0, m.index).replace(/[\s[(:|–—-]+$/, '').trim();
    const after = title.slice(m.index + m[0].length).replace(/^[\s\])}:|–—.-]+/, '').trim();
    if (!before) return { ticket, mentioned: false, subject: after };
    if (!after || /^[\])}]+$/.test(after)) return { ticket, mentioned: false, subject: before };
    return { ticket, mentioned: true, subject: title };
  }
  return { ticket: refFromUrl(task.url) ?? refFromLabels(task.labels), mentioned: false, subject: title };
}

// ---------------------------------------------------------------------------
// Quick (offline) summary
// ---------------------------------------------------------------------------

/** Irregular or consonant-doubling verbs: [past, -ing]. */
const IRREGULAR: Record<string, [string, string]> = {
  write: ['wrote', 'writing'], build: ['built', 'building'], meet: ['met', 'meeting'], send: ['sent', 'sending'],
  set: ['set', 'setting'], plan: ['planned', 'planning'], debug: ['debugged', 'debugging'], run: ['ran', 'running'],
  get: ['got', 'getting'], make: ['made', 'making'], do: ['did', 'doing'], read: ['read', 'reading'],
  lead: ['led', 'leading'], begin: ['began', 'beginning'], ship: ['shipped', 'shipping'], chat: ['chatted', 'chatting'],
  rerun: ['reran', 'rerunning'], rewrite: ['rewrote', 'rewriting'], stop: ['stopped', 'stopping'], log: ['logged', 'logging'],
  scan: ['scanned', 'scanning'], wrap: ['wrapped', 'wrapping'], map: ['mapped', 'mapping'], drop: ['dropped', 'dropping'],
};

/** Words that read as an action at the start of a task title ("Fix login bug"). */
const ACTION_VERBS = new Set([
  ...Object.keys(IRREGULAR),
  'add', 'analyse', 'analyze', 'attend', 'call', 'check', 'clean', 'complete', 'configure', 'coordinate', 'create', 'demo',
  'deploy', 'design', 'discuss', 'document', 'draft', 'email', 'estimate', 'explain', 'finish', 'fix', 'follow', 'handle',
  'implement', 'improve', 'inform', 'integrate', 'investigate', 'look', 'merge', 'migrate', 'monitor', 'optimise', 'optimize',
  'patch', 'polish', 'prepare', 'raise', 'refactor', 'release', 'remove', 'reply', 'research', 'resolve', 'respond', 'retest',
  'review', 'rework', 'support', 'sync', 'test', 'update', 'upgrade', 'verify',
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

/** "a", "a and b", "a, b and c". */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Fix login bug" → { verb: "Fix", rest: "login bug" } when the title starts with an action. */
function splitAction(title: string): { verb: string; rest: string } | null {
  const m = /^([A-Za-z]+)\s+(.+)$/.exec(title.trim());
  if (!m || !ACTION_VERBS.has(m[1]!.toLowerCase())) return null;
  return { verb: m[1]!, rest: m[2]! };
}

/** Notes split into short fragments: lines, "; " parts and sentences, without bullets or end punctuation. */
function noteFragments(description: string): string[] {
  return description
    .split(/\n|;|(?<=[.!?])\s+/)
    .map((f) => f.replace(/^\s*(?:[-*•–]|\d+[.)]|\[[ x]\])\s*/i, '').replace(/[\s.!?;,]+$/, '').trim())
    .filter((f) => f.length > 1)
    .slice(0, 6)
    .map((f) => (f.length > 160 ? `${f.slice(0, 157)}…` : f));
}

const PAST_FORMS = new Set([...ACTION_VERBS].map(pastTense));

/** "Fixed rounding", "Deployed to staging": a fragment that already reads as finished work. */
function isDoneFragment(f: string): boolean {
  const first = /^[A-Za-z]+/.exec(f)?.[0].toLowerCase() ?? '';
  return PAST_FORMS.has(first) || (first.length > 3 && first.endsWith('ed'));
}

/** A short scope note without a verb, such as "API + UI repos". */
const isScopeNote = (f: string) => !isDoneFragment(f) && f.split(/\s+/).length <= 4;

/**
 * Notes woven into sentences: consecutive pieces of finished work are joined
 * ("Fixed rounding, deployed to staging and asked the client to verify."),
 * anything else stays its own sentence.
 */
function noteSentences(fragments: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(endSentence(capitalise(listJoin(run.map((f, j) => (j === 0 ? f : softLower(f)))))));
    run = [];
  };
  for (const f of fragments) {
    if (isDoneFragment(f)) {
      run.push(f);
      if (run.length === 3) flush();
    } else {
      flush();
      out.push(endSentence(capitalise(f)));
    }
  }
  flush();
  return out;
}

/** Up to three names, then "and N more". */
function nameList(names: string[]): string {
  const clean = names.map((n) => softLower(n.trim().replace(/[.!?]+$/, '')));
  return clean.length > 3 ? listJoin([...clean.slice(0, 3), `${clean.length - 3} more`]) : listJoin(clean);
}

interface Analysed {
  entry: TimesheetEntry;
  ticket: string | null;
  /** Opening clause, without the full stop. */
  lead: string;
  notes: string[];
  /** Subtask progress sentence. */
  progress: string | null;
  /** The same, worded to stand as a point of its own. */
  progressAlone: string | null;
  /** Where the work stands now, said right after the lead. */
  tail: string | null;
  /** The same, worded to stand as a point of its own. */
  tailAlone: string | null;
}

function startedOn(e: TimesheetEntry, from: number): boolean {
  const first = e.task.sessions[0]?.start ?? e.task.startedAt;
  return first === null || first === undefined || first >= from;
}

function analyse(e: TimesheetEntry, report: DayReport, now: number, includeTime: boolean, continuedIndex: number): Analysed {
  const ref = extractTicket(e.task);
  const action = splitAction(ref.subject);
  const ticketTag = ref.ticket && !ref.mentioned ? ref.ticket : null;
  const time = includeTime && e.timeMs > 0 ? formatDuration(e.timeMs) : null;
  const paren = (...items: (string | null)[]) => {
    const parts = items.filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
  };
  // "ticket #401 – invoice totals wrong", or just the subject / ticket.
  const named = ticketTag && ref.subject ? `${ticketTag} – ${softLower(ref.subject)}` : softLower(ref.subject || ref.ticket || e.task.title.trim());
  const started = startedOn(e, dayBounds(report.date).from);
  const alt = continuedIndex % 2 === 1;

  let lead: string;
  switch (e.kind) {
    case 'completed':
      lead = action ? `${capitalise(pastTense(action.verb))} ${action.rest}${paren(ticketTag, time)}` : `Completed ${named}${paren(time)}`;
      break;
    case 'in-progress':
      if (action) {
        const work = `${gerund(action.verb)} ${action.rest}`;
        lead = `${started ? 'Started' : alt ? 'Made further progress on' : 'Continued'} ${work}${paren(ticketTag, time)}`;
      } else {
        lead = `${started ? 'Started working on' : alt ? 'Made further progress on' : 'Continued working on'} ${named}${paren(time)}`;
      }
      break;
    case 'planned':
      lead = action ? `Planned to ${action.verb.toLowerCase()} ${action.rest}${paren(ticketTag)}` : `Planned to work on ${named}`;
      break;
  }

  const done = e.task.subtasks.filter((s) => s.done).map((s) => s.title);
  const todo = e.task.subtasks.filter((s) => !s.done).map((s) => s.title);
  let progress: string | null = null;
  let progressAlone: string | null = null;
  if (e.kind === 'completed') {
    if (done.length) {
      progress = `This covered ${nameList(done)}.`;
      progressAlone = `Covered ${nameList(done)} as part of ${ref.ticket ?? 'this work'}.`;
    }
  } else if (e.kind === 'in-progress') {
    if (done.length && todo.length) progress = `Wrapped up ${nameList(done)}, with ${nameList(todo)} still pending.`;
    else if (done.length) progress = `Wrapped up ${nameList(done)}.`;
    else if (todo.length) progress = `Next steps include ${nameList(todo)}.`;
  }

  let tail: string | null = null;
  let tailAlone: string | null = null;
  const it = ref.ticket ?? 'this task';
  if (e.kind === 'planned') {
    tail = 'Not started yet.';
    tailAlone = `Work on ${it} has not started yet.`;
  } else if (e.kind === 'in-progress' && !todo.length) {
    if (e.status === 'active') {
      tail = 'This is still in progress.';
      tailAlone = `Work on ${it} is still in progress${report.date === toLocalDate(now) ? '' : ' and carries over to the next day'}.`;
    } else if (e.status === 'pending') {
      tail = 'Will continue with this in the next session.';
      tailAlone = `Work on ${it} is still in progress and will continue in the next session.`;
    }
  }

  // A short scope note reads best as part of the opening sentence.
  let notes = noteFragments(e.task.description);
  if (notes[0] && isScopeNote(notes[0])) {
    lead += `, covering ${softLower(notes[0])}`;
    notes = notes.slice(1);
  }

  return { entry: e, ticket: ref.ticket, lead, notes, progress, progressAlone: progressAlone ?? progress, tail, tailAlone };
}

/** Second point for a lone task that has nothing more to say. */
function fallbackDetail(a: Analysed): string {
  if (a.entry.kind === 'completed') return `Marked ${a.ticket ?? 'the task'} as completed.`;
  if (a.entry.status === 'completed') return 'Carried the remaining work over and wrapped it up on a later day.';
  return 'Will continue with this in the next session.';
}

const fullPoint = (a: Analysed) => [`${a.lead}.`, ...noteSentences(a.notes), a.progress, a.tail].filter(Boolean).join(' ');

/** One task told as two points: the work itself, then its progress/outcome. */
function splitPoint(a: Analysed): [string, string] {
  const lead = `${a.lead}.`;
  const notes = noteSentences(a.notes);
  const rest = a.progressAlone ? [a.progressAlone, a.tail].filter(Boolean).join(' ') : (a.tailAlone ?? '');
  if (rest) return [[lead, ...notes].join(' '), rest];
  if (notes.length) return [lead, notes.join(' ')];
  return [lead, fallbackDetail(a)];
}

/** Several small tasks of the same status in one point: "Reviewed pull requests – API repo; updated the docs." */
function mergedPoint(items: Analysed[]): string {
  if (items.every((a) => a.entry.kind === 'planned')) {
    return `Planned to ${listJoin(items.map((a) => a.lead.replace(/^Planned to /, '')))}; not started yet.`;
  }
  const clauses = items.map((a, i) => {
    const lead = i === 0 ? a.lead : softLower(a.lead);
    return a.notes[0] ? `${lead} – ${softLower(a.notes[0])}` : lead;
  });
  return endSentence(clauses.join('; '));
}

const groupTime = (g: Analysed[]) => g.reduce((sum, a) => sum + a.entry.timeMs, 0);
const richness = (a: Analysed) => a.notes.length + a.entry.task.subtasks.length;

/**
 * Turns the day into 2–4 points:
 * - 1 task: two points (the work, then its progress or outcome);
 * - 2–4 tasks: one point each, and a task with a lot of detail may get a second point;
 * - 5+ tasks: smaller tasks of the same status are merged so there are 4 points.
 */
export function buildPoints(report: DayReport, opts: { includeTime: boolean }, now: number = Date.now()): string[] {
  let continued = 0;
  const { from } = dayBounds(report.date);
  const analysed = report.entries.map((e) => analyse(e, report, now, opts.includeTime, e.kind === 'in-progress' && !startedOn(e, from) ? continued++ : 0));
  if (!analysed.length) return [];

  if (analysed.length > MAX_POINTS) {
    const groups = analysed.map((a) => [a]);
    while (groups.length > MAX_POINTS) {
      // Merge the adjacent same-status pair with the least tracked time (later pair on ties).
      let best = groups.length - 2;
      let bestTime = Infinity;
      for (let i = 0; i < groups.length - 1; i++) {
        if (groups[i]![0]!.entry.kind !== groups[i + 1]![0]!.entry.kind) continue;
        const t = groupTime(groups[i]!) + groupTime(groups[i + 1]!);
        if (t <= bestTime) {
          best = i;
          bestTime = t;
        }
      }
      groups.splice(best, 2, [...groups[best]!, ...groups[best + 1]!]);
    }
    return groups.map((g) => (g.length === 1 ? fullPoint(g[0]!) : mergedPoint(g)));
  }

  if (analysed.length === 1) return splitPoint(analysed[0]!);

  // Give the most detailed tasks a second point while there is room.
  const toSplit = new Set(
    analysed
      .filter((a) => a.notes.length && (a.progress || a.tail) && richness(a) >= 3)
      .sort((a, b) => richness(b) - richness(a))
      .slice(0, MAX_POINTS - analysed.length),
  );
  return analysed.flatMap((a) => (toSplit.has(a) ? splitPoint(a) : [fullPoint(a)]));
}

/**
 * Deterministic, offline timesheet: 2–4 detailed "- " points that mention
 * ticket numbers and say where each task stands, e.g.
 *   - Fixed login redirect bug (ticket #392). Verified the flow on staging.
 *   - Continued working on ticket #401 – invoice totals. Wrapped up rounding, with tests still pending.
 */
export function localSummary(report: DayReport, opts: { includeTime: boolean }, now: number = Date.now()): string {
  return buildPoints(report, opts, now)
    .map((p) => `- ${p}`)
    .join('\n');
}

/** How many points the day's timesheet should have (2–4), shared by the quick summary and Gemini. */
export function targetPointCount(report: DayReport, now: number = Date.now()): number {
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, buildPoints(report, { includeTime: false }, now).length));
}

// ---------------------------------------------------------------------------
// Gemini prompt
// ---------------------------------------------------------------------------

export interface PromptOptions {
  includeTime: boolean;
  includeNotes: boolean;
  /** The user's own past timesheets, used purely as a style reference. */
  styleExamples?: string;
  now?: number;
}

export const TIMESHEET_SYSTEM_PROMPT = `You write a professional's daily timesheet from their task list, the way an experienced developer would write it themselves at the end of the day.

FORMAT
- Output ONLY bullet lines. Every line starts with "- " (hyphen + space). No headings, bold, numbering, intro or closing text.
- Write EXACTLY the number of bullets the prompt asks for (always between 2 and 4).
- Each bullet is 1–3 complete sentences (roughly 20–60 words) and ends with a full stop.
- More tasks than bullets: combine related work (same ticket, same feature or same status) into one bullet, and still mention every task.
- Fewer tasks than bullets: give a task more than one bullet — e.g. one for the work done and one for the outcome, progress or next steps — using only facts from the input.
- Mention time durations only when a "timeSpent" value is provided.

TASK NUMBERS
- When a task has a "ticket" (e.g. "ticket #392", "PR #45", "ticket PROJ-12"), mention it exactly as given in that task's bullet. Never invent or change ticket numbers.

STATUS — every bullet must reflect where the work stands
- "completed": describe it as done ("Completed ticket #379 and …", "Fixed the issue where …", "Implemented …").
- "in progress – started this day": "Started working on …" or "Began …".
- "in progress – continued from an earlier day": "Continued working on …" or "Made further progress on …".
- "now": "still being worked on" → say it is still in progress; "paused, will continue" → say it will be picked up next; "completed on a later day" → just describe that day's progress.
- "subtasksDone" / "subtasksRemaining": say what was finished and what is still pending.
- "planned for this day, not started": "Planned …; not started yet."

STYLE
- Natural, human, client-ready British English (e.g. "analysing"), past tense. Vary the opening verbs; don't start every bullet the same way.
- Turn the title, notes and subtasks into a concrete account: what was done, then the follow-through or outcome joined with "and" (e.g. "…and deployed the changes to staging for client review.").
- Keep environments (locally, staging, production), people and clients only when they appear in the input. NEVER invent work, results, tickets or people.

EXAMPLE (style only — never reuse these facts)
Input (3 bullets): "Upgrade framework for security patch" (completed, notes: tested locally and on staging, released to production), "#212 export fix" (ticket #212, completed, notes: deployed to staging for client review), "#215 reporting" (ticket #215, in progress – started this day, now: paused, will continue, notes: reviewing requirements)
Output:
- Investigated the reported framework security vulnerability, upgraded to the patched version locally and on staging, verified application functionality, and deployed the update to production.
- Completed ticket #212 by fixing the export issue and deployed the changes to staging for client review.
- Started working on ticket #215 by reviewing the reporting requirements and analysing the existing workflow; this will be continued in the next session.`;

function statusFor(e: TimesheetEntry, from: number): string {
  if (e.kind === 'completed') return 'completed';
  if (e.kind === 'planned') return 'planned for this day, not started';
  return startedOn(e, from) ? 'in progress – started this day' : 'in progress – continued from an earlier day';
}

function nowFor(e: TimesheetEntry): string | undefined {
  if (e.kind !== 'in-progress') return undefined;
  if (e.status === 'active') return 'still being worked on';
  if (e.status === 'pending') return 'paused, will continue';
  return 'completed on a later day';
}

/** The user part of the prompt: optional style samples, the bullet count, then the day's tasks as compact JSON. */
export function buildPrompt(report: DayReport, opts: PromptOptions): string {
  const { from } = dayBounds(report.date);
  const items = report.entries.map((e) => {
    const ticket = extractTicket(e.task).ticket;
    const done = e.task.subtasks.filter((s) => s.done).map((s) => s.title);
    const todo = e.task.subtasks.filter((s) => !s.done).map((s) => s.title);
    const now = nowFor(e);
    return {
      title: e.task.title,
      ...(ticket ? { ticket } : {}),
      status: statusFor(e, from),
      ...(now ? { now } : {}),
      ...(opts.includeTime && e.timeMs > 0 ? { timeSpent: formatDuration(e.timeMs) } : {}),
      ...(opts.includeNotes && e.task.description ? { notes: e.task.description.slice(0, 600) } : {}),
      ...(opts.includeNotes && done.length ? { subtasksDone: done.slice(0, 15) } : {}),
      ...(opts.includeNotes && todo.length ? { subtasksRemaining: todo.slice(0, 15) } : {}),
      ...(e.task.labels.length ? { labels: e.task.labels } : {}),
    };
  });
  const count = targetPointCount(report, opts.now);
  const examples = opts.styleExamples?.trim();
  const styleBlock = examples
    ? `Here are some of my own past timesheets. Match their tone, sentence structure and level of detail closely, but do NOT copy their facts:\n"""\n${examples.slice(0, 4000)}\n"""\n\n`
    : '';
  return `${styleBlock}Date: ${report.date}\nTasks (${items.length}):\n${JSON.stringify(items, null, 1)}\n\nWrite my timesheet for this day as exactly ${count} detailed bullet points.`;
}

/**
 * Forces model output into the required shape: every non-empty line becomes
 * "- …" (converting *, •, numbered lists), with markdown emphasis removed.
 * Lines beyond `maxPoints` are folded into the last point so nothing is lost.
 */
export function normalizeBullets(text: string, maxPoints: number = MAX_POINTS): string {
  const lines = text
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
    .map(endSentence);
  if (lines.length > maxPoints) lines.splice(maxPoints - 1, lines.length, lines.slice(maxPoints - 1).join(' '));
  return lines.map((line) => `- ${line}`).join('\n');
}
