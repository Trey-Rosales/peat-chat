import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';

export type IconButtonSize = 'sm' | 'md';
export type IconButtonVariant = 'solid' | 'ghost';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  toggled?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  // Optional content positioned at the top-right of the button (e.g., an unread count).
  // Renders inside a relatively-positioned wrapper so a single absolute child is enough.
  badge?: ReactNode;
}

const sizeClass: Record<IconButtonSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
};

const variantClass: Record<IconButtonVariant, string> = {
  solid: 'bg-surface-2 hover:bg-surface-3 text-fg-primary',
  ghost: 'bg-transparent text-fg-secondary hover:text-fg-primary hover:bg-surface-2 active:bg-surface-3',
};

const toggledClass: Record<IconButtonVariant, string> = {
  solid: 'bg-surface-3 text-brand',
  ghost: 'bg-brand/20 text-brand',
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, toggled, size = 'md', variant = 'solid', badge, className = '', ...rest },
  ref,
) {
  const base =
    'inline-flex items-center justify-center rounded-lg shrink-0 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  const variantCls = toggled ? toggledClass[variant] : variantClass[variant];
  const cls = `${base} ${sizeClass[size]} ${variantCls} ${badge ? 'relative' : ''} ${className}`.trim();
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={toggled ? true : undefined}
      className={cls}
      {...rest}
    >
      {icon}
      {badge}
    </button>
  );
});

export default IconButton;
