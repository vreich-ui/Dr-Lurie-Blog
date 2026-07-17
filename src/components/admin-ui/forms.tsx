/**
 * Admin kit — form controls (T9.2): Input, Textarea, Select, Switch,
 * TaxonomyPicker. Each labelled control wires label/hint/error to the input
 * via ids + aria-describedby / aria-invalid.
 */
import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

import { cn } from './utils';
import { IconCheck } from './icons';

const CONTROL_BASE =
  'adm-focusable w-full rounded-[var(--adm-radius-md)] border bg-[var(--adm-surface-raised)] text-[length:var(--adm-text-sm)] text-[var(--adm-text)] placeholder:text-[var(--adm-text-muted)] disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

function borderClass(invalid?: boolean) {
  return invalid ? 'border-[var(--adm-danger)]' : 'border-[var(--adm-border-strong)]';
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({ label, hint, error, htmlFor, describedBy, children, className }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={describedBy} className="text-[length:var(--adm-text-xs)] text-[var(--adm-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className, ...rest },
  ref
) {
  const auto = useId();
  const inputId = id ?? auto;
  const descId = hint || error ? `${inputId}-desc` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId} describedBy={descId} className={className}>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descId}
        className={cn(CONTROL_BASE, borderClass(Boolean(error)), 'h-10 px-3')}
        {...rest}
      />
    </FieldShell>
  );
});

// ─── Textarea ─────────────────────────────────────────────────────────────────

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id, className, rows = 4, ...rest },
  ref
) {
  const auto = useId();
  const inputId = id ?? auto;
  const descId = hint || error ? `${inputId}-desc` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId} describedBy={descId} className={className}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={descId}
        className={cn(CONTROL_BASE, borderClass(Boolean(error)), 'resize-y px-3 py-2 leading-relaxed')}
        {...rest}
      />
    </FieldShell>
  );
});

// ─── Select ───────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, id, className, ...rest },
  ref
) {
  const auto = useId();
  const inputId = id ?? auto;
  const descId = hint || error ? `${inputId}-desc` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId} describedBy={descId} className={className}>
      <select
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descId}
        className={cn(CONTROL_BASE, borderClass(Boolean(error)), 'h-10 appearance-none px-3 pr-9')}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.5rem center',
        }}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

// ─── Switch ───────────────────────────────────────────────────────────────────

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, hint, disabled, id, className }: SwitchProps) {
  const auto = useId();
  const switchId = id ?? auto;
  const descId = hint ? `${switchId}-desc` : undefined;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'adm-focusable relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-[var(--adm-accent)]' : 'bg-[var(--adm-border-strong)]'
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
      {label || hint ? (
        <div className="flex flex-col">
          {label ? (
            <label htmlFor={switchId} className="text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">
              {label}
            </label>
          ) : null}
          {hint ? (
            <span id={descId} className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
              {hint}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── TaxonomyPicker ───────────────────────────────────────────────────────────

export interface TaxonomyTerm {
  term_id: string;
  label: string;
}

export interface TaxonomyKind {
  kind: string;
  terms: TaxonomyTerm[];
}

export interface TaxonomyPickerProps {
  kinds: TaxonomyKind[];
  /** Selected term_ids. */
  value: string[];
  onChange: (next: string[]) => void;
  label?: ReactNode;
  className?: string;
}

export function TaxonomyPicker({ kinds, value, onChange, label, className }: TaxonomyPickerProps) {
  const selected = new Set(value);
  const toggle = (termId: string) => {
    const next = new Set(selected);
    if (next.has(termId)) next.delete(termId);
    else next.add(termId);
    onChange([...next]);
  };
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label ? (
        <span className="text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">{label}</span>
      ) : null}
      {kinds.map((group) => (
        <div key={group.kind} className="flex flex-col gap-1.5">
          <span className="text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-text-muted)]">
            {group.kind}
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={group.kind}>
            {group.terms.map((term) => {
              const on = selected.has(term.term_id);
              return (
                <button
                  key={term.term_id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(term.term_id)}
                  className={cn(
                    'adm-focusable inline-flex items-center gap-1 rounded-[var(--adm-radius-pill)] border px-2.5 py-1 text-[length:var(--adm-text-xs)] font-medium transition-colors',
                    on
                      ? 'border-transparent bg-[var(--adm-accent-soft)] text-[var(--adm-accent)]'
                      : 'border-[var(--adm-border-strong)] text-[var(--adm-text-muted)] hover:bg-[var(--adm-surface-sunken)]'
                  )}
                >
                  {on ? <IconCheck size={12} /> : null}
                  {term.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
