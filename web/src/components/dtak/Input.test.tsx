import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Input from './Input';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="search" />);
    expect(screen.getByPlaceholderText('search')).toBeInTheDocument();
  });

  it('forwards onChange', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('renders multiline as textarea', () => {
    render(<Input multiline placeholder="msg" />);
    expect(screen.getByPlaceholderText('msg').tagName).toBe('TEXTAREA');
  });

  it('shows error styling and message', () => {
    render(<Input error="too short" />);
    expect(screen.getByText('too short')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveClass('border-status-critical');
  });
});
