import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useProgress } from '../../store/progress';
import { useContent } from '../../store/content';
import { ConfirmDialog, SettingsRow, SettingsSection, buttonDangerOutline, buttonSecondary } from './controls';
import { buildExport, downloadJson, exportFileName, parseImport, replaceProgress } from './progressData';
import type { ParsedImport } from './progressData';

type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Pending = { kind: 'import'; parsed: ParsedImport; fileName: string } | { kind: 'subject'; subject: string } | { kind: 'all' } | null;

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function ProgressDataSection() {
  const status = useProgress((s) => s.status);
  const states = useProgress((s) => s.states);
  const attemptCount = useProgress((s) => s.attempts.length);
  const sessionCount = useProgress((s) => s.sessions.length);
  const subjectQuestions = useContent((s) => s.subjectQuestions);

  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const available = status === 'ready';
  const stateCount = Object.keys(states).length;

  // Subjects from content, plus any that only exist in saved progress (e.g. a removed bank).
  const subjects = useMemo(() => {
    const progressBySubject = new Map<string, number>();
    for (const s of Object.values(states)) progressBySubject.set(s.subject, (progressBySubject.get(s.subject) ?? 0) + 1);
    const names: string[] = [];
    for (const q of subjectQuestions) if (!names.includes(q.subject)) names.push(q.subject);
    for (const name of progressBySubject.keys()) if (!names.includes(name)) names.push(name);
    return names.map((name) => ({ name, withProgress: progressBySubject.get(name) ?? 0 }));
  }, [states, subjectQuestions]);

  const selectedSubject = subjects.find((s) => s.name === subject) ?? null;

  const close = () => {
    if (!busy) setPending(null);
  };

  async function onExport() {
    setNotice(null);
    setBusy(true);
    try {
      const data = await buildExport();
      downloadJson(data, exportFileName());
      setNotice({
        kind: 'ok',
        text: `Exported ${plural(data.questionState.length, 'question record')}, ${plural(data.attempts.length, 'attempt')} and ${plural(data.sessions.length, 'session')}.`,
      });
    } catch (e) {
      setNotice({ kind: 'error', text: `Export failed: ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function onFileChosen(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setNotice(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice({ kind: 'error', text: 'That file is too large to be a progress export.' });
      return;
    }
    try {
      const parsed = parseImport(await file.text());
      setPending({ kind: 'import', parsed, fileName: file.name });
    } catch (e) {
      setNotice({ kind: 'error', text: `Can't import ${file.name}: ${errorText(e)}` });
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'import') {
        await replaceProgress(pending.parsed.data);
        // Reload so every store re-reads IndexedDB from scratch.
        window.location.reload();
        return;
      }
      if (pending.kind === 'subject') {
        const count = subjects.find((s) => s.name === pending.subject)?.withProgress ?? 0;
        await useProgress.getState().resetSubject(pending.subject);
        setNotice({ kind: 'ok', text: `Reset ${pending.subject}: cleared ${plural(count, 'question record')}. Your attempt history was kept.` });
        setSubject('');
      } else {
        await useProgress.getState().resetAll();
        setNotice({ kind: 'ok', text: 'All progress on this device has been erased.' });
      }
      setPending(null);
    } catch (e) {
      setNotice({ kind: 'error', text: `That didn't work: ${errorText(e)}` });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const unavailableHint =
    status === 'unavailable'
      ? "This browser isn't letting the portal save data (often a private window or blocked site storage), so there's no saved progress to export, import or reset."
      : status !== 'ready'
        ? 'Loading your saved progress…'
        : null;

  return (
    <SettingsSection title="Progress data" description={`${plural(stateCount, 'question record')}, ${plural(attemptCount, 'attempt')}, ${plural(sessionCount, 'session')} saved on this device.`}>
      {unavailableHint && (
        <div role="note" className="flex gap-3 py-3 text-[15px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{unavailableHint}</p>
        </div>
      )}

      <SettingsRow label="Export progress" hint="Download a JSON backup of your question records, attempts and sessions.">
        <button type="button" onClick={onExport} disabled={!available || busy} className={`${buttonSecondary} w-full sm:w-auto`}>
          <Download className="h-5 w-5" aria-hidden="true" />
          Export progress
        </button>
      </SettingsRow>

      <SettingsRow label="Import progress" hint="Replace the progress on this device with a backup file. You'll be asked to confirm first.">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e: { currentTarget: HTMLInputElement }) => onFileChosen(e.currentTarget.files?.[0])}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={!available || busy} className={`${buttonSecondary} w-full sm:w-auto`}>
          <Upload className="h-5 w-5" aria-hidden="true" />
          Import progress
        </button>
      </SettingsRow>

      <SettingsRow label="Reset a subject" hint="Clears that subject's question records. Your attempt history is kept." htmlFor="reset-subject">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id="reset-subject"
            value={subject}
            disabled={!available || busy || subjects.length === 0}
            onChange={(e: { currentTarget: HTMLSelectElement }) => setSubject(e.currentTarget.value)}
            className="min-h-[44px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:flex-1"
          >
            <option value="">Choose a subject</option>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.withProgress === 0 ? 'no progress' : plural(s.withProgress, 'record')})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!available || busy || !selectedSubject || selectedSubject.withProgress === 0}
            onClick={() => selectedSubject && setPending({ kind: 'subject', subject: selectedSubject.name })}
            className={`${buttonDangerOutline} w-full sm:w-auto`}
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
            Reset subject
          </button>
        </div>
      </SettingsRow>

      <SettingsRow label="Reset everything" hint="Erases every question record, attempt and session, and all True/False progress, on this device. Your settings and saved session setup are kept.">
        <button type="button" disabled={!available || busy} onClick={() => setPending({ kind: 'all' })} className={`${buttonDangerOutline} w-full sm:w-auto`}>
          <Trash2 className="h-5 w-5" aria-hidden="true" />
          Reset everything
        </button>
      </SettingsRow>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex gap-3 py-3 text-[15px] ${notice.kind === 'error' ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}
        >
          {notice.kind === 'error' ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </p>
      )}

      <ConfirmDialog
        open={pending?.kind === 'import'}
        title="Replace progress with this backup?"
        confirmLabel="Replace and reload"
        danger
        busy={busy}
        onConfirm={confirm}
        onCancel={close}
      >
        {pending?.kind === 'import' && (
          <>
            <p>
              <span className="font-medium">{pending.fileName}</span>
              {formatDate(pending.parsed.data.exportedAt) && <>, exported {formatDate(pending.parsed.data.exportedAt)}</>}, contains{' '}
              {plural(pending.parsed.data.questionState.length, 'question record')}, {plural(pending.parsed.data.attempts.length, 'attempt')},{' '}
              {plural(pending.parsed.data.sessions.length, 'session')} and {plural(pending.parsed.data.tfAttempts.length, 'True/False answer')}.
            </p>
            {pending.parsed.skipped > 0 && (
              <p className="text-amber-800 dark:text-amber-200">
                {plural(pending.parsed.skipped, 'record')} couldn't be read and will be left out.
              </p>
            )}
            <p>
              Everything currently saved on this device ({plural(stateCount, 'question record')}, {plural(attemptCount, 'attempt')}, plus True/False progress) will be
              replaced. Export first if you might want it back. The page reloads afterwards.
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'subject'}
        title={pending?.kind === 'subject' ? `Reset ${pending.subject}?` : 'Reset subject?'}
        confirmLabel="Reset subject"
        danger
        busy={busy}
        onConfirm={confirm}
        onCancel={close}
      >
        <p>
          This clears {plural(selectedSubject?.withProgress ?? 0, 'question record')} for this subject: correct and wrong counts, marks
          for review and last results. Your attempt history and session records are kept. This can't be undone.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'all'}
        title="Erase all progress?"
        confirmLabel="Erase everything"
        danger
        typeToConfirm="RESET"
        busy={busy}
        onConfirm={confirm}
        onCancel={close}
      >
        <p>
          This permanently deletes {plural(stateCount, 'question record')}, {plural(attemptCount, 'attempt')} and{' '}
          {plural(sessionCount, 'session')} from this device, along with all True/False progress. Your settings and saved session setup are kept.
        </p>
        <p>Export your progress first if you might want it back.</p>
      </ConfirmDialog>
    </SettingsSection>
  );
}
