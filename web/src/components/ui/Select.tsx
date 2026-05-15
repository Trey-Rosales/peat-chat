import { SelectHTMLAttributes, forwardRef } from 'react';
import { Select as FlowbiteSelect } from 'flowbite-react';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'sizing'> {}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', children, ...rest },
  ref,
) {
  return (
    <FlowbiteSelect ref={ref as any} className={className} {...rest}>
      {children}
    </FlowbiteSelect>
  );
});

export default Select;
