import { ReactNode } from 'react';

export type SurfaceVariant = 'canvas' | '1' | '2' | '3' | 'overlay';
export interface SurfaceProps {
  variant?: SurfaceVariant;
  className?: string;
  children?: ReactNode;
}

const variantClass: Record<SurfaceVariant, string> = {
  canvas:  'bg-surface-canvas',
  '1':     'bg-surface-1',
  '2':     'bg-surface-2',
  '3':     'bg-surface-3',
  overlay: 'bg-surface-overlay',
};

export default function Surface({ variant = 'canvas', className = '', children }: SurfaceProps) {
  return <div className={`${variantClass[variant]} ${className}`.trim()}>{children}</div>;
}
