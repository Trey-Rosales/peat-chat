import { ReactNode } from 'react';

export type CalloutBarVariant = 'info' | 'success' | 'warning' | 'critical' | 'active-call';

export interface CalloutBarProps {
  variant: CalloutBarVariant;
  icon?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  children: ReactNode;
}

const variantBorder: Record<CalloutBarVariant, string> = {
  info:          'border-status-info',
  success:       'border-status-success',
  warning:       'border-status-warning',
  critical:      'border-status-critical',
  'active-call': 'border-status-critical',
};

const variantBg: Record<CalloutBarVariant, string> = {
  info:          'bg-status-info/10',
  success:       'bg-status-success/10',
  warning:       'bg-status-warning/10',
  critical:      'bg-status-critical/10',
  'active-call': 'bg-status-critical/15',
};

export default function CalloutBar({
  variant, icon, onDismiss, className = '', children,
}: CalloutBarProps) {
  return (
    <div
      role={variant === 'critical' ? 'alert' : 'status'}
      className={
        'flex items-center gap-3 px-4 py-2 rounded-r ' +
        'border-l-4 ' + variantBorder[variant] + ' ' +
        variantBg[variant] + ' ' +
        'text-fg-primary ' +
        className
      }
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-fg-secondary hover:text-fg-primary"
        >
          ✕
        </button>
      )}
    </div>
  );
}
