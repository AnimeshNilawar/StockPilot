import { useEffect, useRef } from 'react';
import { Spinner } from './States';

/**
 * Modal dialog. Closes on Escape and on backdrop click, restores focus to the
 * trigger on unmount, and moves focus inside on open.
 */
export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const panel = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    panel.current?.querySelector('input, select, textarea, button')?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${widths[size]} rounded-2xl bg-white shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

const controlClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500';

export function Field({ label, htmlFor, hint, error, required, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function TextInput({ label, name, error, hint, required, className = '', ...props }) {
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error} required={required}>
      <input
        id={name}
        name={name}
        className={`${controlClass} ${error ? 'border-rose-400' : ''} ${className}`}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
    </Field>
  );
}

export function TextArea({ label, name, error, hint, required, className = '', ...props }) {
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error} required={required}>
      <textarea
        id={name}
        name={name}
        className={`${controlClass} min-h-20 resize-y ${error ? 'border-rose-400' : ''} ${className}`}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
    </Field>
  );
}

export function Select({
  label,
  name,
  error,
  hint,
  required,
  options = [],
  placeholder,
  className = '',
  ...props
}) {
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error} required={required}>
      <select
        id={name}
        name={name}
        className={`${controlClass} ${error ? 'border-rose-400' : ''} ${className}`}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ label, name, checked, onChange, hint, disabled }) {
  return (
    <label className={`flex items-start gap-2 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        id={name}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <span>
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Button({ variant = 'primary', busy = false, children, className = '', ...props }) {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
    secondary:
      'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:text-rose-300',
    ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-400',
  };

  return (
    <button
      type="button"
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/** Field-level validation errors, keyed by field name, from an API rejection. */
export function fieldErrors(error) {
  if (!Array.isArray(error?.data?.errors)) return {};
  return error.data.errors.reduce((acc, field) => ({ ...acc, [field.path]: field.message }), {});
}
