import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockCard } from './StockCard';
import type { GrainStock } from '@/types/api';

const stock = (overrides: Partial<GrainStock> = {}): GrainStock => ({
  id: 'grain-watch-1',
  name: 'Halle 8',
  description: 'Lagerhalle 8',
  deviceCount: 5,
  hasGrainSensors: true,
  active: true,
  ...overrides,
});

describe('StockCard', () => {
  it('shows the device count for a stock with grain thermometers', () => {
    render(<StockCard stock={stock()} />);

    expect(screen.getByText('5 devices')).toBeInTheDocument();
  });

  it('labels a fan-only stock instead of claiming devices', () => {
    render(<StockCard stock={stock({ hasGrainSensors: false })} />);

    expect(screen.getByText('Nur Lüftersteuerung')).toBeInTheDocument();
    expect(screen.queryByText(/devices?/)).not.toBeInTheDocument();
  });

  it('treats an absent flag as having sensors', () => {
    const { hasGrainSensors: _omitted, ...withoutFlag } = stock();
    render(<StockCard stock={withoutFlag} />);

    expect(screen.getByText('5 devices')).toBeInTheDocument();
  });
});
