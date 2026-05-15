import { ToggleSwitch } from 'flowbite-react';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function Toggle({
  checked, onChange, label, disabled, className,
}: ToggleProps) {
  return (
    <ToggleSwitch
      checked={checked}
      onChange={onChange}
      label={label}
      disabled={disabled}
      className={className}
    />
  );
}
