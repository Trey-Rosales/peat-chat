import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CalloutBar from './CalloutBar';

describe('CalloutBar', () => {
  it('renders children', () => {
    render(<CalloutBar variant="info">hi</CalloutBar>);
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('applies variant tint', () => {
    const { container } = render(<CalloutBar variant="critical">x</CalloutBar>);
    expect(container.firstChild).toHaveClass('border-status-critical');
  });

  it('renders dismiss button when dismissible', () => {
    const onDismiss = vi.fn();
    render(<CalloutBar variant="info" onDismiss={onDismiss}>x</CalloutBar>);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders icon slot', () => {
    render(<CalloutBar variant="info" icon={<span data-testid="i" />}>x</CalloutBar>);
    expect(screen.getByTestId('i')).toBeInTheDocument();
  });
});
