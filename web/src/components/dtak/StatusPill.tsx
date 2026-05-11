import { ReactNode } from 'react';

export type StatusPillVariant =
  | 'info' | 'success' | 'warning' | 'critical' | 'count'
  | 'cot-friendly' | 'cot-hostile' | 'cot-neutral' | 'cot-unknown'
  | 'transport-wifi' | 'transport-ble' | 'transport-relay' | 'transport-offline';

export interface StatusPillProps {
  variant: StatusPillVariant;
  className?: string;
  children: ReactNode;
}

const variantBg: Record<StatusPillVariant, string> = {
  info:                'bg-status-info',
  success:             'bg-status-success',
  warning:             'bg-status-warning',
  critical:            'bg-status-critical',
  count:               'bg-status-critical',
  'cot-friendly':      'bg-cot-friendly',
  'cot-hostile':       'bg-cot-hostile',
  'cot-neutral':       'bg-cot-neutral',
  'cot-unknown':       'bg-cot-unknown',
  'transport-wifi':    'bg-transport-wifi',
  'transport-ble':     'bg-transport-ble',
  'transport-relay':   'bg-transport-relay',
  'transport-offline': 'bg-transport-offline',
};

export default function StatusPill({ variant, className = '', children }: StatusPillProps) {
  return (
    <span
      className={
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ' +
        'text-fg-on-brand ' +
        variantBg[variant] + ' ' + className
      }
    >
      {children}
    </span>
  );
}
