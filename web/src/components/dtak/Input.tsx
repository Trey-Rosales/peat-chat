import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';

interface CommonProps {
  error?: string;
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, CommonProps {
  multiline?: false;
}
export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>, CommonProps {
  multiline: true;
}

type Props = InputProps | TextareaProps;

const base =
  'w-full bg-surface-2 text-fg-primary placeholder:text-fg-tertiary ' +
  'border rounded px-3 py-2 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
  'disabled:opacity-50';

const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, Props>(
  function Input(props, ref) {
    const { error, className = '' } = props;
    const borderClass = error ? 'border-status-critical' : 'border-border-default';
    const cls = `${base} ${borderClass} ${className}`.trim();
    if ('multiline' in props && props.multiline) {
      const { multiline: _, error: __, className: ___, ...rest } = props;
      return (
        <div>
          <textarea ref={ref as any} className={cls} {...rest} />
          {error && <p className="text-status-critical text-xs mt-1">{error}</p>}
        </div>
      );
    }
    const { error: _, className: __, ...rest } = props as InputProps;
    return (
      <div>
        <input ref={ref as any} type="text" className={cls} {...rest} />
        {error && <p className="text-status-critical text-xs mt-1">{error}</p>}
      </div>
    );
  },
);

export default Input;
