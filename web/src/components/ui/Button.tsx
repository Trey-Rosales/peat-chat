import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Button as FlowbiteButton } from 'flowbite-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <FlowbiteButton
      ref={ref as any}
      // flowbite-react's color type is a closed union; our DTAK variants are wired via flowbite-theme.ts button.color
      color={variant as any}
      size={size}
      className={className}
      {...rest}
    >
      {children}
    </FlowbiteButton>
  );
});

export default Button;
