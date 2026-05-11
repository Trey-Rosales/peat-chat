import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Surface from './Surface';

describe('Surface', () => {
  it('renders children', () => {
    render(<Surface>hello</Surface>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies the variant background class', () => {
    const { container } = render(<Surface variant="2">x</Surface>);
    expect(container.firstChild).toHaveClass('bg-surface-2');
  });

  it('defaults to canvas variant', () => {
    const { container } = render(<Surface>x</Surface>);
    expect(container.firstChild).toHaveClass('bg-surface-canvas');
  });

  it('passes through className', () => {
    const { container } = render(<Surface className="extra">x</Surface>);
    expect(container.firstChild).toHaveClass('extra');
  });
});
