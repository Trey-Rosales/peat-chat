import { useId } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function Toggle({
  checked, onChange, label, disabled, className = '',
}: ToggleProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={`inline-flex items-center gap-3 ${className}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={
          'relative inline-flex h-6 w-11 items-center rounded-full ' +
          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
          (checked ? 'bg-brand ' : 'bg-surface-3 ') +
          (disabled ? 'opacity-50 cursor-not-allowed ' : '')
        }
      >
        <span
          className={
            'inline-block h-4 w-4 rounded-full bg-fg-on-brand transition-transform ' +
            (checked ? 'translate-x-6 ' : 'translate-x-1 ')
          }
        />
      </button>
      <span className="text-fg-primary text-sm">{label}</span>
    </label>
  );
}
