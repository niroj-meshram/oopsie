import { useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Keyboard, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { useActions } from '@/app/ActionsProvider';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Field';
import { DEFAULT_GEMINI_MODEL, ENV_GEMINI_API_KEY, GeminiError, generateWithGemini, isPlausibleApiKey, SUGGESTED_MODELS } from '@/services/ai/gemini';
import { useToast } from '@/components/ui/Toast';
import { useOopsie } from '@/hooks/useOopsie';
import { extensionVersion, getCommandShortcuts, isExtension, openShortcutSettings } from '@/services/chromeApi';
import { formatSnooze } from '@/services/notifications/notificationService';
import { FOCUS_PRESETS, MAX_FOCUS_MINUTES, MIN_FOCUS_MINUTES } from '@/features/focus/services/focusLogic';
import { ImportError, MAX_IMPORT_BYTES, type ImportResult } from '@/services/storage/schema';
import { SNOOZE_OPTIONS, type Priority, type Settings, type ThemePreference } from '@/types';
import { toLocalDate } from '@/utils/date';

const COMMANDS: { name: string; label: string }[] = [
  { name: '_execute_action', label: 'Open the popup (quick add)' },
  { name: 'open-dashboard', label: 'Open the dashboard' },
  { name: 'save-page', label: 'Save the current page as a task' },
];

export function SettingsView() {
  const { data, service } = useOopsie();
  const actions = useActions();
  const toast = useToast();
  const s = data.settings;
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<{ result: ImportResult; fileName: string } | null>(null);

  useEffect(() => {
    void getCommandShortcuts().then(setShortcuts);
  }, []);

  const update = (patch: Partial<Settings>) =>
    void service.updateSettings(patch).catch(() => toast({ tone: 'error', message: "Couldn't save that setting." }));

  const exportData = async () => {
    try {
      const json = await service.exportJson();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `oopsie-backup-${toLocalDate(Date.now())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ message: `Exported ${data.tasks.length} tasks and ${data.reminders.length} reminders.` });
    } catch {
      toast({ tone: 'error', message: 'Export failed. Please try again.' });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new ImportError('That file is too large to be an Oopsie backup (max 10 MB).');
      const result = service.previewImport(await file.text());
      setImportState({ result, fileName: file.name });
    } catch (err) {
      toast({ tone: 'error', message: err instanceof ImportError ? err.message : "Couldn't read that file." });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearAll = async () => {
    const res = await actions.confirm({
      title: 'Clear all Oopsie data?',
      message: `This permanently deletes ${data.tasks.length} tasks, ${data.reminders.length} reminders, your settings and your saved Gemini key from this browser. Consider exporting a backup first.`,
      confirmLabel: 'Delete everything',
    });
    if (!res.confirmed) return;
    await service.clearAll();
    toast({ message: 'All data cleared. Fresh start!', tone: 'info' });
  };

  return (
    <div className="settings">
      <section className="card settings__section" aria-labelledby="set-appearance">
        <h2 id="set-appearance" className="card__title">Appearance</h2>
        <div className="form__row">
          <Field label="Theme">
            {(p) => (
              <Select {...p} value={s.theme} onChange={(e) => update({ theme: e.target.value as ThemePreference })}>
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            )}
          </Field>
          <Field label="Default task priority">
            {(p) => (
              <Select {...p} value={s.defaultPriority} onChange={(e) => update({ defaultPriority: e.target.value as Priority })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            )}
          </Field>
        </div>
        <Toggle
          label="Playful greetings"
          description="Friendly greetings in the popup and dashboard header."
          checked={s.playfulCopy}
          onChange={(v) => update({ playfulCopy: v })}
        />
        <Toggle
          label="Quick add creates reminders"
          description="When quick-add text includes a time, also set a reminder for it. You can still switch it off per task."
          checked={s.autoReminderFromQuickAdd}
          onChange={(v) => update({ autoReminderFromQuickAdd: v })}
        />
      </section>

      <section className="card settings__section" aria-labelledby="set-notif">
        <h2 id="set-notif" className="card__title">Notifications</h2>
        <Toggle
          label="Desktop notifications"
          description="Show a Chrome notification when a reminder is due. If notifications never appear, check your operating system's notification settings for Chrome."
          checked={s.notificationsEnabled}
          onChange={(v) => update({ notificationsEnabled: v })}
        />
        <Toggle
          label="Keep on screen until I act"
          description="Notifications stay visible until you click, snooze or close them (where your OS supports it)."
          checked={s.persistentNotifications}
          disabled={!s.notificationsEnabled}
          onChange={(v) => update({ persistentNotifications: v })}
        />
        <Toggle
          label="Silent notifications"
          description="No sound."
          checked={s.silentNotifications}
          disabled={!s.notificationsEnabled}
          onChange={(v) => update({ silentNotifications: v })}
        />
        <Toggle
          label="Count on toolbar icon"
          description="Show due reminders + overdue tasks as a badge on the Oopsie icon."
          checked={s.showBadge}
          onChange={(v) => update({ showBadge: v })}
        />
        <Field label="Snooze button on notifications" className="settings__narrow">
          {(p) => (
            <Select {...p} value={s.defaultSnoozeMinutes} onChange={(e) => update({ defaultSnoozeMinutes: Number(e.target.value) })}>
              {SNOOZE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatSnooze(m)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="muted small">
          Chrome checks alarms about once every 30 seconds and may delay them while your computer sleeps, so reminders can arrive a little late — never
          early. Missed reminders are shown once when Chrome is back.
        </p>
      </section>

      <section className="card settings__section" aria-labelledby="set-focus">
        <h2 id="set-focus" className="card__title">Focus timer</h2>
        <Field label="Default focus length (minutes)" hint={`Pre-selected when you start a focus session (${MIN_FOCUS_MINUTES}–${MAX_FOCUS_MINUTES}). Starting a session with another length remembers it.`} className="settings__narrow">
          {(p) => (
            <Select {...p} value={s.defaultFocusMinutes} onChange={(e) => update({ defaultFocusMinutes: Number(e.target.value) })}>
              {[...new Set([...FOCUS_PRESETS, 5, 10, 20, 30, 50, 90, 120, s.defaultFocusMinutes])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Toggle
          label="Ring an alarm when focus ends"
          description="Plays a short chime along with the notification. The notification always stays on screen until you dismiss it."
          checked={s.focusSound}
          onChange={(v) => update({ focusSound: v })}
        />
        <p className="muted small">While a focus session runs, the Oopsie icon shows the minutes left in a red badge.</p>
      </section>

      <AiSettings />

      <section className="card settings__section" aria-labelledby="set-keys">
        <h2 id="set-keys" className="card__title">
          <Keyboard size={16} aria-hidden /> Keyboard shortcuts
        </h2>
        <ul className="shortcut-list">
          {COMMANDS.map((c) => (
            <li key={c.name}>
              <span>{c.label}</span>
              {shortcuts[c.name] ? <kbd>{shortcuts[c.name]}</kbd> : <span className="muted small">{isExtension() ? 'Not set' : '—'}</span>}
            </li>
          ))}
          <li>
            <span>New task (dashboard)</span>
            <kbd>N</kbd>
          </li>
          <li>
            <span>New reminder (dashboard)</span>
            <kbd>R</kbd>
          </li>
          <li>
            <span>Search (dashboard)</span>
            <kbd>/</kbd>
          </li>
          <li>
            <span>Close dialogs</span>
            <kbd>Esc</kbd>
          </li>
        </ul>
        <Button size="sm" variant="secondary" onClick={openShortcutSettings} disabled={!isExtension()}>
          Customize in Chrome
        </Button>
      </section>

      <section className="card settings__section" aria-labelledby="set-data">
        <h2 id="set-data" className="card__title">Your data</h2>
        <p className="muted small">Back up everything to a JSON file, or restore from one. Importing never deletes anything unless you choose “Replace”.</p>
        <div className="settings__buttons">
          <Button icon={<Download size={16} />} onClick={() => void exportData()}>
            Export JSON
          </Button>
          <Button icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>
            Import JSON
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void clearAll()}>
            Clear all data
          </Button>
        </div>
      </section>

      <section className="card settings__section" aria-labelledby="set-privacy">
        <h2 id="set-privacy" className="card__title">
          <ShieldCheck size={16} aria-hidden /> Privacy
        </h2>
        <p className="small">
          Oopsie keeps everything in your browser's local extension storage. No accounts, no servers, no analytics, no tracking. Page titles and links
          are read only when you choose to save a page. The only thing that ever leaves your browser is the optional AI timesheet: when you click
          “Generate with Gemini”, that day's task titles, statuses and times (and notes, if you allow it) are sent to Google Gemini with your own key.
        </p>
        <p className="muted small">Oopsie {extensionVersion()} · Oops less. Do more.</p>
      </section>

      <ImportDialog state={importState} onClose={() => setImportState(null)} />
    </div>
  );
}

function AiSettings() {
  const { service } = useOopsie();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (window.location.hash.includes('section=ai')) {
      document.getElementById('set-ai')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    void service.getAiConfig().then((c) => {
      setKey(c.geminiApiKey);
      setSavedKey(c.geminiApiKey);
      setModel(c.geminiModel);
    });
  }, [service]);

  const dirty = key.trim() !== savedKey;
  const keyError = key.trim() && !isPlausibleApiKey(key) ? "That doesn't look like an API key." : null;

  const save = async () => {
    if (keyError) return;
    await service.saveAiConfig({ geminiApiKey: key.trim(), geminiModel: model });
    setSavedKey(key.trim());
    setStatus(null);
    toast({ message: key.trim() ? 'Gemini key saved on this device.' : 'Gemini key removed.' });
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await generateWithGemini({ apiKey: key.trim() || ENV_GEMINI_API_KEY, model, system: 'Reply with exactly: - OK', prompt: 'Connection test' });
      setStatus({ ok: true, message: `Connected — ${res.model} answered.` });
    } catch (err) {
      setStatus({ ok: false, message: err instanceof GeminiError ? err.message : 'Connection failed.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="card settings__section" aria-labelledby="set-ai">
      <h2 id="set-ai" className="card__title">
        <Sparkles size={16} aria-hidden /> AI timesheet (Gemini)
      </h2>
      <p className="muted small">
        Optional. Your key is stored only in this browser's extension storage — never in backups or exports — and is sent only to Google when you click
        “Generate with Gemini”. Get a key at aistudio.google.com.
      </p>
      {ENV_GEMINI_API_KEY && (
        <p className="small ts-ok">
          {savedKey ? 'A key from your .env file is also built in; the key saved here takes priority.' : 'Using the Gemini API key from your .env file. You can leave the field below empty.'}
        </p>
      )}
      <div className="form__row">
        <Field label="Gemini API key" error={keyError}>
          {(p) => (
            <div className="secret-input">
              <Input
                {...p}
                type={show ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={ENV_GEMINI_API_KEY ? "Optional — .env key in use" : "Paste your API key"}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="icon-btn icon-btn--sm secret-input__toggle" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((v) => !v)}>
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          )}
        </Field>
        <Field label="Model" hint="If a model is busy, Oopsie falls back to another Flash model automatically.">
          {(p) => (
            <Select
              {...p}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                void service.saveAiConfig({ geminiModel: e.target.value });
              }}
            >
              {[...new Set([model, ...SUGGESTED_MODELS])].map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === DEFAULT_GEMINI_MODEL ? ' (fast, recommended)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="settings__buttons">
        <Button variant="primary" disabled={!dirty || !!keyError} onClick={() => void save()}>
          Save key
        </Button>
        <Button loading={testing} disabled={(!key.trim() && !ENV_GEMINI_API_KEY) || !!keyError} onClick={() => void test()}>
          Test connection
        </Button>
        {savedKey && (
          <Button
            variant="ghost"
            className="btn--danger-ghost"
            onClick={() => {
              setKey('');
              void service.saveAiConfig({ geminiApiKey: '' }).then(() => {
                setSavedKey('');
                toast({ message: 'Gemini key removed.', tone: 'info' });
              });
            }}
          >
            Remove key
          </Button>
        )}
      </div>
      {status && (
        <p className={status.ok ? 'small ts-ok' : 'field__error'} role="status">
          {status.message}
        </p>
      )}
      <TimesheetExamples />
    </section>
  );
}

function TimesheetExamples() {
  const { data, service } = useOopsie();
  const toast = useToast();
  const saved = data.settings.timesheetExamples;
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const dirty = text.trim() !== saved.trim();
  return (
    <div className="ts-examples">
      <Field
        label="Your example timesheets (optional)"
        hint="Paste a few past timesheet entries. Gemini copies their tone, structure and level of detail — never their facts. Saved in your settings and included in backups."
      >
        {(p) => (
          <Textarea
            {...p}
            rows={7}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'- Completed ticket #379 and deployed the changes to staging for client review.\n- Started working on ticket #392 by reviewing the requirements.'}
          />
        )}
      </Field>
      <div className="settings__buttons">
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          onClick={() =>
            void service.updateSettings({ timesheetExamples: text }).then(() => toast({ message: 'Timesheet examples saved.' }))
          }
        >
          Save examples
        </Button>
        <span className="muted small">{text.length}/4000</span>
      </div>
    </div>
  );
}

function ImportDialog({ state, onClose }: { state: { result: ImportResult; fileName: string } | null; onClose: () => void }) {
  const { service } = useOopsie();
  const toast = useToast();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [includeSettings, setIncludeSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state) {
      setMode('merge');
      setIncludeSettings(false);
    }
  }, [state]);

  const apply = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const res = await service.applyImport(state.result, mode, includeSettings && !!state.result.settings);
      toast({
        message: res ? `Imported: ${res.added} added, ${res.updated} updated.` : `Replaced with ${state.result.tasks.length} tasks and ${state.result.reminders.length} reminders.`,
      });
      onClose();
    } catch {
      toast({ tone: 'error', message: 'Import failed; your existing data was not changed.' });
    } finally {
      setBusy(false);
    }
  };

  const r = state?.result;
  return (
    <Dialog
      open={!!state}
      onClose={onClose}
      title="Import backup"
      description={state?.fileName}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} loading={busy} onClick={() => void apply()}>
            {mode === 'replace' ? 'Replace my data' : 'Import'}
          </Button>
        </>
      }
    >
      {r && (
        <div className="form">
          <p>
            Found <strong>{r.tasks.length}</strong> tasks and <strong>{r.reminders.length}</strong> reminders.
          </p>
          {r.warnings.map((w) => (
            <p key={w} className="field__error">
              {w}
            </p>
          ))}
          <div className="radio-cards" role="radiogroup" aria-label="Import mode">
            <label className={`radio-card ${mode === 'merge' ? 'is-active' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <strong>Merge</strong>
                <span className="muted small"> Add new items; keep whichever copy was edited most recently. Nothing is deleted.</span>
              </span>
            </label>
            <label className={`radio-card ${mode === 'replace' ? 'is-active' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <strong>Replace</strong>
                <span className="muted small"> Delete current tasks and reminders and use the backup instead.</span>
              </span>
            </label>
          </div>
          {r.settings && (
            <label className="confirm__check">
              <input type="checkbox" checked={includeSettings} onChange={(e) => setIncludeSettings(e.target.checked)} />
              <span>Also import settings (theme, notifications…)</span>
            </label>
          )}
        </div>
      )}
    </Dialog>
  );
}
