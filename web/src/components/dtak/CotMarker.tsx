export type CotAffiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

export interface CotMarkerProps {
  affiliation: CotAffiliation;
  remarks?: string;
  className?: string;
}

const aff: Record<CotAffiliation, string> = {
  friendly: 'bg-cot-friendly',
  hostile:  'bg-cot-hostile',
  neutral:  'bg-cot-neutral',
  unknown:  'bg-cot-unknown',
};

export default function CotMarker({ affiliation, remarks, className = '' }: CotMarkerProps) {
  const label = remarks ? `${affiliation}: ${remarks}` : affiliation;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={
        'inline-block w-4 h-4 rounded-tl-full rounded-tr-full rounded-br-full ' +
        '-rotate-45 border-2 border-fg-primary ' +
        aff[affiliation] + ' ' + className
      }
    />
  );
}
