import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  toggled?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, toggled, className = '', ...rest },
  ref,
) {
  const base =
    'inline-flex items-center justify-center rounded ' +
    'h-11 w-11 max-md:h-11 max-md:w-11 ' +
    'bg-surface-2 hover:bg-surface-3 text-fg-primary ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  const toggledCls = toggled ? ' bg-surface-3 text-brand' : '';
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={toggled ? true : undefined}
      className={`${base}${toggledCls} ${className}`.trim()}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
