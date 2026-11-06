import { describe, expect, it, vi } from 'vitest';
import { completeTask, createTask, reopenTask, startTask } from '@/features/tasks/services/taskLogic';
import { buildDayReport, buildPrompt, localSummary, normalizeBullets } from '@/features/timesheet/timesheetLogic';
import { GeminiError, generateWithGemini } from '@/services/ai/gemini';
import { Repository } from '@/services/storage/repository';
import { buildExport } from '@/services/storage/schema';
import { createMemoryStorageArea } from '@/services/storage/storageArea';
import { at } from './helpers';

const MIN = 60_000;
const DAY_START = at('2026-10-26', '09:00');

function sampleDay() {
  // Worked 9:00–10:20 and completed.
  const report = completeTask(startTask(createTask({ title: 'Review pull requests', description: 'API + UI repos' }, DAY_START), DAY_START), DAY_START + 80 * MIN).task;
  // Worked 10:30–11:15, paused, still pending.
  const spec = reopenTask(startTask(createTask({ title: 'Write sprint spec', subtasks: [{ title: 'Scope', done: true }, { title: 'Estimates' }] }, DAY_START), DAY_START + 90 * MIN), DAY_START + 135 * MIN);
  // Active right now since 14:00.
  const bug = startTask(createTask({ title: 'Fix login bug', labels: ['backend'] }, DAY_START), at('2026-10-26', '14:00'));
  // Planned for today, never started.
  const call = createTask({ title: 'Client call', dueDate: '2026-10-26', dueTime: '16:00' }, DAY_START);
  // Unrelated: worked yesterday only.
  const old = reopenTask(startTask(createTask({ title: 'Yesterday thing' }, at('2026-10-25', '10:00')), at('2026-10-25', '10:00')), at('2026-10-25', '11:00'));
  return [report, spec, bug, call, old];
}

const NOW = at('2026-10-26', '14:30');

describe('day report', () => {
  it('collects completed, in-progress and planned tasks with time spent that day', () => {
    const r = buildDayReport(sampleDay(), '2026-10-26', NOW, { includePlanned: true });
    expect(r.entries.map((e) => [e.task.title, e.kind, e.timeMs / MIN])).toEqual([
      ['Review pull requests', 'completed', 80],
      ['Write sprint spec', 'in-progress', 45],
      ['Fix login bug', 'in-progress', 30],
      ['Client call', 'planned', 0],
    ]);
    expect(r.totalMs).toBe(155 * MIN);
  });

  it('can leave out planned tasks and looks at other days independently', () => {
    expect(buildDayReport(sampleDay(), '2026-10-26', NOW, { includePlanned: false }).entries).toHaveLength(3);
    const yesterday = buildDayReport(sampleDay(), '2026-10-25', NOW, { includePlanned: true });
    expect(yesterday.entries.map((e) => [e.task.title, e.timeMs / MIN])).toEqual([['Yesterday thing', 60]]);
  });

  it('splits a session that crosses midnight between the two days', () => {
    const t = reopenTask(startTask(createTask({ title: 'Late deploy' }, 0), at('2026-10-25', '23:30')), at('2026-10-26', '00:45'));
    expect(buildDayReport([t], '2026-10-25', NOW, { includePlanned: false }).totalMs).toBe(30 * MIN);
    expect(buildDayReport([t], '2026-10-26', NOW, { includePlanned: false }).totalMs).toBe(45 * MIN);
  });
});

describe('summaries', () => {
  it('writes timesheet-style sentences without AI', () => {
    const text = localSummary(buildDayReport(sampleDay(), '2026-10-26', NOW, { includePlanned: true }), { includeTime: false }, NOW);
    expect(text.split('\n')).toEqual([
      '- Reviewed pull requests. API + UI repos.',
      '- Started working on writing sprint spec.',
      '- Started working on fixing login bug.',
      '- Planned to work on client call.',
    ]);
    const timed = localSummary(buildDayReport(sampleDay(), '2026-10-26', NOW, { includePlanned: false }), { includeTime: true }, NOW);
    expect(timed.split('\n')[0]).toBe('- Reviewed pull requests (1h 20m). API + UI repos.');
  });

  it('keeps ticket titles and says "Continued" for work started on an earlier day', () => {
    const t = startTask(createTask({ title: 'Ticket #392 scheduling changes' }, 0), at('2026-10-25', '16:00'));
    const done = completeTask(createTask({ title: '#379 export fix' }, 0), NOW).task;
    const text = localSummary(buildDayReport([t, done], '2026-10-26', NOW, { includePlanned: false }), { includeTime: false }, NOW);
    expect(text).toBe('- Completed #379 export fix.\n- Continued working on ticket #392 scheduling changes.');
  });

  it('puts the user style examples into the prompt', () => {
    const report = buildDayReport(sampleDay(), '2026-10-26', NOW, { includePlanned: false });
    const prompt = buildPrompt(report, { includeTime: false, includeNotes: true, styleExamples: '- Completed ticket #1 and deployed to staging.' });
    expect(prompt).toContain('Match their tone');
    expect(prompt).toContain('- Completed ticket #1 and deployed to staging.');
    expect(prompt).toContain('in progress (started this day)');
    expect(buildPrompt(report, { includeTime: false, includeNotes: true })).not.toContain('Match their tone');
  });

  it('builds a prompt with only what the user allowed', () => {
    const report = buildDayReport(sampleDay(), '2026-10-26', NOW, { includePlanned: true });
    const full = buildPrompt(report, { includeTime: true, includeNotes: true });
    expect(full).toContain('Review pull requests');
    expect(full).toContain('API + UI repos');
    expect(full).toContain('1h 20m');
    const lean = buildPrompt(report, { includeTime: false, includeNotes: false });
    expect(lean).not.toContain('API + UI repos');
    expect(lean).not.toContain('1h 20m');
  });

  it('normalises model output into "- " bullets', () => {
    const raw = '```\n* **Completed** code review\n• Fixed bug.\n1. Worked on spec\n\n-Deployed #396 to production.\n```';
    expect(normalizeBullets(raw)).toBe('- Completed code review.\n- Fixed bug.\n- Worked on spec.\n- Deployed #396 to production.');
  });
});

describe('gemini client', () => {
  const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  const fail = (status: number, message = '') => new Response(JSON.stringify({ error: { message } }), { status });

  it('sends the key in a header (not the URL) and returns the text', async () => {
    const fetchImpl = vi.fn(async () => ok('- Did things'));
    const res = await generateWithGemini({ apiKey: ' secret-key-1234567890abc ', model: 'gemini-flash-lite-latest', system: 's', prompt: 'p', fetchImpl });
    expect(res).toEqual({ text: '- Did things', model: 'gemini-flash-lite-latest' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent');
    expect(url).not.toContain('secret');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key-1234567890abc');
  });

  it('falls back to another model when one is busy or retired', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(fail(404)).mockResolvedValueOnce(ok('- Fallback worked'));
    const res = await generateWithGemini({ apiKey: 'k'.repeat(30), model: 'gemini-3.8-flash', system: 's', prompt: 'p', fetchImpl });
    expect(res.text).toBe('- Fallback worked');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('stops immediately on a rejected key with a helpful message', async () => {
    const fetchImpl = vi.fn(async () => fail(400, 'API key not valid. Please pass a valid API key.'));
    await expect(generateWithGemini({ apiKey: 'k'.repeat(30), model: 'gemini-flash-lite-latest', system: 's', prompt: 'p', fetchImpl })).rejects.toThrow(/rejected the API key/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requires a key and reports network failures', async () => {
    await expect(generateWithGemini({ apiKey: ' ', model: 'm-1', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(GeminiError);
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(generateWithGemini({ apiKey: 'k'.repeat(30), model: 'gemini-flash-lite-latest', system: 's', prompt: 'p', fetchImpl: offline })).rejects.toThrow(/internet/);
  });
});

describe('API key storage', () => {
  it('keeps the key out of exports and backups', async () => {
    const repo = new Repository(createMemoryStorageArea());
    await repo.setAiConfig({ geminiApiKey: 'super-secret-key-1234567890' });
    expect((await repo.getAiConfig()).geminiApiKey).toBe('super-secret-key-1234567890');
    const exported = JSON.stringify(buildExport(await repo.loadAll()));
    expect(exported).not.toContain('super-secret');
    await repo.replaceAll({ tasks: [], reminders: [], settings: null });
    expect((await repo.getAiConfig()).geminiApiKey).toBe('super-secret-key-1234567890');
  });
});
