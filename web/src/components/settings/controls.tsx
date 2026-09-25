import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="px-1">
        <h2 className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</h2>
        {description && <p className="text-[15px] text-slate-600 dark:text-slate-400">{description}</p>}
      </div>
      <div className="divide-y divide-slate-200 rounded-2xl bg-card-light px-4 shadow-sm dark:divide-slate-700 dark:bg-card-dark">
        {children}
      </div>
    </section>
  );
}

/** A labelled row inside a section; stacks the control under the label so long labels never truncate. */
export function SettingsRow({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  const text = (
    <>
      <span className="block text-base font-medium">{label}</span>
      {hint && <span className="block text-[15px] text-slate-600 dark:text-slate-400">{hint}</span>}
    </>
  );
  return (
    <div className="space-y-2 py-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block">
          {text}
        </label>
      ) : (
        <div>{text}</div>
      )}
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-[15px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'bg-card-light text-primary-700 shadow-sm dark:bg-card-dark dark:text-primary-100'
                : 'text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
            }`}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[56px] w-full items-center gap-4 py-3 text-left disabled:cursor-not-allowed"
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-base font-medium ${disabled ? 'text-slate-500' : ''}`}>{label}</span>
        {hint && <span className="block text-[15px] text-slate-600 dark:text-slate-400">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

export const buttonBase =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondary = `${buttonBase} border border-slate-200 bg-card-light text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-card-dark dark:text-slate-100 dark:hover:bg-slate-700`;
export const buttonDanger = `${buttonBase} bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500`;
export const buttonDangerOutline = `${buttonBase} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40`;
export const buttonPrimary = `${buttonBase} bg-primary text-white hover:bg-primary-600`;

/**
 * Modal confirmation. With `typeToConfirm`, the confirm button stays disabled until that exact word is typed.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  typeToConfirm,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Latest callbacks in a ref so the open effect runs once per opening, not on every render.
  const latest = useRef({ busy, onCancel });
  latest.current = { busy, onCancel };

  useEffect(() => {
    if (!open) return;
    setTyped('');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (inputRef.current ?? cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !latest.current.busy) latest.current.onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  const matches = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl bg-card-light p-5 shadow-xl dark:bg-card-dark"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-base text-slate-700 dark:text-slate-300">{children}</div>
        {typeToConfirm && (
          <div className="mt-4 space-y-2">
            <label htmlFor="type-to-confirm" className="block text-base">
              Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm
            </label>
            <input
              id="type-to-confirm"
              ref={inputRef}
              type="text"
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              onChange={(e: { currentTarget: HTMLInputElement }) => setTyped(e.currentTarget.value)}
              onKeyDown={(e: { key: string }) => {
                if (e.key === 'Enter' && matches && !busy) onConfirm();
              }}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={buttonSecondary}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!matches || busy} className={danger ? buttonDanger : buttonPrimary}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
