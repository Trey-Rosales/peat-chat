import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusPill from './StatusPill';

describe('StatusPill', () => {
  it('renders children', () => {
    render(<StatusPill variant="critical">crit</StatusPill>);
    expect(screen.getByText('crit')).toBeInTheDocument();
  });

  it('applies status-critical bg class for critical variant', () => {
    const { container } = render(<StatusPill variant="critical">x</StatusPill>);
    expect(container.firstChild).toHaveClass('bg-status-critical');
  });

  it('applies cot-hostile bg for cot-hostile variant', () => {
    const { container } = render(<StatusPill variant="cot-hostile">x</StatusPill>);
    expect(container.firstChild).toHaveClass('bg-cot-hostile');
  });

  it('applies transport-ble bg for transport-ble variant', () => {
    const { container } = render(<StatusPill variant="transport-ble">x</StatusPill>);
    expect(container.firstChild).toHaveClass('bg-transport-ble');
  });
});
