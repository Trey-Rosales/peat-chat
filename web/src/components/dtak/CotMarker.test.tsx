import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CotMarker from './CotMarker';

describe('CotMarker', () => {
  it('renders with affiliation accessibility label', () => {
    render(<CotMarker affiliation="hostile" />);
    expect(screen.getByLabelText(/hostile/i)).toBeInTheDocument();
  });

  it('applies bg-cot-friendly for friendly', () => {
    const { container } = render(<CotMarker affiliation="friendly" />);
    expect(container.firstChild).toHaveClass('bg-cot-friendly');
  });

  it('shows remarks tooltip when provided', () => {
    render(<CotMarker affiliation="neutral" remarks="Patrol Bravo" />);
    expect(screen.getByLabelText(/Patrol Bravo/)).toBeInTheDocument();
  });
});
