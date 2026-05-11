import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('applies primary variant by default', () => {
    render(<Button>x</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-brand');
  });

  it('applies destructive variant', () => {
    render(<Button variant="destructive">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-status-critical');
  });

  it('respects size prop', () => {
    render(<Button size="lg">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-12'); // 48px
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('disables and stops click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>x</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
