import { InputHTMLAttributes, forwardRef } from 'react';
import { RangeSlider as FlowbiteRangeSlider } from 'flowbite-react';

export interface RangeSliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'sizing'> {}

const RangeSlider = forwardRef<HTMLInputElement, RangeSliderProps>(function RangeSlider(
  { className = '', ...rest },
  ref,
) {
  return <FlowbiteRangeSlider ref={ref as any} className={className} {...rest} />;
});

export default RangeSlider;
