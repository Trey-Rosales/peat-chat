import { ButtonHTMLAttributes, forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:     'bg-brand text-fg-on-brand hover:bg-brand-hover active:bg-brand-active',
  secondary:   'bg-surface-2 text-fg-primary hover:bg-surface-3 border border-border-default',
  ghost:       'bg-transparent text-brand hover:bg-surface-2 border border-brand',
  destructive: 'bg-status-critical text-fg-on-brand hover:opacity-90',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 md:h-10 max-md:h-11 px-4 text-sm', // 40px desktop, 44px mobile
  lg: 'h-12 px-5 text-base',                    // 48px (LD-friendly)
};

const base =
  'inline-flex items-center justify-center rounded font-semibold transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${variantClass[variant]} ${sizeClass[size]} ${className}`.trim()}
      {...rest}
    />
  );
});

export default Button;
