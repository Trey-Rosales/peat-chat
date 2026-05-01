import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Toggle from './Toggle';

describe('Toggle', () => {
  it('renders with label', () => {
    render(<Toggle checked={false} onChange={() => {}} label="LD mode" />);
    expect(screen.getByLabelText('LD mode')).toBeInTheDocument();
  });

  it('reflects checked state via aria-checked', () => {
    render(<Toggle checked onChange={() => {}} label="x" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="x" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('respects disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled label="x" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
