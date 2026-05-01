import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IconButton from './IconButton';

describe('IconButton', () => {
  it('renders icon and uses label as aria-label', () => {
    render(<IconButton icon={<span data-testid="ico" />} label="Home" />);
    expect(screen.getByLabelText('Home')).toBeInTheDocument();
    expect(screen.getByTestId('ico')).toBeInTheDocument();
  });

  it('reflects toggled state via aria-pressed', () => {
    render(<IconButton icon={<span />} label="Mute" toggled />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon={<span />} label="x" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
